export const IDEMPOTENCY_CACHE_MAX_ENTRIES = 512;
export const IDEMPOTENCY_CACHE_TTL_MS = 10 * 60 * 1000;

export type BoundedIdempotencyCacheOptions = {
  maxEntries?: number;
  ttlMs?: number;
};

export type BoundedIdempotencyLookup = { found: true; value: unknown } | { found: false };

type CacheEntry = { value: unknown; expiresAt: number };

export class BoundedIdempotencyCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(options?: BoundedIdempotencyCacheOptions) {
    this.maxEntries = Math.max(1, options?.maxEntries ?? IDEMPOTENCY_CACHE_MAX_ENTRIES);
    this.ttlMs = options?.ttlMs ?? IDEMPOTENCY_CACHE_TTL_MS;
  }

  get(key: string): BoundedIdempotencyLookup {
    const entry = this.entries.get(key);
    if (!entry) return { found: false };
    if (Date.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return { found: false };
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { found: true, value: entry.value };
  }

  set(key: string, value: unknown): void {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
