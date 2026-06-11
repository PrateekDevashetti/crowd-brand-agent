# Crowd

**The brand layer for agents.** Onboard a brand from its website once — Crowd
learns the logo, palette, typography, tone, and imagery rules — then every
image you generate comes back on-brand, from the app, the REST API, or any
agent over MCP.

Self-hosted. Your keys, your storage, your brand data.

## How it works

```
Client (browser / curl / Claude / Cursor)
        │
        ▼
┌──────────────────────────────┐
│  Fastify API                 │
│  /            (marketing)    │
│  /app         (dashboard)    │
│  /api/v1/*    (REST)         │──── 202 + id, client polls (?wait=true)
│  /api/mcp     (MCP tools)    │
└──────────┬───────────────────┘
           │ enqueue (BullMQ / Redis)
           ▼
┌──────────────────────────────┐     ┌──────────────────────┐
│  Workers                     │────▶│ Image provider        │
│  brand-jobs: scrape → LLM    │     │ OpenAI gpt-image /    │
│  image-jobs: gen/edit/resize │     │ Gemini Flash / mock   │
└──────────┬───────────────────┘     └──────────────────────┘
           ▼
   Postgres (brands, images, credits) + disk/S3 storage
```

The core mechanic: onboarding scrapes the website, an LLM distills it into a
**brand profile** (JSONB), and `buildBrandedPrompt()` injects that profile
into every generation — so a one-line prompt comes back on-brand.

## Features

- **Brand onboarding from a URL** — profile + logo + site imagery, in ~20s
- **Generate / edit / resize** — variants, reference images, 1K/2K/4K
- **Plain-English search** over your library (API, MCP, and in-app)
- **Seamless brand updates** — PATCH the profile; every future asset reflects it
- **MCP server** — 10 tools for Claude, Cursor, or any MCP client
- **Agent skill** — downloadable `.skill` that teaches agents to use Crowd well
- **Credits with an audit ledger** — 2K = 1, 4K = 2, automatic refunds on failure
- **Clerk auth** (optional) with a dev-mode fallback for local hacking

## Quickstart

Requires Node 20+, Docker Desktop.

```bash
docker compose up -d          # Postgres + Redis
npm install
cp .env.example .env          # add OPENAI_API_KEY or GEMINI_API_KEY (optional — mock provider otherwise)
npm run dev                   # API + UI on :3000 (schema auto-applies)
npm run worker                # second terminal
```

Open **http://localhost:3000** → Get started → paste a website → generate.

New to all this? **SETUP.md** is the step-by-step guide; **TESTING.md** shows
how to verify everything; **LEARN.md** explains how the whole system works.

## API in 30 seconds

```bash
# Onboard
curl -X POST localhost:3000/api/v1/brands \
  -H "x-api-key: $KEY" -H "content-type: application/json" \
  -d '{"url": "https://stripe.com"}'

# Generate (after brand status = ready)
curl -X POST localhost:3000/api/v1/images/generations \
  -H "x-api-key: $KEY" -H "content-type: application/json" \
  -d '{"brandSessionId": "<id>", "prompt": "Hero image for a spring launch", "aspectRatio": "16:9"}'

# Long-poll the result
curl "localhost:3000/api/v1/images/<imageId>?wait=true" -H "x-api-key: $KEY"
```

Full reference: [/docs](http://localhost:3000/docs) ·
[/docs/llms.txt](http://localhost:3000/docs/llms.txt) (for agents) ·
[/api/v1/spec.json](http://localhost:3000/api/v1/spec.json) (OpenAPI)

## MCP

```bash
claude mcp add --transport http crowd http://localhost:3000/api/mcp \
  --header "Authorization: Bearer $KEY"
```

Tools: onboard/get/list/update brand · generate/edit/resize/get/search/upload image.

## Project layout

```
src/
  routes/      REST endpoints + page serving
  services/    business logic (brands, images, account)
  providers/   brand extractor, image providers (OpenAI/Gemini/mock), storage
  queue/       BullMQ queues + workers
  mcp/         MCP server (thin wrapper over services)
  lib/         auth (Clerk + API keys), credits, errors, db
  db/          schema.sql (idempotent, auto-applied on boot)
public/
  site/        marketing pages (home, brands, pricing, docs, login)
  index.html   the dashboard app
skills/        agent skill (served at /skills/brandlayer.skill)
examples/      integration templates (newsletter-image, social-repurpose)
```

## Deploying

See **DEPLOY.md** for the Railway recipe (API + worker + Postgres + Redis).

## Docs index

| File | What |
| --- | --- |
| SETUP.md | Non-developer setup, step by step |
| TESTING.md | How to verify everything works |
| LEARN.md | How the whole system works, explained from zero |
| DEPLOY.md | Railway deployment |
| TODO.md | Pending work, both sides |
| HANDOFF.md | Technical state, for continuing in a new agent session |
