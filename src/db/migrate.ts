import { readFileSync } from "node:fs";
import path from "node:path";
import { pool } from "../lib/db.js";

/**
 * Apply schema.sql on boot. Idempotent (CREATE TABLE IF NOT EXISTS throughout),
 * so both the API and the worker can call it safely — removes the manual
 * `psql -f schema.sql` step.
 */
export async function applySchema(): Promise<void> {
  const schemaPath = path.resolve(process.cwd(), "src/db/schema.sql");
  const sql = readFileSync(schemaPath, "utf8");
  await pool.query(sql);
  console.log("[brandlayer] database schema applied");
}
