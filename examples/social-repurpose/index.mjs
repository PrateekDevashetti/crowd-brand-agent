/**
 * social-repurpose — one topic in, channel-ready images out.
 *
 * Usage:
 *   BRAND_SESSION_ID=<id> node index.mjs "We just launched dark mode"
 *
 * Generates a hero (16:9, for blog/X), then resizes it for Instagram (1:1)
 * and Stories (9:16) so the campaign stays visually consistent.
 */
const BASE = process.env.BRANDLAYER_URL ?? "http://localhost:3000";
const KEY = process.env.BRANDLAYER_API_KEY ?? "dev-secret";
const BRAND = process.env.BRAND_SESSION_ID;
const topic = process.argv[2] ?? "Product announcement";

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
const waitFor = async (id) => {
  let img;
  do { img = await api(`/images/${id}?wait=true`); }
  while (img.status === "pending" || img.status === "processing");
  if (img.status !== "completed") throw new Error("failed: " + img.error);
  return img;
};

// 1. Hero at 16:9
const gen = await api("/images/generations", {
  method: "POST",
  body: JSON.stringify({
    brandSessionId: BRAND,
    prompt: `Announcement visual: ${topic}. One bold focal subject, space for a short headline.`,
    aspectRatio: "16:9",
  }),
});
const hero = await waitFor(gen.ids[0]);
console.log("Blog / X (16:9):", hero.imageUrl);

// 2. Recompose for Instagram feed + story (consistent campaign look)
for (const ratio of ["1:1", "9:16"]) {
  const r = await api(`/images/${hero.id}/resize`, {
    method: "POST",
    body: JSON.stringify({ aspectRatio: ratio }),
  });
  const img = await waitFor(r.id);
  console.log(`${ratio === "1:1" ? "Instagram feed" : "Story / Reels"} (${ratio}):`, img.imageUrl);
}
