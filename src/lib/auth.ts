import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { pool } from "./db.js";
import { DEV_USER_ID, env } from "./env.js";
import { Errors } from "./errors.js";

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
  }
}

/** Accepts `x-api-key: <key>` or `Authorization: Bearer <key>`. */
export function extractKey(headers: Record<string, unknown>): string | undefined {
  const raw = (headers["x-api-key"] ?? headers["authorization"]) as
    | string
    | string[]
    | undefined;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.replace(/^Bearer\s+/i, "").trim() || undefined;
}

/** Verify a Clerk session JWT and find-or-create the matching user. */
async function resolveClerkUser(token: string): Promise<string | null> {
  if (!env.clerkSecretKey) return null;
  try {
    const { verifyToken } = await import("@clerk/backend");
    const payload = await verifyToken(token, { secretKey: env.clerkSecretKey });
    const clerkId = payload.sub;
    if (!clerkId) return null;
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (clerk_id, email, credits)
       VALUES ($1, $2, 100)
       ON CONFLICT (clerk_id) DO UPDATE SET clerk_id = EXCLUDED.clerk_id
       RETURNING id`,
      [clerkId, (payload as { email?: string }).email ?? null],
    );
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

/** Resolve an API key or Clerk session token to a user id. Throws UNAUTHORIZED on failure. */
export async function resolveUserId(key: string | undefined): Promise<string> {
  if (!key) throw Errors.unauthorized();
  if (env.devApiKey && key === env.devApiKey) return DEV_USER_ID;
  // Clerk session tokens are JWTs (three dot-separated base64 segments)
  if (key.split(".").length === 3) {
    const clerkUser = await resolveClerkUser(key);
    if (clerkUser) return clerkUser;
  }
  const hash = createHash("sha256").update(key).digest("hex");
  const { rows } = await pool.query<{ user_id: string }>(
    "UPDATE api_keys SET last_used_at = now() WHERE key_hash = $1 RETURNING user_id",
    [hash],
  );
  if (!rows[0]) throw Errors.unauthorized();
  return rows[0].user_id;
}

/** Fastify preHandler — attaches req.userId. */
export async function authenticate(req: FastifyRequest): Promise<void> {
  req.userId = await resolveUserId(extractKey(req.headers as Record<string, unknown>));
}
