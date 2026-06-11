# Pending Items

Last updated: 2026-06-11

## Your side (Anay)

| # | Item | Why | How |
| --- | --- | --- | --- |
| 1 | **Rotate the OpenAI API key** | The current one was pasted in chat — treat it as exposed. Must happen before the repo goes anywhere public. | platform.openai.com → API keys → create new → paste into `.env` after `OPENAI_API_KEY=` → delete the old key |
| 2 | ~~Create a Clerk app + add keys~~ **DONE** | Keys are in `.env`. | Restart the API terminal (Ctrl+C → `npm run dev`) for them to take effect — then /login shows real sign-in |
| 3 | **Run the test pass** | Confirm everything works on your machine before we ship it. | Follow `TESTING.md` top to bottom; note anything that fails |
| 4 | **Create a GitHub account/repo** | You said you'll tell me when to push — when ready, have an account and decide repo name (suggestion: `crowd`) + public or private. | github.com → New repository (don't add files, empty repo) |
| 5 | **Create a Railway account** | For deployment after GitHub. | railway.com → sign in with GitHub |
| 6 | **Decide a domain (optional)** | `crowd-production.up.railway.app` works; a custom domain looks better and Clerk production mode needs one. | Any registrar; we wire it up during deploy |
| 7 | **Tell me: keep or rename `bloom_*`?** | MCP tools are still named `bloom_onboard_brand` etc. Renaming to `crowd_*` is cleaner but breaks the parity-with-Bloom naming. Your call. | Just answer in chat |

## My side (Claude) — in priority order

| # | Item | Status |
| --- | --- | --- |
| 1 | Push to GitHub + Railway deploy walkthrough | **Waiting on your go** (items 1, 4, 5 above first) |
| 2 | Rename `bloom_*` tools / `skills/brandlayer` path to Crowd naming | Waiting on your decision (item 7) |
| 3 | S3/R2 storage swap | Needed for production (Railway disk is wiped on redeploy) |
| 4 | Logo + file uploads (multipart) | Logo is auto-scraped today; manual upload missing |
| 5 | Real background removal (rembg) + vectorization (vtracer) | Current endpoints are working scaffolds |
| 6 | Semantic search (pgvector + CLIP embeddings) | Today's search is keyword-over-prompts |
| 7 | Stripe billing + credit purchase flow | Credits exist; no way to buy more |
| 8 | Teams/workspaces, rate limiting, production hardening | Post-deploy |
| 9 | Playwright screenshot → vision-model brand extraction | Quality upgrade over HTML scraping |
| 10 | Reference library page (curated gallery + "Recreate") | Ideas page covers part of this today |

## Done (for the record)

Full API (Bloom parity), MCP server (10 tools), brand extraction + asset scraping,
OpenAI/Gemini/mock providers, credits with refunds, dashboard UI, marketing site
(Home/Brands/Pricing/Docs/Login), Crowd rebrand, Clerk scaffold, agent skill +
examples, llms.txt + OpenAPI, Railway deploy guide, all docs.
