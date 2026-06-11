# How Crowd Works — The Complete Explainer

Written for Anay: non-developer today, aiming at a forward-deployed engineer
(FDE) role. This document explains every moving part of this project from
zero, so you can reference it in any future chat ("read LEARN.md, then help
me with X") and build real understanding over time.

---

## 1. What this product actually is

Crowd solves one problem: **AI image generators don't know your brand.** Ask
any model for "a hero image for our spring launch" and you get something
generic. Crowd fixes that by learning a brand once — colors, fonts, tone,
logo, imagery rules — storing that knowledge as structured data, and quietly
attaching it to every image request. The user types one line; the model
receives a full brand brief.

The second idea is just as important: Crowd isn't only an app. The same
capability is exposed three ways — a **web app** for humans, a **REST API**
for software, and an **MCP server** for AI agents. That's why it's called
"the brand layer": other tools sit on top of it.

## 2. The 10,000-foot view

```
You (browser)        Another app (code)        Claude (agent)
      │                     │                        │
      └──────────┬──────────┴────────────────────────┘
                 ▼
        ┌─────────────────┐
        │   THE API        │  one Node.js process, answers instantly
        │   (Fastify)      │  "got it — here's a ticket number"
        └────────┬─────────┘
                 │ puts jobs in a queue (Redis)
                 ▼
        ┌─────────────────┐
        │   THE WORKER     │  a second Node.js process, does slow work:
        │   (BullMQ)       │  scraping websites, calling image models
        └────────┬─────────┘
                 ▼
        ┌─────────────────┐
        │   STORAGE        │  Postgres (facts) + disk (image files)
        └─────────────────┘
```

Why two processes? Because generating an image takes 10–60 seconds, and a
web server should never keep a request hanging that long. So the API does
bookkeeping and answers in milliseconds ("202 Accepted, here's your image
id"), while the worker grinds through the slow jobs in the background. The
client checks back ("polling") until the job is done. This **async job
pattern** is everywhere in real systems — once you see it here, you'll
recognize it in every product you ever integrate.

## 3. The technologies, one by one

**Node.js** — a program that runs JavaScript outside the browser. Both our
processes (API and worker) are Node programs.

**TypeScript** — JavaScript plus type annotations ("this variable is a
string"). The compiler (`tsc`) catches mistakes before the code ever runs.
`npm run typecheck` is exactly that check. Files end in `.ts` and live in `src/`.

**npm** — Node's package manager. `package.json` lists the libraries we use;
`npm install` downloads them into `node_modules/`.

**Fastify** — the web framework. It maps URLs to functions: "when a POST
arrives at `/api/v1/brands`, run this code." Each URL+method pair is called
a **route** or **endpoint**.

**Postgres** — the database. Tables like spreadsheets: `users`, `brands`,
`images`, `credit_events`, `api_keys`. The schema (table definitions) lives
in `src/db/schema.sql` and applies itself at boot, so there's no manual
database setup.

**Redis & BullMQ** — Redis is a tiny ultra-fast data store; BullMQ uses it
as a job queue. The API pushes a job ("generate image 123"), the worker pops
it. If the worker crashes mid-job, the job isn't lost.

**Docker** — runs Postgres and Redis in isolated containers so you don't
install them on your Mac directly. `docker-compose.yml` describes them;
`docker compose up -d` starts both.

**Clerk** — a hosted auth service. We never see passwords; Clerk handles
sign-up/sign-in and gives the browser a signed token (a **JWT**) that our
API can verify mathematically using a secret key.

**MCP (Model Context Protocol)** — a standard that lets AI agents discover
and call tools. Our MCP server says "here are 10 tools (onboard brand,
generate image…)" and Claude can use them like hands.

## 4. Life of a request — the two stories to know cold

### Story A: onboarding a brand

1. You paste `stripe.com` and hit ↑. Browser sends `POST /api/v1/brands`.
2. The API authenticates you (key or Clerk token), inserts a row in `brands`
   with `status='analyzing'`, pushes a job onto the `brand-jobs` queue, and
   replies immediately: `202 { id, status: 'analyzing' }`.
3. The worker picks up the job and runs `scrapeSite()`
   (src/providers/brandExtractor.ts): downloads the page HTML, pulls out
   title, meta description, hex colors (counted by frequency), font names,
   headings — plus asset URLs: logo candidates and content images.
4. Those text signals go to an LLM with a carefully written prompt: "you are
   a senior brand designer; distill this into JSON with colors, fonts, tone,
   styleKeywords, imageryGuidelines, doNots." The reply is the **brand
   profile** — the heart of the product.
5. The worker also queues download jobs for the logo and site images (they
   become library entries), then updates the brand row: `status='ready'`,
   profile saved as JSONB (JSON stored in a database column).
6. Meanwhile your browser polls `GET /brands/{id}` every 2 seconds. When it
   sees `ready`, it renders the profile cards.

### Story B: generating an image

1. You type "Hero image for a spring launch", pick 16:9, hit Create.
   Browser sends `POST /api/v1/images/generations`.
2. The API checks the brand is ready, computes cost (2K = 1 credit per
   variant), and **atomically** deducts credits — one SQL statement that
   only succeeds if the balance is sufficient, so two simultaneous requests
   can't both spend the same credit. A ledger row records it.
3. It inserts an `images` row (`status='pending'`), queues a job, replies
   `202 { ids: [...] }`.
4. The worker loads the brand profile and calls `buildBrandedPrompt()` —
   your one line becomes a full brief: brand name, palette with roles, type,
   tone, imagery guidelines, do-nots, then "REQUEST: Hero image for a spring
   launch."
5. That goes to the **image provider**. We have three behind one interface:
   OpenAI (gpt-image), Gemini Flash Image, and a mock (solid-color PNGs for
   free offline testing). The provider returns image bytes.
6. Bytes are saved to `storage/` with the image id as filename; the row is
   updated to `completed`. If anything failed, status becomes `failed` and
   credits are refunded automatically.
7. Your browser, long-polling `GET /images/{id}?wait=true` (the server holds
   the request up to 55s instead of making you ask repeatedly), gets
   `completed` + `imageUrl` and renders it. The image itself is served by
   `GET /img/{id}` with no auth — the id is the secret.

Edits and resizes are the same story; the worker just sends the original
image to the provider with different instructions ("recompose to 9:16,
outpaint the background, don't crop the subject").

## 5. The map of the code

```
src/
  index.ts        boot the API: apply schema, register routes, listen on :3000
  worker.ts       boot the worker: apply schema, start the two queue consumers
  routes/index.ts every endpoint + serving the web pages; the error envelope
  services/       the business logic the routes call
    brands.ts       create/get/list/update brand, "is it ready?" guard
    images.ts       generation, edit, resize, uploads, search, long-poll
    account.ts      balance + ledger
  providers/
    brandExtractor.ts  scraping + the extraction prompt + buildBrandedPrompt  ← core IP
    gemini.ts          Gemini provider + mock fallback + provider selection
    openai.ts          OpenAI provider (sizes map to 1:1 / 3:2 / 2:3)
    imageProvider.ts   the shared interface + BrandProfile type
    storage.ts         save/load/public-URL (disk now, S3-shaped)
  queue/
    queues.ts        queue definitions + job payload types
    workers.ts       the actual job handlers (Story A and B step-by-step)
  mcp/server.ts    the 10 agent tools — thin wrappers over services/
  lib/
    auth.ts          API keys (sha256-hashed) + Clerk JWT verification
    credits.ts       atomic deduction + refunds
    errors.ts        ApiError + the Bloom-style envelope
    db.ts, env.ts    connection pool, config from .env
public/
  index.html       the dashboard (one self-contained file: HTML+CSS+JS)
  site/            marketing pages + login
  spec.json        OpenAPI description of the API
skills/ examples/  the agent skill and integration templates
```

A few design decisions worth understanding, because interviewers love them:

- **Services separate from routes.** Routes handle HTTP (parsing, status
  codes); services hold logic. That's why MCP could reuse everything — it
  calls the same service functions through a different door.
- **Provider interface.** Swapping OpenAI↔Gemini↔mock changes zero lines
  outside one file. "Program to interfaces, not implementations."
- **Idempotent schema.** Every statement is `CREATE TABLE IF NOT EXISTS` /
  `ADD COLUMN IF NOT EXISTS`, so running it twice is harmless and boot-time
  application is safe. (The grown-up version is numbered migrations.)
- **Stable error envelope.** Every error is
  `{ defined, code, status, message, data }` — clients and agents can handle
  failures programmatically instead of parsing prose.
- **202 + poll, not websockets.** Simplest robust pattern for slow jobs;
  `?wait=true` long-polling makes it pleasant without extra infrastructure.

## 6. Money: how credits work

`users.credits` is the balance. Every spend/refund writes a `credit_events`
row (amount, reason, image id) — that's a **ledger**, and it means you can
always audit where credits went. Pricing: 2K = 1 credit, 4K = 2, per
variant; scraped/imported images are free. Deduction happens *before*
queueing (so users can't overdraw with parallel requests); refunds happen in
the worker when a job fails. There is no purchase flow yet — that's Stripe,
on the roadmap.

## 7. Auth: who is calling?

Three ways in, all resolving to a row in `users`:

1. **Dev key** — `DEV_API_KEY` in `.env` maps to a seeded local user. For
   development only; on a real deploy you set it to a long random string.
2. **API keys** — stored sha256-hashed in `api_keys` (we can verify a key,
   but a database leak reveals nothing usable).
3. **Clerk JWT** — the browser gets a token from Clerk after sign-in and
   sends it as `Authorization: Bearer …`. The API verifies the signature
   with the Clerk secret and finds-or-creates the user by their Clerk id.

The dashboard picks automatically: stored key if you used dev login, Clerk
token if you signed in for real.

## 8. The vocabulary (drop these correctly and you sound senior)

| Term | Meaning here |
| --- | --- |
| endpoint / route | a URL + method the API answers, e.g. `POST /api/v1/brands` |
| 202 Accepted | "job received, not finished" — the async pattern's handshake |
| polling / long-polling | asking repeatedly / the server holding one ask open |
| queue / worker | the to-do list / the process that does the to-dos |
| JSONB | JSON stored queryably inside Postgres |
| JWT | a signed token proving identity without a password |
| idempotent | safe to run twice (same result) |
| atomic | all-or-nothing; no halfway states |
| ledger | append-only money log |
| provider interface | one contract, many interchangeable implementations |
| scaffold | working structure with placeholder internals (our bg-removal) |
| MCP | the protocol that turns this API into agent tools |
| env var / .env | config and secrets kept out of code |

## 9. Why this project is a great FDE portfolio piece

A forward-deployed engineer takes a real product, integrates it into a
customer's messy environment, debugs across the whole stack, and explains
everything clearly to non-engineers. This repo rehearses each of those:

- **Integration surface:** you have an API, an MCP server, webhook-shaped
  templates (examples/), and an auth handoff (Clerk) — the exact kinds of
  seams FDEs wire up at customers.
- **Debugging across layers:** when an image fails, the cause could be the
  browser, the API, the queue, the worker, the provider, or the database.
  TESTING.md teaches you to localize the failure — the core FDE skill.
- **You already lived it:** the Postgres port clash we hit (your Mac's local
  Postgres vs Docker's) is a textbook customer-environment problem, and the
  fix (move ports, point config explicitly) is textbook FDE work.
- **Demo-ability:** marketing site → login → onboard a brand live → generate
  → call it from Claude via MCP. That's a complete customer demo arc.

Practice explaining Story A and Story B out loud, without notes. If you can
narrate those two flows, you understand the system better than most people
who can write code.

## 10. How to use this doc in future chats

Start a session with: *"Read LEARN.md, HANDOFF.md, and TODO.md in my crowd
folder, then help me with…"* Good follow-ups to deepen understanding:

- "Walk me through src/queue/workers.ts line by line at my level."
- "Break X (safely) and help me debug it from the logs."
- "Quiz me on Story A and Story B until I can explain them cold."
- "What would change in this architecture at 1,000 users?"
- "Interview me as if this were my portfolio project for an FDE role."
