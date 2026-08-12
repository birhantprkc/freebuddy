import "./fixtures/electron-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";

let Database, bindingAvailable = true;
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
    await fn();
  } finally {
    setDbForTest(null);
    db.close();
  }
}

test("delegation_events stores verdict fields", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun, insertDelegationEvent, updateDelegationEvent, getDelegationEvent } =
      await import("../dist-electron/cli/delegationRuns.js");
    const runId = createDelegationRun({ goal: "g", teamId: "t", teamSnapshotJson: "{}" });
    const id = insertDelegationEvent({
      runId,
      parentEventId: null,
      agentId: "a",
      agentName: "评审",
      roleLabel: "评审",
      taskText: "审",
      depth: 1,
      canWrite: false,
      status: "running"
    });
    const before = getDelegationEvent(id);
    assert.equal(before.verdict, null);
    assert.equal(before.verdictSummary, null);
    updateDelegationEvent(id, { verdict: "needs_changes", verdictSummary: "fix toast" });
    const after = getDelegationEvent(id);
    assert.equal(after.verdict, "needs_changes");
    assert.equal(after.verdictSummary, "fix toast");
  });
});
