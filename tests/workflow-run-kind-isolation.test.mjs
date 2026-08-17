import "./fixtures/electron-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";

let Database,
  bindingAvailable = true;
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

const CONV = "conv-isolation-1";

async function seedRuns() {
  const { createWorkflowRun } = await import("../dist-electron/cli/workflows.js");
  const { createDelegationRun } = await import(
    "../dist-electron/cli/delegationRuns.js"
  );
  const wfId = createWorkflowRun({
    id: "wf-run-1",
    conversationId: CONV,
    name: "wf",
    goal: "g",
    maxLoops: 1,
    planJson: JSON.stringify({ phases: [] })
  }).id;
  // delegation run shares workflow_runs table: kind='delegation', plan_json='{}', status='running'
  const delId = createDelegationRun({
    goal: "g",
    teamId: "t",
    teamSnapshotJson: "{}",
    conversationId: CONV
  });
  return { wfId, delId };
}

test("listWorkflowRunsByConversation excludes delegation-kind runs", async (t) => {
  if (!bindingAvailable) {
    t.skip();
    return;
  }
  await withDb(async () => {
    const { listWorkflowRunsByConversation } = await import(
      "../dist-electron/cli/workflows.js"
    );
    const { wfId, delId } = await seedRuns();
    const ids = listWorkflowRunsByConversation(CONV).map((r) => r.id);
    assert.ok(ids.includes(wfId), "workflow run should be present");
    assert.ok(
      !ids.includes(delId),
      "delegation run must NOT leak into workflow listing"
    );
  });
});

test("listActiveWorkflowRuns excludes delegation-kind runs", async (t) => {
  if (!bindingAvailable) {
    t.skip();
    return;
  }
  await withDb(async () => {
    const { listActiveWorkflowRuns } = await import(
      "../dist-electron/cli/workflows.js"
    );
    const { wfId, delId } = await seedRuns();
    const ids = listActiveWorkflowRuns().map((r) => r.id);
    assert.ok(ids.includes(wfId), "workflow run should be in active set");
    assert.ok(
      !ids.includes(delId),
      "delegation run must NOT leak into active workflow runs"
    );
  });
});

test("recoverInterruptedWorkflowRuns ignores delegation-kind runs", async (t) => {
  if (!bindingAvailable) {
    t.skip();
    return;
  }
  await withDb(async () => {
    const { recoverInterruptedWorkflowRuns } = await import(
      "../dist-electron/cli/workflows.js"
    );
    const { getDelegationRun } = await import(
      "../dist-electron/cli/delegationRuns.js"
    );
    const { delId } = await seedRuns();
    // delegation run is created with status='running' — recoverInterruptedWorkflowRuns
    // must NOT sweep it (it has its own recoverInterruptedDelegationRuns).
    const swept = recoverInterruptedWorkflowRuns();
    assert.equal(swept, 0, "no workflow runs should be swept");
    assert.equal(
      getDelegationRun(delId).status,
      "running",
      "delegation run status must be untouched"
    );
  });
});
