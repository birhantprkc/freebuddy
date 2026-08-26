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

test("delegation follow-up can complete again after a persisted completed status", async () => {
  const { createHostBackedPorts } = await import(
    "../packages/runtime-entry/dist/rpc/hostPorts.js"
  );
  const { createHostIdempotency } = await import("../packages/runtime-host/dist/index.js");
  const idem = createHostIdempotency();
  const writes = [];
  const peer = {
    async request(method, params, options) {
      if (method !== "host.invoke") return null;
      const body = params ?? {};
      return idem.run(options?.idempotencyKey, async () => {
        writes.push({
          method: body.method,
          args: body.args,
          key: options?.idempotencyKey
        });
        return true;
      });
    },
    onEvent() {
      return () => {};
    }
  };
  const { delegation, controller } = createHostBackedPorts(peer);
  const run = delegation.repository.createRun({
    goal: "g",
    status: "running",
    teamId: "t",
    teamSnapshotJson: "{}"
  });
  const eventId = delegation.repository.insertEvent({
    runId: run.id,
    parentEventId: null,
    agentId: "a",
    agentName: "a",
    roleLabel: "a",
    taskText: "t",
    depth: 0,
    canWrite: false,
    status: "running"
  });
  delegation.repository.transitionEvent(eventId, "done", "first");
  delegation.repository.setStatus(run.id, "completed");
  await controller.flush();

  delegation.repository.transitionEvent(eventId, "running", null, { allowReopen: true });
  delegation.repository.setStatus(run.id, "running", { allowReopen: true });
  delegation.repository.transitionEvent(eventId, "done", "follow-up");
  delegation.repository.setStatus(run.id, "completed");
  await controller.flush();

  const setStatus = writes.filter((row) => row.method === "delegation.repository.v1.setStatus");
  const transitions = writes.filter(
    (row) => row.method === "delegation.repository.v1.transitionEvent"
  );
  assert.equal(setStatus.length, 3);
  assert.equal(transitions.length, 3);
  assert.equal(new Set(setStatus.map((row) => row.key)).size, 3);
  assert.equal(new Set(transitions.map((row) => row.key)).size, 3);
  assert.deepEqual(
    setStatus.map((row) => row.args[1]),
    ["completed", "running", "completed"]
  );
  assert.deepEqual(
    transitions.map((row) => row.args[1]),
    ["done", "running", "done"]
  );
  assert.equal(delegation.repository.getRun(run.id)?.status, "completed");
});
