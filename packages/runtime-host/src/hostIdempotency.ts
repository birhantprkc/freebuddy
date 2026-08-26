export type HostIdempotencyLookup = { found: true; value: unknown } | { found: false };

export type HostIdempotencyStore = {
  get(key: string): HostIdempotencyLookup;
  put(key: string, value: unknown): void;
};

export function createHostIdempotency(store?: HostIdempotencyStore) {
  const memory = new Map<string, unknown>();
  const inflight = new Map<string, Promise<unknown>>();

  return {
    run<T>(key: string | undefined, fn: () => Promise<T> | T): Promise<T> {
      if (!key) return Promise.resolve().then(fn);
      if (memory.has(key)) return Promise.resolve(memory.get(key) as T);
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
