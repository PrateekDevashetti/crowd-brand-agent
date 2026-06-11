import { Worker, type Job } from "bullmq";
import sharp from "sharp";
import { pool } from "../lib/db.js";
import { refundCredits } from "../lib/credits.js";
import {
  anthropicConfigured,
  extractBrandProfileWithClaude,
} from "../providers/anthropic.js";
import {
  buildBrandedPrompt,
  scrapeSite,
} from "../providers/brandExtractor.js";
import { imageQueue } from "./queues.js";
import { getImageProvider } from "../providers/gemini.js";
import type { BrandProfile } from "../providers/imageProvider.js";
import { loadImage, saveImage } from "../providers/storage.js";
import {
  BRAND_QUEUE,
  IMAGE_QUEUE,
  connection,
  type BrandJobData,
  type ImageJobData,
} from "./queues.js";

/* ------------------------------------------------------------------ */
/* brand-jobs: scrape → LLM distill → store profile JSONB              */
/* ------------------------------------------------------------------ */

/** Insert an image row + enqueue a download job for a scraped asset URL. */
async function importAsset(
  userId: string,
  brandId: string,
  sourceUrl: string,
  label: string,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO images (user_id, brand_id, kind, prompt, status)
     VALUES ($1, $2, 'upload', $3, 'pending') RETURNING id`,
    [userId, brandId, label],
  );
  await imageQueue.add("upload", {
    imageId: rows[0].id,
    userId,
    kind: "upload",
    brandId,
    sourceUrl,
  });
  return rows[0].id;
}

async function processBrandJob(job: Job<BrandJobData>): Promise<void> {
  const { brandId, url } = job.data;
  try {
    const { signals, assets } = await scrapeSite(url);
    // Claude is the preferred extraction brain when configured; the image
    // provider's LLM (or heuristic mock) is the fallback.
    const profile = anthropicConfigured()
      ? await extractBrandProfileWithClaude(signals).catch(() =>
          getImageProvider().extractBrandProfile(signals),
        )
      : await getImageProvider().extractBrandProfile(signals);

    const { rows } = await pool.query<{ user_id: string }>(
      "SELECT user_id FROM brands WHERE id = $1",
      [brandId],
    );
    const userId = rows[0]?.user_id;

    // Import scraped assets (logo + site imagery) into the library.
    let logoImageId: string | null = null;
    if (userId) {
      if (assets.logo) {
        logoImageId = await importAsset(userId, brandId, assets.logo, "Brand logo (scraped)").catch(() => null);
      }
      for (const img of assets.images) {
        await importAsset(userId, brandId, img, "Scraped from website").catch(() => {});
      }
    }

    await pool.query(
      "UPDATE brands SET status = 'ready', profile = $2, name = $3, logo_image_id = $4, updated_at = now() WHERE id = $1",
      [brandId, JSON.stringify(profile), profile.name ?? null, logoImageId],
    );
  } catch (err) {
    await pool.query(
      "UPDATE brands SET status = 'failed', error = $2, updated_at = now() WHERE id = $1",
      [brandId, (err as Error).message],
    );
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* image-jobs: generate / edit / resize / bg-remove / vectorize / upload */
/* ------------------------------------------------------------------ */

async function loadParent(parentImageId: string): Promise<{ data: Buffer; mimeType: string }> {
  const { rows } = await pool.query<{ storage_path: string; mime_type: string }>(
    "SELECT storage_path, mime_type FROM images WHERE id = $1",
    [parentImageId],
  );
  if (!rows[0]?.storage_path) throw new Error(`Parent image ${parentImageId} has no stored file`);
  return {
    data: await loadImage(rows[0].storage_path),
    mimeType: rows[0].mime_type ?? "image/png",
  };
}

async function loadBrandProfile(brandId: string): Promise<BrandProfile | null> {
  const { rows } = await pool.query<{ profile: BrandProfile | null }>(
    "SELECT profile FROM brands WHERE id = $1",
    [brandId],
  );
  return rows[0]?.profile ?? null;
}

async function processImageJob(job: Job<ImageJobData>): Promise<void> {
  const d = job.data;
  const provider = getImageProvider();
  await pool.query(
    "UPDATE images SET status = 'processing', updated_at = now() WHERE id = $1",
    [d.imageId],
  );

  try {
    let result: { data: Buffer; mimeType: string };

    switch (d.kind) {
      case "generation": {
        const profile = d.brandId ? await loadBrandProfile(d.brandId) : null;
        const prompt = profile
          ? buildBrandedPrompt(profile, d.prompt ?? "")
          : (d.prompt ?? "");
        const referenceImages = [];
        for (const refId of d.referenceImageIds ?? []) {
          referenceImages.push(await loadParent(refId));
        }
        result = await provider.generate({
          prompt,
          aspectRatio: d.aspectRatio,
          resolution: (d.resolution as "1K" | "2K" | "4K") ?? "2K",
          referenceImages,
        });
        break;
      }
      case "edit": {
        const parent = await loadParent(d.parentImageId!);
        const profile = d.brandId ? await loadBrandProfile(d.brandId) : null;
        const prompt = profile
          ? `${d.prompt}\n\nStay on-brand: ${JSON.stringify(profile.colors)} | tone: ${profile.tone}`
          : (d.prompt ?? "");
        result = await provider.edit({ image: parent.data, mimeType: parent.mimeType, prompt });
        break;
      }
      case "resize": {
        const parent = await loadParent(d.parentImageId!);
        result = await provider.resize({
          image: parent.data,
          mimeType: parent.mimeType,
          aspectRatio: d.aspectRatio ?? "1:1",
        });
        break;
      }
      case "background-removal": {
        // SCAFFOLD: swap in rembg / BiRefNet here. For now: flatten to PNG with alpha.
        const parent = await loadParent(d.parentImageId!);
        const data = await sharp(parent.data).ensureAlpha().png().toBuffer();
        result = { data, mimeType: "image/png" };
        break;
      }
      case "vectorize": {
        // SCAFFOLD: swap in vtracer here. For now: embed the raster in an SVG wrapper.
        const parent = await loadParent(d.parentImageId!);
        const meta = await sharp(parent.data).metadata();
        const b64 = parent.data.toString("base64");
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width ?? 1024}" height="${meta.height ?? 1024}"><image width="100%" height="100%" href="data:${parent.mimeType};base64,${b64}"/></svg>`;
        result = { data: Buffer.from(svg, "utf8"), mimeType: "image/svg+xml" };
        break;
      }
      case "upload": {
        const res = await fetch(d.sourceUrl!, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`Failed to download ${d.sourceUrl}: HTTP ${res.status}`);
        const mimeType = res.headers.get("content-type")?.split(";")[0] ?? "image/png";
        result = { data: Buffer.from(await res.arrayBuffer()), mimeType };
        break;
      }
      default:
        throw new Error(`Unknown image job kind: ${d.kind as string}`);
    }

    const storagePath = await saveImage(d.imageId, result.data, result.mimeType);
    await pool.query(
      "UPDATE images SET status = 'completed', storage_path = $2, mime_type = $3, updated_at = now() WHERE id = $1",
      [d.imageId, storagePath, result.mimeType],
    );
  } catch (err) {
    await pool.query(
      "UPDATE images SET status = 'failed', error = $2, updated_at = now() WHERE id = $1",
      [d.imageId, (err as Error).message],
    );
    if (d.creditsCharged && d.creditsCharged > 0) {
      await refundCredits(d.userId, d.creditsCharged, `refund:${d.kind}-failed`, d.imageId).catch(() => {});
    }
    throw err;
  }
}

/* ------------------------------------------------------------------ */

export function startWorkers(): { brandWorker: Worker; imageWorker: Worker } {
  const brandWorker = new Worker<BrandJobData>(BRAND_QUEUE, processBrandJob, {
    connection,
    concurrency: 2,
  });
  const imageWorker = new Worker<ImageJobData>(IMAGE_QUEUE, processImageJob, {
    connection,
    concurrency: 4,
  });
  for (const w of [brandWorker, imageWorker]) {
    w.on("failed", (job, err) =>
      console.error(`[worker:${w.name}] job ${job?.id} failed:`, err.message),
    );
    w.on("completed", (job) =>
      console.log(`[worker:${w.name}] job ${job.id} completed`),
    );
  }
  return { brandWorker, imageWorker };
}
