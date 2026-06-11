# Setting up Crowd (no coding needed)

Gets Crowd running on your Mac, from zero. One-time setup is ~15 minutes;
after that, starting it takes under a minute.

## The three pieces (mental model)

Think of a small restaurant:

- **Docker** runs the databases — the pantry, where brands and images are stored
- **The API** (`npm run dev`) — the front of house, takes orders
- **The worker** (`npm run worker`) — the kitchen, reads websites and generates images

All three must be running for Crowd to work.

## Part 1 — One-time install

1. **Docker Desktop** — download from docker.com (Mac, Apple Silicon), drag
   to Applications, open it, wait for the whale icon in your menu bar to go steady.
2. **Node.js** — download the LTS installer from nodejs.org, click through.
3. **Dependencies** — open Terminal (Cmd+Space → "Terminal") and run:

```
cd ~/bloomapi
npm install
```

4. **Keys** — open the `.env` file in the folder (right-click → Open With →
   TextEdit) and check:
   - `OPENAI_API_KEY=` … your OpenAI key (a fresh one — rotate the old one!)
   - `CLERK_PUBLISHABLE_KEY=` / `CLERK_SECRET_KEY=` … from dashboard.clerk.com
     if you want real login; leave empty for dev-mode login
   - Want free testing with placeholder images? Set `IMAGE_PROVIDER=mock`

## Part 2 — Start it (every session)

Three Terminal tabs (Cmd+T makes a new one):

| Tab | Command | Wait for |
| --- | --- | --- |
| 1 | `cd ~/bloomapi && docker compose up -d` | "Started" x2 |
| 2 | `cd ~/bloomapi && npm run dev` | "API on http://localhost:3000" |
| 3 | `cd ~/bloomapi && npm run worker` | "workers running" |

Then open **http://localhost:3000** in your browser.

## Part 3 — First run

1. Home page → **Get started** → you land on the login page
2. No Clerk keys yet? Click **Continue in dev mode**
3. **Add your brand** → paste any website (try your favorite product's site) → ↑
4. Watch the extraction (palette, fonts, tone, logo) → **Let's Begin**
5. In the dashboard, open **Ideas**, click any template, then **Create**
6. The image lands in **Images** — click it to view, or Edit / Resize / Save

## Stopping

Ctrl+C in tabs 2 and 3, then `docker compose down` to stop the databases.
Your data survives — it's stored in a Docker volume and the `storage/` folder.

## If something breaks

| Symptom | Fix |
| --- | --- |
| "could not reach Postgres" | Docker isn't running, or run `docker compose up -d` |
| Brand stuck "analyzing" forever | Tab 3 (`npm run worker`) isn't running |
| Login loops back | Clerk keys half-configured — both must be set, then restart tab 2 |
| Image fails with provider error | Check the OpenAI key + billing at platform.openai.com |
| Want to start 100% fresh | `docker compose down -v` (wipes the database!), then start again |
