import test from "node:test";
import assert from "node:assert/strict";
import { createHostIdempotency } from "../packages/runtime-host/dist/index.js";
import {
  HOST_IDEMPOTENCY_TABLE_SQL,
  getHostIdempotencyResult,
  putHostIdempotencyResult
} from "../packages/storage-sqlite/dist/index.js";

test("host idempotency coalesces in-flight work for the same key", async () => {
  let runs = 0;
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const idem = createHostIdempotency();
  const work = async () => {
    runs += 1;
    await blocked;
    return `done-${runs}`;
  };
  const first = idem.run("agent.execute:same", work);
  const second = idem.run("agent.execute:same", work);
  release();
  assert.equal(await first, "done-1");
  assert.equal(await second, "done-1");
  assert.equal(runs, 1);
});

test("host idempotency store survives a new guard instance", async (t) => {
  let Database;
  try {
    Database = (await import("better-sqlite3")).default;
    new Database(":memory:").close();
  } catch {
    t.skip("better-sqlite3 native binding unavailable");
    return;
  }
  const db = new Database(":memory:");
  db.exec(HOST_IDEMPOTENCY_TABLE_SQL);
  const ctx = { db, owner: { ownerUserId: null, isAdmin: true } };
  const store = {
    get(key) {
      return getHostIdempotencyResult(ctx, key);
    },
    put(key, value) {
      putHostIdempotencyResult(ctx, key, value);
    }
  };
  const first = createHostIdempotency(store);
  let runs = 0;
  assert.deepEqual(
    await first.run("workflow.createStep:step-1", () => {
      runs += 1;
      return { ok: true, id: "step-1" };
    }),
    { ok: true, id: "step-1" }
  );
  const restarted = createHostIdempotency(store);
  assert.deepEqual(
    await restarted.run("workflow.createStep:step-1", () => {
      runs += 1;
      return { ok: true, id: "should-not-run" };
    }),
    { ok: true, id: "step-1" }
  );
  assert.equal(runs, 1);
  db.close();
});
