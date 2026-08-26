import {
  BoundedIdempotencyCache,
  type BoundedIdempotencyCacheOptions
} from "@freebuddy/protocol";

export type HostIdempotencyLookup = { found: true; value: unknown } | { found: false };

export type HostIdempotencyStore = {
  get(key: string): HostIdempotencyLookup;
  put(key: string, value: unknown): void;
};

export function createHostIdempotency(
  store?: HostIdempotencyStore,
  cacheOptions?: BoundedIdempotencyCacheOptions
) {
  const memory = new BoundedIdempotencyCache(cacheOptions);
  const inflight = new Map<string, Promise<unknown>>();

  return {
    run<T>(key: string | undefined, fn: () => Promise<T> | T): Promise<T> {
      if (!key) return Promise.resolve().then(fn);
      const cached = memory.get(key);
      if (cached.found) return Promise.resolve(cached.value as T);
      const persisted = store?.get(key);
      if (persisted?.found) {
        memory.set(key, persisted.value);
        return Promise.resolve(persisted.value as T);
      }
      const pending = inflight.get(key);
      if (pending) return pending as Promise<T>;
      const promise = Promise.resolve()
        .then(fn)
        .then((value) => {
          memory.set(key, value);
          try {
            store?.put(key, value);
          } catch {
            /* persist is best-effort; in-memory and in-flight still hold */
          }
          return value;
        })
        .finally(() => {
          inflight.delete(key);
        });
      inflight.set(key, promise);
      return promise;
    }
  };
}
