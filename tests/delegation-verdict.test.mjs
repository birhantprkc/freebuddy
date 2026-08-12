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

test("submit_verdict writes and check_delegate_result returns it", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun, insertDelegationEvent, updateDelegationEvent } =
      await import("../dist-electron/cli/delegationRuns.js");
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    const runId = createDelegationRun({ goal: "g", teamId: "t", teamSnapshotJson: "{}" });
    const rootId = insertDelegationEvent({
      runId, parentEventId: null, agentId: "impl", agentName: "实现", roleLabel: "实现",
      taskText: "实现", depth: 0, canWrite: true, status: "running"
    });
    const revId = insertDelegationEvent({
      runId, parentEventId: rootId, agentId: "rev", agentName: "评审", roleLabel: "评审",
      taskText: "审查", depth: 1, canWrite: false, status: "running"
    });
    const binding = {
      token: "t", taskSessionId: "s", runId, parentEventId: revId, depth: 1,
      selfAgentId: "r-rev", selfLabel: "评审"
    };
    const deps = {
      contextProvider: () => undefined,
      executor: async () => ({ summary: "", exitCode: 0, error: null }),
      writeApproval: async () => true
    };
    const submitted = await runDelegateAction(binding, "submit_verdict", {
      verdict: "needs_changes",
      summary: "toast copy"
    }, deps);
    assert.equal(submitted.ok, true);
    assert.equal(submitted.verdict, "needs_changes");
    assert.equal(submitted.event_id, revId);

    updateDelegationEvent(revId, { status: "done", resultSummary: "long review text" });
    const checked = await runDelegateAction(binding, "check_delegate_result", {
      request_id: revId
    }, deps);
    assert.equal(checked.ok, true);
    assert.equal(checked.verdict, "needs_changes");
    assert.equal(checked.verdictSummary, "toast copy");
  });
});

test("submit_verdict rejects invalid enum and allows overwrite", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun, insertDelegationEvent } =
      await import("../dist-electron/cli/delegationRuns.js");
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    const runId = createDelegationRun({ goal: "g", teamId: "t", teamSnapshotJson: "{}" });
    const id = insertDelegationEvent({
      runId, parentEventId: null, agentId: "rev", agentName: "评审", roleLabel: "评审",
      taskText: "审", depth: 1, canWrite: false, status: "running"
    });
    const binding = {
      token: "t", taskSessionId: "s", runId, parentEventId: id, depth: 1,
      selfAgentId: "r-rev", selfLabel: "评审"
    };
    const deps = {
      contextProvider: () => undefined,
      executor: async () => ({ summary: "", exitCode: 0, error: null }),
      writeApproval: async () => true
    };
    const bad = await runDelegateAction(binding, "submit_verdict", { verdict: "lgtm" }, deps);
    assert.equal(bad.ok, false);
    const first = await runDelegateAction(binding, "submit_verdict", { verdict: "fail" }, deps);
    const second = await runDelegateAction(binding, "submit_verdict", {
      verdict: "pass", summary: "ok now"
    }, deps);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.verdict, "pass");
    const { getDelegationEvent } = await import("../dist-electron/cli/delegationRuns.js");
    assert.equal(getDelegationEvent(id).verdict, "pass");
    assert.equal(getDelegationEvent(id).verdictSummary, "ok now");
  });
});
