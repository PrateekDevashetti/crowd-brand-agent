import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { env } from "../lib/env.js";

/**
 * Image storage. Uses Cloudflare R2 (S3-compatible) when all R2 env vars are
 * set — required in Railway where the API and worker are separate containers
 * with separate local filesystems. Falls back to local disk for Docker dev.
 *
 * R2: saveImage → PutObject, loadImage → GetObject, publicUrl → BASE_URL/img/:id.
 */

const r2Enabled = Boolean(
  env.r2AccountId &&
    env.r2AccessKeyId &&
    env.r2SecretAccessKey &&
    env.r2Bucket &&
    env.r2PublicUrl,
);

let r2: S3Client | null = null;
function r2Client(): S3Client {
  if (!r2) {
    r2 = new S3Client({
      region: "auto",
      endpoint: `https://${env.r2AccountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.r2AccessKeyId,
        secretAccessKey: env.r2SecretAccessKey,
      },
    });
  }
  return r2;
}

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
  if (r2Enabled) {
    const key = `brand-agent/images/${id}.${extFor(mimeType)}`;
    await r2Client().send(
      new PutObjectCommand({
        Bucket: env.r2Bucket,
        Key: key,
        Body: data,
        ContentType: mimeType,
      }),
    );
    return key;
  }

  const dir = path.resolve(env.storageDir);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${id}.${extFor(mimeType)}`);
  await writeFile(file, data);
  return file;
}

export async function loadImage(storagePath: string): Promise<Buffer> {
  if (r2Enabled) {
    const res = await r2Client().send(
      new GetObjectCommand({ Bucket: env.r2Bucket, Key: storagePath }),
    );
    const bytes = await res.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }

  return readFile(storagePath);
}

/** Public URL served by GET /img/:id (no auth). DB lookup by id is still needed. */
export function publicUrl(id: string): string {
  return `${env.baseUrl}/img/${id}`;
}
