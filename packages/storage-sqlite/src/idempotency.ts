import type { SqliteStoreContext } from "./types.js";

export const HOST_IDEMPOTENCY_TABLE_SQL = `CREATE TABLE IF NOT EXISTS host_idempotency_keys (
  key TEXT PRIMARY KEY,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
)`;

export type HostIdempotencyLookup = { found: true; value: unknown } | { found: false };

function nowIso(ctx: SqliteStoreContext): string {
  return ctx.nowIso?.() ?? new Date().toISOString();
}

export function getHostIdempotencyResult(
  ctx: SqliteStoreContext,
  key: string
): HostIdempotencyLookup {
  const row = ctx.db
    .prepare("SELECT result_json FROM host_idempotency_keys WHERE key = ?")
    .get(key) as { result_json: string } | undefined;
  if (!row) return { found: false };
  try {
    return { found: true, value: JSON.parse(row.result_json) as unknown };
  } catch {
    return { found: true, value: null };
  }
}

export function putHostIdempotencyResult(
  ctx: SqliteStoreContext,
  key: string,
  value: unknown
): void {
  ctx.db
    .prepare(
      `INSERT INTO host_idempotency_keys (key, result_json, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET result_json = excluded.result_json`
    )
    .run(key, JSON.stringify(value ?? null), nowIso(ctx));
}
