import { pool } from "./db.js";
import { Errors } from "./errors.js";

/** Bloom pricing: 2K = 1 credit, 4K = 2 credits, per variant. */
export function creditCost(resolution: string, variants = 1): number {
  const perVariant = resolution === "4K" ? 2 : 1;
  return perVariant * Math.max(1, variants);
}

/** Atomic deduction with ledger entry. Throws INSUFFICIENT_CREDITS (402). */
export async function deductCredits(
  userId: string,
  amount: number,
  reason: string,
  imageId?: string,
): Promise<void> {
  if (amount <= 0) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ credits: number }>(
      "UPDATE users SET credits = credits - $2 WHERE id = $1 AND credits >= $2 RETURNING credits",
      [userId, amount],
    );
    if (!rows[0]) {
      const cur = await client.query<{ credits: number }>(
        "SELECT credits FROM users WHERE id = $1",
        [userId],
      );
      await client.query("ROLLBACK");
      throw Errors.insufficientCredits(amount, cur.rows[0]?.credits ?? 0);
    }
    await client.query(
      "INSERT INTO credit_events (user_id, amount, reason, image_id) VALUES ($1, $2, $3, $4)",
      [userId, -amount, reason, imageId ?? null],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Refund (e.g. when a job fails after deduction). */
export async function refundCredits(
  userId: string,
  amount: number,
  reason: string,
  imageId?: string,
): Promise<void> {
  if (amount <= 0) return;
  await pool.query("UPDATE users SET credits = credits + $2 WHERE id = $1", [
    userId,
    amount,
  ]);
  await pool.query(
    "INSERT INTO credit_events (user_id, amount, reason, image_id) VALUES ($1, $2, $3, $4)",
    [userId, amount, reason, imageId ?? null],
  );
}
