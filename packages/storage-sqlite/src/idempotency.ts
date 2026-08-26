import type { SqliteStoreContext } from "./types.js";

export const HOST_IDEMPOTENCY_TABLE_SQL = `CREATE TABLE IF NOT EXISTS host_idempotency_keys (
  key TEXT PRIMARY KEY,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
)`;

export const HOST_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export type HostIdempotencyLookup = { found: true; value: unknown } | { found: false };

function nowIso(ctx: SqliteStoreContext): string {
  return ctx.nowIso?.() ?? new Date().toISOString();
}

function cutoffIso(now: string, ttlMs: number): string {
  return new Date(Date.parse(now) - ttlMs).toISOString();
}

export function pruneHostIdempotencyResults(
  ctx: SqliteStoreContext,
  ttlMs = HOST_IDEMPOTENCY_TTL_MS
): number {
  const cutoff = cutoffIso(nowIso(ctx), ttlMs);
  return ctx.db.prepare("DELETE FROM host_idempotency_keys WHERE created_at < ?").run(cutoff)
    .changes;
}

export function getHostIdempotencyResult(
  ctx: SqliteStoreContext,
  key: string,
  ttlMs = HOST_IDEMPOTENCY_TTL_MS
): HostIdempotencyLookup {
  const row = ctx.db
    .prepare("SELECT result_json, created_at FROM host_idempotency_keys WHERE key = ?")
    .get(key) as { result_json: string; created_at: string } | undefined;
  if (!row) return { found: false };
  if (row.created_at < cutoffIso(nowIso(ctx), ttlMs)) {
    ctx.db.prepare("DELETE FROM host_idempotency_keys WHERE key = ?").run(key);
    return { found: false };
  }
  try {
    return { found: true, value: JSON.parse(row.result_json) as unknown };
  } catch {
    return { found: true, value: null };
  }
}

export function putHostIdempotencyResult(
  ctx: SqliteStoreContext,
  key: string,
  value: unknown,
  ttlMs = HOST_IDEMPOTENCY_TTL_MS
): void {
  pruneHostIdempotencyResults(ctx, ttlMs);
  ctx.db
    .prepare(
      `INSERT INTO host_idempotency_keys (key, result_json, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         result_json = excluded.result_json,
         created_at = excluded.created_at`
    )
    .run(key, JSON.stringify(value ?? null), nowIso(ctx));
}
