# BrandLayer Examples

Copy-ready templates for wiring BrandLayer into real workflows. Each folder
stands alone: copy it, set the env vars, replace the demo input with your own.

| Template | Use it for |
| --- | --- |
| [`newsletter-image`](./newsletter-image) | Generate a fresh on-brand header image for each email send |
| [`social-repurpose`](./social-repurpose) | Turn one topic into ready images for Instagram, LinkedIn, and X |

## Env vars

Every template reads:

```
BRANDLAYER_URL=http://localhost:3000
BRANDLAYER_API_KEY=dev-secret
BRAND_SESSION_ID=<your brand id, from GET /api/v1/brands>
```

## Point your agent at this

Ask a coding agent: "Integrate the newsletter-image template from the
examples folder into my email send job, replacing the demo subject line with
the real one." Works with any agent that has repo access plus the BrandLayer
MCP (`POST /api/mcp`).
