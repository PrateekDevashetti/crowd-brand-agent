import { pool } from "./db.js";
import { ApiError } from "./errors.js";

// Charges the UNIFIED credit wallet that canopy-api owns. crowd users are keyed by a
// local UUID; the wallet is keyed by the Clerk user id, so we map via users.clerk_id.
// No-ops (allow) when unconfigured or unmapped so local/dev still works; throws 402
// when the wallet has insufficient credits.
const CANOPY_API_URL = (process.env.CANOPY_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
const SECRET = process.env.INTERNAL_SERVICE_SECRET ?? "";

async function clerkIdFor(userId: string): Promise<string | null> {
  const { rows } = await pool.query<{ clerk_id: string | null }>(
    "SELECT clerk_id FROM users WHERE id = $1",
    [userId],
  );
  return rows[0]?.clerk_id ?? null;
}

export async function chargeWallet(userId: string, cents: number, reason: string, ref?: string): Promise<void> {
  if (!SECRET || cents <= 0) return;
  const clerkId = await clerkIdFor(userId);
  if (!clerkId) return; // unmapped (dev/local) — don't block
  const res = await fetch(`${CANOPY_API_URL}/api/internal/credits/charge`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-secret": SECRET },
    body: JSON.stringify({ userId: clerkId, cents, reason, ref }),
  }).catch(() => null);
  if (!res) return; // network hiccup — fail open rather than block the user
  if (res.status === 402) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; data?: Record<string, unknown> } };
    throw new ApiError("INSUFFICIENT_CREDITS", 402, body?.error?.message ?? "Not enough credits.", body?.error?.data ?? {});
  }
}

export async function refundWallet(userId: string, cents: number, ref?: string): Promise<void> {
  if (!SECRET || cents <= 0) return;
  const clerkId = await clerkIdFor(userId);
  if (!clerkId) return;
  await fetch(`${CANOPY_API_URL}/api/internal/credits/refund`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-secret": SECRET },
    body: JSON.stringify({ userId: clerkId, cents, ref }),
  }).catch(() => {});
}
