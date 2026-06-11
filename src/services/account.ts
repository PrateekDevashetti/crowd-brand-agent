import { pool } from "../lib/db.js";
import { Errors } from "../lib/errors.js";

export async function getAccount(userId: string) {
  const { rows } = await pool.query<{ id: string; email: string | null; credits: number; created_at: Date }>(
    "SELECT id, email, credits, created_at FROM users WHERE id = $1",
    [userId],
  );
  if (!rows[0]) throw Errors.unauthorized();
  return {
    id: rows[0].id,
    email: rows[0].email,
    credits: rows[0].credits,
    createdAt: rows[0].created_at,
  };
}

export async function getCredits(userId: string) {
  const account = await getAccount(userId);
  const { rows } = await pool.query<{ id: string; amount: number; reason: string; image_id: string | null; created_at: Date }>(
    "SELECT id, amount, reason, image_id, created_at FROM credit_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50",
    [userId],
  );
  return {
    credits: account.credits,
    ledger: rows.map((r) => ({
      id: r.id,
      amount: r.amount,
      reason: r.reason,
      imageId: r.image_id,
      createdAt: r.created_at,
    })),
  };
}
