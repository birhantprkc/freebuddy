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

async function withDb(fn) {
  const db = new Database(":memory:");
  const { migrate, setDbForTest } = await import("../dist-electron/cli/db.js");
  migrate(db);
  setDbForTest(db);
  try {
    await fn(db);
  } finally {
    setDbForTest(null);
    db.close();
  }
}

test("migration adds kind and delegation_meta_json to workflow_teams", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  await withDb((db) => {
    const cols = db.prepare("PRAGMA table_info(workflow_teams)").all().map((c) => c.name);
    assert.ok(cols.includes("kind"), "workflow_teams.kind missing");
    assert.ok(cols.includes("delegation_meta_json"), "workflow_teams.delegation_meta_json missing");
  });
});

test("migration adds kind to workflow_runs", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  await withDb((db) => {
    const cols = db.prepare("PRAGMA table_info(workflow_runs)").all().map((c) => c.name);
    assert.ok(cols.includes("kind"), "workflow_runs.kind missing");
  });
});

test("migration creates delegation_events table with expected columns", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  await withDb((db) => {
    const cols = db.prepare("PRAGMA table_info(delegation_events)").all().map((c) => c.name);
    for (const name of [
      "id", "run_id", "parent_event_id", "agent_id", "agent_name", "role_label",
      "task_text", "depth", "status", "result_summary", "can_write",
      "started_at", "ended_at"
    ]) {
      assert.ok(cols.includes(name), `delegation_events.${name} missing`);
    }
  });
});
