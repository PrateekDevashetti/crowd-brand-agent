---
name: brandlayer
description: Create on-brand images with BrandLayer. Use whenever the user asks to generate, edit, or resize brand imagery, onboard a brand from a website, or produce channel-ready creative (social posts, ads, banners, thumbnails). Requires the BrandLayer MCP server to be connected.
---

# BrandLayer Agent Skill

BrandLayer owns the brand: palette, typography, logo, tone, imagery rules.
This skill teaches you the rest — how to drive it well.

## Setup check

The BrandLayer MCP must be connected (default local endpoint:
`http://localhost:3000/api/mcp`, header `Authorization: Bearer <api key>`).
If tools named `bloom_*` are not available, tell the user to connect it first.

## Core workflow

1. **Find or onboard the brand.** Call `bloom_list_brands`. If the user's brand
   is missing, call `bloom_onboard_brand` with the website URL, then poll
   `bloom_get_brand` every few seconds until `status` is `ready`. Onboarding
   also imports the site's logo and imagery into the library.
2. **Generate.** Call `bloom_generate_image` with a short prompt (see
   `rules/prompting.md`) and the right aspect ratio (see `rules/channels.md`).
   The brand profile is injected server-side — do NOT restate brand colors,
   fonts, or tone in the prompt.
3. **Retrieve.** Call `bloom_get_image` with `wait: true`. It long-polls up to
   55s and returns `imageUrl` when complete.
4. **Refine.** Use `bloom_edit_image` for changes ("make the background
   darker") and `bloom_resize_image` to recompose to a new aspect ratio
   (generative outpaint, not a crop).

## Rules

- `rules/prompting.md` — what to put in (and leave out of) prompts
- `rules/channels.md` — aspect ratios per platform
- `rules/workflow.md` — multi-image flows, references, error handling
