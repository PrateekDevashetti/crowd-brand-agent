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
  - `BASE_URL` → your Railway domain (e.g. `https://crowd-brand-agent-production.up.railway.app`)
  - `CORS_ALLOWED_ORIGINS` → `https://app.trycanopy.space` (comma-separated for multiple exact origins)
  - `DEV_API_KEY` → a long random string (this is an admin key — rotate from `dev-secret`!)
  - `OPENAI_API_KEY` or `GEMINI_API_KEY`
  - `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`
  - `CANOPY_API_URL`, `INTERNAL_SERVICE_SECRET` → the Canopy API URL and matching service secret
  - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`
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

- **Storage is ephemeral on Railway.** Configure all five `R2_*` variables in production;
  local development falls back to `STORAGE_DIR`.
- The schema applies itself on boot — no migration step needed.
- Health check path: `/healthz`.

Before deploying, run `npm test && npm run typecheck && npm run build`.
