import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../lib/env.js";

/**
 * Local-disk storage. Swap for S3 by reimplementing these three functions
 * (saveImage → PutObject, loadImage → GetObject, publicUrl → CloudFront/signed URL).
 */

function extFor(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/svg+xml") return "svg";
  return "png";
}

export async function saveImage(
  id: string,
  data: Buffer,
  mimeType: string,
): Promise<string> {
  const dir = path.resolve(env.storageDir);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${id}.${extFor(mimeType)}`);
  await writeFile(file, data);
  return file;
}

export async function loadImage(storagePath: string): Promise<Buffer> {
  return readFile(storagePath);
}

/** Public URL served by GET /img/:id (no auth). */
export function publicUrl(id: string): string {
  return `${env.baseUrl}/img/${id}`;
}
