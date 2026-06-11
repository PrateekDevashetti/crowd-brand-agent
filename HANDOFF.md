# Handoff: BrandLayer (Bloom API clone)

Paste this file into a new session to continue cleanly.

## Goal

Replicate Bloom (trybloom.ai) — "the brand layer for agents." Onboard a brand from a URL, extract its visual DNA (palette, fonts, tone, style), then generate/edit/resize on-brand images via REST API and MCP. Bloom's public OpenAPI spec is at https://www.trybloom.ai/api/v1/spec.json and its docs index at https://www.trybloom.ai/docs/llms.txt — use these to mirror schemas exactly.

## Stack

Node + TypeScript, Fastify, BullMQ + Redis (async jobs), Postgres, Gemini 2.5 Flash Image as the image provider (behind a swappable ImageProvider interface), MCP TypeScript SDK (Streamable HTTP, stateless).

## State: BUILT AND VERIFIED (2026-06-11)

- `npm run typecheck` passes clean (tsc --noEmit, strict mode).
- End-to-end smoke test passed in a sandbox (compiled Redis from source + embedded Postgres, mock image provider):
  - API boots; 401 + Bloom error envelope without key
  - POST /brands → 202 → worker scrapes site → profile extracted (palette/fonts/tone) → status ready
  - POST /images/generations → 202 → worker generates → GET ?wait=true long-poll → completed → /img/{id} serves a valid PNG
  - edit + resize pipelines complete; credits deduct atomically (1/op at 2K) with correct ledger entries
  - MCP initialize + tools/list work over Streamable HTTP (8 bloom_* tools)
- NOT yet verified: real Gemini calls (no API key in sandbox — mock provider used), docker-compose path on a real machine.

## What is built (this folder)

- `package.json`, `tsconfig.json`, `docker-compose.yml` (Postgres+Redis), `.env.example`
- `src/db/schema.sql` — users, api_keys, brands (profile JSONB = visual DNA), images, credit_events; seeds dev user with 1000 credits
- `src/lib/` — auth (x-api-key / Bearer, sha256-hashed keys, DEV_API_KEY bypass), Bloom-style error envelope, atomic credit deduction + refund-on-failure
- `src/providers/brandExtractor.ts` — scrape site (cheerio) → Gemini distills BrandProfile JSON → buildBrandedPrompt() injects profile into every generation. **This is the core IP.**
- `src/providers/gemini.ts` + `imageProvider.ts` — generate/edit/resize via gemini-2.5-flash-image; mock fallback (sharp) when no API key
- `src/providers/storage.ts` — local disk, S3-swappable, public /img/{id} URLs
- `src/queue/` — BullMQ queues + workers (brand onboarding, image jobs). Note: connection is plain options, not an ioredis instance (avoids dual-ioredis type clash).
- `src/services/` + `src/routes/index.ts` — REST endpoints mirroring Bloom: POST/GET /api/v1/brands, POST /images/generations (202 + poll, variants, reference images), /images/{id}/edit|resize|background-removal|vectorize, /images/uploads (URL), GET /images?wait=true long-poll (55s deadline), account + credits
- `src/mcp/server.ts` — MCP at POST /api/mcp, tools: bloom_onboard_brand, bloom_get_brand, bloom_list_brands, bloom_generate_image, bloom_edit_image, bloom_resize_image, bloom_get_image, bloom_upload_image
- `README.md` — architecture diagram, quick start, Bloom parity table

## Providers

Two real providers behind the ImageProvider interface, selected by IMAGE_PROVIDER env or auto (gemini → openai → mock):

- `src/providers/gemini.ts` — gemini-2.5-flash-image; arbitrary aspect ratios.
- `src/providers/openai.ts` — OpenAI Images API via raw fetch (no SDK). Default model gpt-image-1-mini; set OPENAI_IMAGE_MODEL=gpt-image-2 for quality (gpt-image-1 deprecates 2026-10-23). Only 3 sizes (1024², 1536×1024, 1024×1536) — aspect ratios map to nearest; no 4K. Edit/resize via /images/edits; brand extraction via gpt-4o-mini.
- An OPENAI_API_KEY is in .env (gitignored) — it was pasted in chat on 2026-06-11 and must be rotated.
- Live OpenAI calls NOT yet verified: sandbox egress blocks api.openai.com (403). Provider selection verified (worker attempted OpenAI, failed only on network). Verify on a real machine.

## Sharing surface (Bloom parity, added 2026-06-11)

- Web UI at GET / — full dashboard (Overview, Images + plain-English search, Ideas templates, Uploads, Brand page), Bloom-style onboarding flow.
- Asset scraping on onboarding: logo (logo-imgs > apple-touch-icon > og:image > favicon) + up to 6 site images imported as library uploads; brands.logo_image_id → logoUrl.
- GET /docs/llms.txt, GET /api/v1/spec.json (OpenAPI in public/spec.json), GET /skills/brandlayer.skill (zip in public/, rebuilt by zipping skills/brandlayer), GET /skills/brandlayer/* (raw markdown).
- skills/brandlayer/ — agent skill (SKILL.md + rules/). examples/ — newsletter-image, social-repurpose templates.
- PATCH /api/v1/brands/{id} + MCP bloom_update_brand; GET /images?q= + MCP bloom_search_images (keyword over prompts).

## Next steps (priority order)

0. On a real machine: run the 4-step flow with the OpenAI key (and/or a GEMINI_API_KEY) to verify live generation. Confirm the `as never` config casts in src/providers/gemini.ts against current @google/genai types.
2. Logo upload endpoints (PUT /brands/{id}/logo — file + URL variants, @fastify/multipart); pass logo as reference image in buildBrandedPrompt.
3. File upload for images (multipart) + signed single-use upload URLs.
4. Real background removal (rembg/birefnet) and vectorization (vtracer) — current handlers are labeled scaffolds in src/queue/workers.ts.
5. Semantic search: pgvector + CLIP embeddings (images.embedding column stubbed as TEXT in schema).
6. Workspaces/teams, OAuth 2.0 + PKCE for MCP auth parity, rate limiting.
7. Upgrade brand extraction: Playwright screenshot → vision model (better than raw HTML signals).

## Key design notes

- Everything async returns 202 + ID; `?wait=true` long-polls (55s deadline, 1.5s interval)
- Error shape: `{ defined, code, status, message, data }` with Bloom's codes (BRAND_NOT_FOUND 422, INSUFFICIENT_CREDITS 402 with action_url, etc.)
- Credits: 2K = 1 credit, 4K = 2, per variant; atomic deduction with ledger; refunds on job failure
- MCP is a thin wrapper over the same src/services/ functions as REST; stateless transport (one per POST), GET/DELETE return 405
