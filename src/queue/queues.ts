import { Queue, type ConnectionOptions } from "bullmq";
import { env } from "../lib/env.js";

/* Plain options (not an ioredis instance) — avoids dual-ioredis type clashes
   between our dependency tree and bullmq's nested copy. */
const redisUrl = new URL(env.redisUrl);
export const connection: ConnectionOptions = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || "6379"),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  db: Number(redisUrl.pathname.slice(1) || "0"),
  maxRetriesPerRequest: null,
};

export type ImageKind =
  | "generation"
  | "edit"
  | "resize"
  | "background-removal"
  | "vectorize"
  | "upload";

export interface BrandJobData {
  brandId: string;
  url: string;
}

export interface ImageJobData {
  imageId: string;
  userId: string;
  kind: ImageKind;
  prompt?: string;
  aspectRatio?: string;
  resolution?: string;
  brandId?: string | null;
  parentImageId?: string | null;
  referenceImageIds?: string[];
  sourceUrl?: string; // for kind=upload
  creditsCharged?: number; // refunded on failure
}

export const BRAND_QUEUE = "brand-jobs";
export const IMAGE_QUEUE = "image-jobs";

export const brandQueue = new Queue<BrandJobData>(BRAND_QUEUE, { connection });
export const imageQueue = new Queue<ImageJobData>(IMAGE_QUEUE, { connection });
