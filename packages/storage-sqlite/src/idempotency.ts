import type { SqliteStoreContext } from "./types.js";

export const HOST_IDEMPOTENCY_TABLE_SQL = `CREATE TABLE IF NOT EXISTS host_idempotency_keys (
  key TEXT PRIMARY KEY,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
)`;

export const HOST_IDEMPOTENCY_CREATED_AT_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_host_idempotency_keys_created_at
  ON host_idempotency_keys(created_at)`;

export const HOST_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
export const HOST_IDEMPOTENCY_PRUNE_INTERVAL_MS = 10 * 60 * 1000;

export type HostIdempotencyLookup = { found: true; value: unknown } | { found: false };

const lastFullPruneAtMs = new WeakMap<object, number>();

function nowIso(ctx: SqliteStoreContext): string {
  return ctx.nowIso?.() ?? new Date().toISOString();
}

function nowMs(ctx: SqliteStoreContext): number {
  const parsed = Date.parse(nowIso(ctx));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function cutoffIso(now: string, ttlMs: number): string {
  return new Date(Date.parse(now) - ttlMs).toISOString();
}

function dbIdentity(ctx: SqliteStoreContext): object {
  return ctx.db as object;
}

function shouldFullPrune(ctx: SqliteStoreContext, intervalMs: number): boolean {
  const last = lastFullPruneAtMs.get(dbIdentity(ctx));
  if (last === undefined) return true;
  return nowMs(ctx) - last >= intervalMs;
}

function markFullPrune(ctx: SqliteStoreContext): void {
  lastFullPruneAtMs.set(dbIdentity(ctx), nowMs(ctx));
}

export function installHostIdempotencySchema(db: { exec(sql: string): void }): void {
  db.exec(`${HOST_IDEMPOTENCY_TABLE_SQL};\n${HOST_IDEMPOTENCY_CREATED_AT_INDEX_SQL}`);
}

export function pruneHostIdempotencyResults(
  ctx: SqliteStoreContext,
  ttlMs = HOST_IDEMPOTENCY_TTL_MS
): number {
  const cutoff = cutoffIso(nowIso(ctx), ttlMs);
  const changes = ctx.db
    .prepare("DELETE FROM host_idempotency_keys WHERE created_at < ?")
    .run(cutoff).changes;
  markFullPrune(ctx);
  return changes;
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

function upsertHostIdempotencyResult(
  ctx: SqliteStoreContext,
  key: string,
  value: unknown
): void {
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

export function putHostIdempotencyResult(
  ctx: SqliteStoreContext,
  key: string,
  value: unknown,
  ttlMs = HOST_IDEMPOTENCY_TTL_MS
): void {
  const write = (): void => {
    if (shouldFullPrune(ctx, HOST_IDEMPOTENCY_PRUNE_INTERVAL_MS)) {
      pruneHostIdempotencyResults(ctx, ttlMs);
    }
    upsertHostIdempotencyResult(ctx, key, value);
  };
  if (typeof ctx.db.transaction === "function") {
    ctx.db.transaction(write)();
    return;
  }
  write();
}
