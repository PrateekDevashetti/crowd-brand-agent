import { pool } from "./db.js";
import { ApiError } from "./errors.js";

// Per-user, per-provider trial spend cap: $3 per provider over a rolling 10-day
// window. Mirrors canopy-api's guardrail so Brand Agent usage is capped too.
const CAP_CENTS = Number(process.env.TRIAL_PROVIDER_CAP_CENTS ?? 300);
const WINDOW_DAYS = Number(process.env.TRIAL_CAP_WINDOW_DAYS ?? 10);

export function imageProviderName(): string {
  const p = (process.env.IMAGE_PROVIDER ?? "").toLowerCase();
  if (p === "openai" || p === "openrouter" || p === "gemini") return p;
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "openrouter";
}

export function extractionProviderName(): string {
  return process.env.ANTHROPIC_API_KEY ? "anthropic" : imageProviderName();
}

// Rough $ for the trial cap (credits → cents): 2K ≈ $0.06, 4K ≈ $0.12 per variant.
export function imageSpendCents(resolution: string, variants = 1): number {
  return (resolution === "4K" ? 12 : 6) * Math.max(1, variants);
}

export async function assertProviderCap(userId: string, provider: string, addCents: number): Promise<void> {
  if (!userId) return;
  await pool.query(
    `UPDATE provider_spend SET cost_cents = 0, window_start = now()
       WHERE user_id = $1 AND provider = $2 AND window_start < now() - make_interval(days => $3)`,
    [userId, provider, WINDOW_DAYS],
  );
  const { rows } = await pool.query<{ cost_cents: number }>(
    `SELECT cost_cents FROM provider_spend WHERE user_id = $1 AND provider = $2`,
    [userId, provider],
  );
  const spent = Number(rows[0]?.cost_cents ?? 0);
  if (spent + addCents > CAP_CENTS) {
    throw new ApiError(
      "TRIAL_LIMIT_REACHED",
      402,
      `Trial limit reached: $${(spent / 100).toFixed(2)} of $${(CAP_CENTS / 100).toFixed(2)} ${provider} used (resets every ${WINDOW_DAYS} days).`,
      { provider, spentCents: spent, capCents: CAP_CENTS, windowDays: WINDOW_DAYS },
    );
  }
}

export async function addProviderSpend(userId: string, provider: string, cents: number): Promise<void> {
  if (!userId || !cents) return;
  await pool.query(
    `INSERT INTO provider_spend (user_id, provider, cost_cents) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, provider) DO UPDATE SET cost_cents = provider_spend.cost_cents + $3`,
    [userId, provider, cents],
  );
}
