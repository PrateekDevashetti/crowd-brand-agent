# Testing Crowd

A manual test pass, in order. Each test says what to do and what "good" looks
like. Run with all three pieces started (see SETUP.md Part 2).

Tip: keep the worker tab visible — job logs appear there as you click around.

## 1 · Marketing site

| Do | Good looks like |
| --- | --- |
| Open http://localhost:3000 | Crowd home page, clay/ivory theme, sections fade in as you scroll, tickers scroll in "How it works" |
| Click through Brands, Pricing, Docs in the nav | Each page loads, nav highlights the current page |
| On home, click "Copy" in the MCP section | Button says "Copied!" and the URL is on your clipboard |
| Footer → llms.txt and OpenAPI links | Plain-text docs and a JSON spec load |

## 2 · Login

| Do | Good looks like |
| --- | --- |
| Click **Get started** | Login page with the Crowd mark |
| Without Clerk keys: **Continue in dev mode** | You land on the dashboard |
| With Clerk keys in `.env` (restart first): sign up with an email | Clerk's form appears (clay-colored button); after signup you land on the dashboard; a new user with 100 credits exists |
| Sidebar → **Sign out** | Back to the login page |

## 3 · Brand onboarding (the core flow)

| Do | Good looks like |
| --- | --- |
| Add a brand → paste `stripe.com` → ↑ | Extraction screen: steps tick one by one, then cards appear — logo, about, tagline, palette with hex codes, fonts, style tags |
| Click **Let's Begin** | Dashboard Overview: logo tile, brand name, style tags, color swatches |
| Open **Brand** page | Identity card (logo, description, tagline) + Design Language (colors, fonts, tone, aesthetic) |
| Open **Uploads** | The site's scraped images are there (a handful, status completed) |
| Paste a junk URL like `https://nonexistent-xyz-123.com` | Extraction fails politely with "Try another website" — no crash |

## 4 · Generation

| Do | Good looks like |
| --- | --- |
| Ideas → click "LinkedIn Post" → Create | You're taken to Images; a tile shimmers "brewing…", then the image appears (~10–60s with OpenAI; instant solid color with mock) |
| Create bar: type your own prompt, pick 16:9, 2x variants | Two tiles appear; credits drop by 2 (top-right) |
| Click a finished image | Full-size lightbox |
| **Edit** → "make the background darker" | New tile appears and completes |
| **Resize** → 9:16 | New tile, recomposed vertical version |
| Search box: type a word from one of your prompts | Grid filters to matching images |
| Filters: Generated / Imported | Grid splits correctly (scraped assets are "Imported") |

## 5 · Credits & account

| Do | Good looks like |
| --- | --- |
| Note credits before and after a 2K generation | Drops by exactly 1 per variant |
| `curl localhost:3000/api/v1/account/credits -H "x-api-key: dev-secret"` | JSON with balance + ledger of every deduction/refund |
| Generate with a deliberately broken provider key | Image fails AND the credit comes back (check ledger for a refund entry) |

## 6 · API (Terminal)

```bash
KEY=dev-secret
# 401 without a key
curl -i localhost:3000/api/v1/account | head -1          # → 401
# Brand list
curl localhost:3000/api/v1/brands -H "x-api-key: $KEY"
# Search
curl "localhost:3000/api/v1/images?q=launch" -H "x-api-key: $KEY"
# Update a brand's tone
curl -X PATCH localhost:3000/api/v1/brands/<id> -H "x-api-key: $KEY" \
  -H "content-type: application/json" -d '{"profile":{"tone":"bold, playful"}}'
```

Good: every error response has the shape `{ defined, code, status, message, data }`.

## 7 · MCP (in Claude)

```bash
claude mcp add --transport http crowd http://localhost:3000/api/mcp \
  --header "Authorization: Bearer dev-secret"
```

Then in a Claude session: "List my brands, then generate a 16:9 hero image
for <brand> about a summer sale, and give me the URL."
Good: Claude calls `bloom_list_brands` → `bloom_generate_image` → `bloom_get_image`
and returns a working localhost URL.

## 8 · Agent skill

Download http://localhost:3000/skills/brandlayer.skill — a valid zip with
SKILL.md + 3 rules files. Installable via Claude's Skills settings.

## Recording results

In TODO.md, note anything that failed with: what you did, what you expected,
what happened, and any red text from the API/worker tabs. That's exactly the
bug-report format I can act on fastest.
