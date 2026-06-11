/**
 * newsletter-image — generate an on-brand header image for an email send.
 *
 * Usage:
 *   BRAND_SESSION_ID=<id> node index.mjs "March product update"
 *
 * Output: prints the image URL (and saves header.png next to this file).
 * Plug it into your email tool by passing the URL into your template.
 */
const BASE = process.env.BRANDLAYER_URL ?? "http://localhost:3000";
const KEY = process.env.BRANDLAYER_API_KEY ?? "dev-secret";
const BRAND = process.env.BRAND_SESSION_ID;
const subject = process.argv[2] ?? "Monthly product update";

if (!BRAND) {
  console.error("Set BRAND_SESSION_ID (see GET /api/v1/brands).");
  process.exit(1);
}

const H = { "x-api-key": KEY, "content-type": "application/json" };
const api = async (path, opts) => {
  const r = await fetch(BASE + "/api/v1" + path, { headers: H, ...opts });
  const j = await r.json();
  if (!r.ok) throw new Error(j.message ?? r.status);
  return j.data;
};

// 1. Generate a 16:9 email header for this subject line
const gen = await api("/images/generations", {
  method: "POST",
  body: JSON.stringify({
    brandSessionId: BRAND,
    prompt: `Email newsletter header banner for an update titled "${subject}". Slim, elegant composition with negative space for the subject line.`,
    aspectRatio: "16:9",
  }),
});

// 2. Long-poll until done
let img;
do {
  img = await api(`/images/${gen.ids[0]}?wait=true`);
} while (img.status === "pending" || img.status === "processing");

if (img.status !== "completed") throw new Error("Generation failed: " + img.error);

// 3. Use it — here we just download it; swap this for your email API call
console.log("Header image:", img.imageUrl);
const buf = Buffer.from(await (await fetch(img.imageUrl)).arrayBuffer());
const { writeFile } = await import("node:fs/promises");
await writeFile(new URL("./header.png", import.meta.url), buf);
console.log("Saved header.png — attach or upload it in your email tool.");
