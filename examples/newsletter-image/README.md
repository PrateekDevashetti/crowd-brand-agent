# newsletter-image

Generates a fresh on-brand 16:9 header image for each email send.

```bash
BRAND_SESSION_ID=<id> node index.mjs "March product update"
```

Replace the final "download" step with your email provider's upload/send call
(Resend, Postmark, Mailchimp, etc.) — the template is provider-agnostic on
purpose. The image URL it prints is directly embeddable while the BrandLayer
server is reachable.
