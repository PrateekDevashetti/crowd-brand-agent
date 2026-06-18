import { setTimeout as sleep } from "node:timers/promises";
import { pool } from "../lib/db.js";
import { creditCost, deductCredits } from "../lib/credits.js";
import { Errors } from "../lib/errors.js";
import { imageSpendCents } from "../lib/providerCap.js";
import { chargeWallet } from "../lib/walletClient.js";
import { publicUrl } from "../providers/storage.js";
import { imageQueue, type ImageKind } from "../queue/queues.js";
import { requireReadyBrand } from "./brands.js";

const LONG_POLL_DEADLINE_MS = 55_000;
const LONG_POLL_INTERVAL_MS = 1_500;

export interface ImageRow {
  id: string;
  brand_id: string | null;
  kind: string;
  status: string;
  prompt: string | null;
  aspect_ratio: string | null;
  resolution: string;
  parent_image_id: string | null;
  storage_path: string | null;
  mime_type: string | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

function serialize(row: ImageRow) {
  return {
    id: row.id,
    brandSessionId: row.brand_id,
    kind: row.kind,
    status: row.status,
    prompt: row.prompt,
    aspectRatio: row.aspect_ratio,
    resolution: row.resolution,
    parentImageId: row.parent_image_id,
    imageUrl: row.status === "completed" ? publicUrl(row.id) : null,
    mimeType: row.mime_type,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function insertImage(
  userId: string,
  fields: {
    kind: ImageKind;
    brandId?: string | null;
    prompt?: string | null;
    aspectRatio?: string | null;
    resolution?: string;
    parentImageId?: string | null;
  },
): Promise<ImageRow> {
  const { rows } = await pool.query<ImageRow>(
    `INSERT INTO images (user_id, brand_id, kind, prompt, aspect_ratio, resolution, parent_image_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      userId,
      fields.brandId ?? null,
      fields.kind,
      fields.prompt ?? null,
      fields.aspectRatio ?? null,
      fields.resolution ?? "2K",
      fields.parentImageId ?? null,
    ],
  );
  return rows[0];
}

async function requireCompletedImage(userId: string, imageId: string): Promise<ImageRow> {
  const { rows } = await pool.query<ImageRow>(
    "SELECT * FROM images WHERE id = $1 AND user_id = $2",
    [imageId, userId],
  );
  if (!rows[0]) throw Errors.imageNotFound(imageId);
  if (rows[0].status !== "completed") {
    throw Errors.imageNotCompleted(imageId, rows[0].status);
  }
  return rows[0];
}

/* ------------------------------------------------------------------ */
/* POST /images/generations — 202 + ids, supports variants & refs      */
/* ------------------------------------------------------------------ */

export async function createGeneration(
  userId: string,
  input: {
    brandSessionId?: string;
    prompt: string;
    aspectRatio?: string;
    resolution?: string;
    variants?: number;
    referenceImageIds?: string[];
  },
) {
  if (!input.prompt?.trim()) throw Errors.validation("prompt is required.");
  const variants = Math.min(Math.max(input.variants ?? 1, 1), 4);
  const resolution = input.resolution ?? "2K";
  if (!["1K", "2K", "4K"].includes(resolution)) {
    throw Errors.validation('resolution must be "1K", "2K", or "4K".');
  }

  if (input.brandSessionId) await requireReadyBrand(userId, input.brandSessionId);
  for (const refId of input.referenceImageIds ?? []) {
    await requireCompletedImage(userId, refId);
  }

  // Charge the unified credit wallet (canopy-api) — throws 402 if out of credits.
  await chargeWallet(userId, imageSpendCents(resolution, variants), "brand-image-generation");

  const cost = creditCost(resolution, variants);
  await deductCredits(userId, cost, "image-generation");
  const perVariant = cost / variants;

  const ids: string[] = [];
  for (let i = 0; i < variants; i++) {
    const row = await insertImage(userId, {
      kind: "generation",
      brandId: input.brandSessionId ?? null,
      prompt: input.prompt,
      aspectRatio: input.aspectRatio ?? "1:1",
      resolution,
    });
    ids.push(row.id);
    await imageQueue.add("generate", {
      imageId: row.id,
      userId,
      kind: "generation",
      prompt: input.prompt,
      aspectRatio: input.aspectRatio ?? "1:1",
      resolution,
      brandId: input.brandSessionId ?? null,
      referenceImageIds: input.referenceImageIds ?? [],
      creditsCharged: perVariant,
    });
  }
  return { ids, status: "pending" as const };
}

/* ------------------------------------------------------------------ */
/* Derived operations: edit / resize / background-removal / vectorize  */
/* ------------------------------------------------------------------ */

async function createDerived(
  userId: string,
  parentImageId: string,
  kind: Exclude<ImageKind, "generation" | "upload">,
  opts: { prompt?: string; aspectRatio?: string; chargeCredits?: boolean },
) {
  const parent = await requireCompletedImage(userId, parentImageId);
  const cost = opts.chargeCredits ? creditCost(parent.resolution, 1) : 0;
  if (cost > 0) {
    await chargeWallet(userId, imageSpendCents(parent.resolution, 1), `brand-image-${kind}`);
    await deductCredits(userId, cost, `image-${kind}`);
  }

  const row = await insertImage(userId, {
    kind,
    brandId: parent.brand_id,
    prompt: opts.prompt ?? null,
    aspectRatio: opts.aspectRatio ?? parent.aspect_ratio,
    resolution: parent.resolution,
    parentImageId,
  });
  await imageQueue.add(kind, {
    imageId: row.id,
    userId,
    kind,
    prompt: opts.prompt,
    aspectRatio: opts.aspectRatio ?? parent.aspect_ratio ?? "1:1",
    resolution: parent.resolution,
    brandId: parent.brand_id,
    parentImageId,
    creditsCharged: cost,
  });
  return { id: row.id, status: "pending" as const };
}

export function editImage(userId: string, imageId: string, prompt: string) {
  if (!prompt?.trim()) throw Errors.validation("prompt is required.");
  return createDerived(userId, imageId, "edit", { prompt, chargeCredits: true });
}

export function resizeImage(userId: string, imageId: string, aspectRatio: string) {
  if (!aspectRatio?.trim()) throw Errors.validation("aspectRatio is required.");
  return createDerived(userId, imageId, "resize", { aspectRatio, chargeCredits: true });
}

export function removeBackground(userId: string, imageId: string) {
  return createDerived(userId, imageId, "background-removal", { chargeCredits: true });
}

export function vectorizeImage(userId: string, imageId: string) {
  return createDerived(userId, imageId, "vectorize", { chargeCredits: true });
}

/* ------------------------------------------------------------------ */
/* Uploads (URL) — multipart file upload is a TODO (@fastify/multipart) */
/* ------------------------------------------------------------------ */

export async function uploadFromUrl(userId: string, url: string, brandSessionId?: string) {
  try {
    new URL(url);
  } catch {
    throw Errors.validation(`"${url}" is not a valid URL.`);
  }
  if (brandSessionId) await requireReadyBrand(userId, brandSessionId);
  const row = await insertImage(userId, {
    kind: "upload",
    brandId: brandSessionId ?? null,
  });
  await imageQueue.add("upload", {
    imageId: row.id,
    userId,
    kind: "upload",
    brandId: brandSessionId ?? null,
    sourceUrl: url,
  });
  return { id: row.id, status: "pending" as const };
}

/* ------------------------------------------------------------------ */
/* Reads — GET /images/{id}?wait=true long-polls (55s deadline)        */
/* ------------------------------------------------------------------ */

export async function getImage(userId: string, imageId: string, wait = false) {
  const deadline = Date.now() + LONG_POLL_DEADLINE_MS;
  for (;;) {
    const { rows } = await pool.query<ImageRow>(
      "SELECT * FROM images WHERE id = $1 AND user_id = $2",
      [imageId, userId],
    );
    if (!rows[0]) throw Errors.imageNotFound(imageId);
    const row = rows[0];
    const terminal = row.status === "completed" || row.status === "failed";
    if (!wait || terminal || Date.now() >= deadline) return serialize(row);
    await sleep(LONG_POLL_INTERVAL_MS);
  }
}

export async function listImages(
  userId: string,
  filters: { brandSessionId?: string; status?: string; limit?: number; q?: string } = {},
) {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const conditions = ["user_id = $1"];
  const params: unknown[] = [userId];
  if (filters.brandSessionId) {
    params.push(filters.brandSessionId);
    conditions.push(`brand_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filters.q?.trim()) {
    // Plain-language search over prompts. Each word must appear somewhere in
    // the prompt (order-free). Upgrade path: pgvector + CLIP embeddings.
    for (const word of filters.q.trim().split(/\s+/).slice(0, 8)) {
      params.push(`%${word}%`);
      conditions.push(`prompt ILIKE $${params.length}`);
    }
  }
  params.push(limit);
  const { rows } = await pool.query<ImageRow>(
    `SELECT * FROM images WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map(serialize);
}

/** For GET /img/:id — public, unauthenticated raw image bytes. */
export async function getImageFile(imageId: string) {
  const { rows } = await pool.query<ImageRow>(
    "SELECT * FROM images WHERE id = $1",
    [imageId],
  );
  if (!rows[0]?.storage_path || rows[0].status !== "completed") return null;
  return { storagePath: rows[0].storage_path, mimeType: rows[0].mime_type ?? "image/png" };
}
