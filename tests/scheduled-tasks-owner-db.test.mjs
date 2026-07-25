import "./fixtures/electron-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";

let Database;
let bindingAvailable = true;
try {
  Database = (await import("better-sqlite3")).default;
  new Database(":memory:").close();
} catch {
  bindingAvailable = false;
}

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  return db;
}

function insertTask(db, id, ownerId) {
  db.prepare(
    `INSERT INTO scheduled_tasks
       (id, title, prompt, agent_id, time_local, schedule_type,
        execution_mode, enabled, last_status, owner_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'idle', ?, ?, ?)`
  ).run(id, "t-" + id, "p", "agent", "09:00", "daily", "new_conversation", ownerId, "0", "0");
}

test("scheduled tasks are isolated per user; admin sees all", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  const db = makeDb();
  const { migrate, setDbForTest } = await import("../dist-electron/cli/db.js");
  migrate(db);
  setDbForTest(db);
  const { listScheduledTasks, requireOwnedScheduledTask } =
    await import("../dist-electron/cli/scheduledTasks.js");
  const { runAsCaller } = await import("../dist-electron/cli/callerContext.js");

  insertTask(db, "a1", "alice");

  assert.equal(runAsCaller("alice", () => listScheduledTasks().length), 1);
  assert.equal(runAsCaller("bob", () => listScheduledTasks().length), 0, "bob cannot see alice's task");
  assert.equal(runAsCaller("owner", () => listScheduledTasks().length, true), 1, "admin sees all");
  assert.equal(listScheduledTasks().length, 1, "no caller (internal) sees all");

  assert.equal(runAsCaller("alice", () => requireOwnedScheduledTask("a1")?.id), "a1");
  assert.equal(runAsCaller("bob", () => requireOwnedScheduledTask("a1")), undefined, "bob cannot access alice's task");
  assert.equal(runAsCaller("owner", () => requireOwnedScheduledTask("a1")?.id, true), "a1");
});

test("scheduled task ownership gates delete/update/run via requireOwnedScheduledTask", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  const db = makeDb();
  const { migrate, setDbForTest } = await import("../dist-electron/cli/db.js");
  migrate(db);
  setDbForTest(db);
  const { requireOwnedScheduledTask } = await import("../dist-electron/cli/scheduledTasks.js");
  const { runAsCaller } = await import("../dist-electron/cli/callerContext.js");

  insertTask(db, "a1", "alice");

  // The IPC handlers gate delete/update/run on requireOwnedScheduledTask; bob
  // resolving to undefined means the handler short-circuits (no-op / false).
  assert.equal(runAsCaller("bob", () => requireOwnedScheduledTask("a1")), undefined);
  assert.equal(runAsCaller("alice", () => requireOwnedScheduledTask("a1")?.id), "a1");
});
