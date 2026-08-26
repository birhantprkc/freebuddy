import test from "node:test";
import assert from "node:assert/strict";
import { BoundedIdempotencyCache } from "../packages/protocol/dist/index.js";

test("idempotency cache evicts the oldest entry when over capacity", () => {
  const cache = new BoundedIdempotencyCache({ maxEntries: 2, ttlMs: 60_000 });
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);
  assert.equal(cache.size, 2);
  assert.equal(cache.get("a").found, false);
  assert.deepEqual(cache.get("b"), { found: true, value: 2 });
  assert.deepEqual(cache.get("c"), { found: true, value: 3 });
});

test("idempotency cache expires entries by ttl", async () => {
  const cache = new BoundedIdempotencyCache({ maxEntries: 8, ttlMs: 20 });
  cache.set("k", "live");
  assert.deepEqual(cache.get("k"), { found: true, value: "live" });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(cache.get("k").found, false);
  assert.equal(cache.size, 0);
});
