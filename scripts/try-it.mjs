/**
 * One-command test drive: node scripts/try-it.mjs [website] ["image idea"]
 * Onboards a brand, generates an on-brand image, opens it in your browser.
 */
import { exec } from "node:child_process";

const BASE = "http://localhost:3000";
const H = { "x-api-key": "dev-secret", "content-type": "application/json" };
const site = process.argv[2] ?? "https://stripe.com";
const idea = process.argv[3] ?? "Hero image for a spring product launch";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`\n✗ ${msg}`); process.exit(1); };

console.log(`\nBrandLayer test drive\n  website: ${site}\n  idea:    "${idea}"\n`);

/* 1. Is the API running? */
try {
  await fetch(`${BASE}/healthz`);
} catch {
  fail(`The API isn't running. In another Terminal window, run:\n    cd ${process.cwd()} && npm run dev`);
}

/* 2. Onboard the brand */
console.log("Step 1/3  Reading the website and learning the brand...");
const rb = await fetch(`${BASE}/api/v1/brands`, { method: "POST", headers: H, body: JSON.stringify({ url: site }) });
const bj = await rb.json();
if (!rb.ok) fail(bj.message ?? JSON.stringify(bj));
const brandId = bj.data.id;

let brand;
for (let i = 0; i < 60; i++) {
  await sleep(2000);
  brand = (await (await fetch(`${BASE}/api/v1/brands/${brandId}`, { headers: H })).json()).data;
  if (brand.status !== "analyzing") break;
  if (i === 8) console.log('  ...still analyzing. (If this never finishes, check that "npm run worker" is running in another window.)');
}
if (brand.status !== "ready") fail(`Brand analysis ${brand.status}: ${brand.error ?? "unknown error"}`);

console.log(`  Brand: ${brand.profile.name}`);
console.log(`  Colors: ${(brand.profile.colors ?? []).map((c) => c.hex).join("  ")}`);
console.log(`  Tone:  ${brand.profile.tone ?? "—"}\n`);

/* 3. Generate */
console.log("Step 2/3  Generating an on-brand image (can take up to a minute)...");
const rg = await fetch(`${BASE}/api/v1/images/generations`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({ brandSessionId: brandId, prompt: idea, aspectRatio: "16:9" }),
});
const gj = await rg.json();
if (!rg.ok) fail(gj.message ?? JSON.stringify(gj));
const imageId = gj.data.ids[0];

let img;
for (let i = 0; i < 6; i++) {
  img = (await (await fetch(`${BASE}/api/v1/images/${imageId}?wait=true`, { headers: H })).json()).data;
  if (img.status === "completed" || img.status === "failed") break;
}
if (img.status !== "completed") fail(`Image ${img.status}: ${img.error ?? "timed out"}`);

/* 4. Open it */
console.log(`\nStep 3/3  Done! Your image: ${img.imageUrl}`);
exec(`open "${img.imageUrl}"`, (err) => {
  if (err) console.log("(Open that link in your browser to see it.)");
});

const credits = (await (await fetch(`${BASE}/api/v1/account/credits`, { headers: H })).json()).data;
console.log(`Credits left: ${credits.credits}\n`);
console.log(`Want a tweak? Edit it with:\n  curl -X POST ${BASE}/api/v1/images/${imageId}/edit -H "x-api-key: dev-secret" -H "content-type: application/json" -d '{"prompt": "make it darker"}'`);
