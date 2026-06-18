import { pool } from "../lib/db.js";
import { Errors } from "../lib/errors.js";
import { assertProviderCap, addProviderSpend, extractionProviderName } from "../lib/providerCap.js";
import { brandQueue } from "../queue/queues.js";
import { publicUrl } from "../providers/storage.js";
import type { BrandProfile } from "../providers/imageProvider.js";

export interface BrandRow {
  id: string;
  url: string;
  name: string | null;
  status: string;
  profile: BrandProfile | null;
  logo_image_id: string | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

function serialize(row: BrandRow) {
  return {
    id: row.id,
    url: row.url,
    name: row.name,
    status: row.status,
    profile: row.profile,
    logoUrl: row.logo_image_id ? publicUrl(row.logo_image_id) : null,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createBrand(userId: string, url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw Errors.validation(`"${url}" is not a valid URL.`);
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw Errors.validation("Brand URL must be http(s).");
  }
  // Trial cap: brand extraction runs one LLM distill pass (~$0.03) on its provider.
  const capProvider = extractionProviderName();
  await assertProviderCap(userId, capProvider, 3);

  const { rows } = await pool.query<BrandRow>(
    "INSERT INTO brands (user_id, url, status) VALUES ($1, $2, 'analyzing') RETURNING *",
    [userId, parsed.toString()],
  );
  const brand = rows[0];
  await brandQueue.add("onboard", { brandId: brand.id, url: brand.url });
  await addProviderSpend(userId, capProvider, 3);
  return serialize(brand);
}

export async function getBrand(userId: string, brandId: string) {
  const { rows } = await pool.query<BrandRow>(
    "SELECT * FROM brands WHERE id = $1 AND user_id = $2",
    [brandId, userId],
  );
  if (!rows[0]) throw Errors.brandNotFound(brandId);
  return serialize(rows[0]);
}

export async function listBrands(userId: string) {
  const { rows } = await pool.query<BrandRow>(
    "SELECT * FROM brands WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100",
    [userId],
  );
  return rows.map(serialize);
}

/** Seamless brand updates: merge changes into the profile JSONB. */
export async function updateBrand(
  userId: string,
  brandId: string,
  patch: { name?: string; profile?: Partial<BrandProfile> },
) {
  const { rows } = await pool.query<BrandRow>(
    "SELECT * FROM brands WHERE id = $1 AND user_id = $2",
    [brandId, userId],
  );
  if (!rows[0]) throw Errors.brandNotFound(brandId);
  const merged = { ...(rows[0].profile ?? {}), ...(patch.profile ?? {}) };
  const { rows: updated } = await pool.query<BrandRow>(
    "UPDATE brands SET profile = $2, name = COALESCE($3, name), updated_at = now() WHERE id = $1 RETURNING *",
    [brandId, JSON.stringify(merged), patch.name ?? null],
  );
  return serialize(updated[0]);
}

/** Internal: throws unless the brand exists, belongs to the user, and is ready. */
export async function requireReadyBrand(userId: string, brandId: string): Promise<BrandRow> {
  const { rows } = await pool.query<BrandRow>(
    "SELECT * FROM brands WHERE id = $1 AND user_id = $2",
    [brandId, userId],
  );
  if (!rows[0]) throw Errors.brandNotFound(brandId);
  if (rows[0].status !== "ready") throw Errors.brandNotReady(brandId, rows[0].status);
  return rows[0];
}
