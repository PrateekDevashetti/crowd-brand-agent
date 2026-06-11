# Deploying Crowd to Railway

Two services from one repo, plus managed Postgres and Redis.

## 1. Push to GitHub

```bash
git init && git add -A && git commit -m "Crowd v0.2"
gh repo create crowd --private --source . --push   # or create the repo on github.com and git push
```

`.env` is gitignored — secrets never leave your machine.

## 2. Create the Railway project

1. railway.com → New Project → **Deploy from GitHub repo** → pick `crowd`
2. Add **Postgres** and **Redis** from the service catalog (right-click canvas → Database)

## 3. Configure the API service

- Build command: `npm install && npm run build`
- Start command: `npm start`
- Variables:
  - `DATABASE_URL` → reference Postgres's `DATABASE_URL`
  - `REDIS_URL` → reference Redis's `REDIS_URL`
  - `BASE_URL` → your Railway domain (e.g. `https://crowd-production.up.railway.app`)
  - `DEV_API_KEY` → a long random string (this is an admin key — rotate from `dev-secret`!)
  - `OPENAI_API_KEY` or `GEMINI_API_KEY`
  - `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`
- Networking: Generate Domain (port 3000)

## 4. Add the worker service

Same repo, second service:

- Build command: `npm install && npm run build`
- Start command: `npm run start:worker`
- Same variables as the API (it needs DB, Redis, and the image-provider key)

## 5. Clerk production setup

In the Clerk dashboard: add your Railway domain to allowed origins, and switch
to the production instance keys when you move off `*.up.railway.app`.

## Gotchas

- **Storage is ephemeral on Railway.** Generated images live in `STORAGE_DIR`
  and vanish on redeploy. Fine for demos; for production swap
  `src/providers/storage.ts` to S3/R2 (it's three functions).
- The schema applies itself on boot — no migration step needed.
- Health check path: `/healthz`.
