# Workflow rules

## Multi-image campaigns

For "make me a launch kit" style asks, generate per-channel rather than
resizing one master image blindly:

1. Generate the hero at the primary channel's ratio.
2. For each other channel, prefer `bloom_resize_image` from the hero (keeps
   the composition consistent) unless the channel needs different content —
   then generate fresh with a channel-appropriate prompt.

## References

`bloom_upload_image` imports an image by URL into the library. Use it to
bring in a product shot or reference, then pass its id in
`referenceImageIds` on generation for stronger fidelity.

## Polling and patience

- Brand onboarding: poll `bloom_get_brand` every 3–5s; typical 10–30s.
- Images: `bloom_get_image` with `wait: true` long-polls 55s server-side.
  If still pending after one wait, call it again rather than regenerating.

## Errors

- `BRAND_NOT_READY` — keep polling the brand, don't regenerate.
- `INSUFFICIENT_CREDITS` (402) — stop and tell the user; include the
  `action_url` from the error payload.
- A `failed` image refunds its credits automatically; retry once with a
  simplified prompt before asking the user.
