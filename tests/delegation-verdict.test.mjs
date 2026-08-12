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

test("migrate adds verdict columns to legacy delegation_events", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const { migrate, setDbForTest } = await import("../dist-electron/cli/db.js");
  migrate(db);
  db.exec("DROP TABLE delegation_events");
  db.exec(`
    CREATE TABLE delegation_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      parent_event_id TEXT,
      agent_id TEXT,
      agent_name TEXT,
      role_label TEXT,
      task_text TEXT,
      depth INTEGER NOT NULL,
      status TEXT NOT NULL,
      result_summary TEXT,
      can_write INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      ended_at TEXT,
      FOREIGN KEY(run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
    );
  `);
  migrate(db);
  const cols = db.prepare("PRAGMA table_info(delegation_events)").all().map((c) => c.name);
  assert.ok(cols.includes("verdict"), "verdict column missing after legacy migrate");
  assert.ok(cols.includes("verdict_summary"), "verdict_summary column missing after legacy migrate");

  setDbForTest(db);
  try {
    const { createDelegationRun, insertDelegationEvent, updateDelegationEvent, getDelegationEvent } =
      await import("../dist-electron/cli/delegationRuns.js");
    const runId = createDelegationRun({ goal: "g", teamId: "t", teamSnapshotJson: "{}" });
    const id = insertDelegationEvent({
      runId,
      parentEventId: null,
      agentId: "rev",
      agentName: "评审",
      roleLabel: "评审",
      taskText: "审",
      depth: 1,
      canWrite: false,
      status: "running"
    });
    updateDelegationEvent(id, { verdict: "pass", verdictSummary: "all good" });
    const row = getDelegationEvent(id);
    assert.equal(row.verdict, "pass");
    assert.equal(row.verdictSummary, "all good");
  } finally {
    setDbForTest(null);
    db.close();
  }
});

test("submit_verdict without summary clears prior verdictSummary", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun, insertDelegationEvent, getDelegationEvent } =
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
    const first = await runDelegateAction(binding, "submit_verdict", {
      verdict: "fail",
      summary: "blocking issue"
    }, deps);
    assert.equal(first.ok, true);
    assert.equal(getDelegationEvent(id).verdictSummary, "blocking issue");

    const second = await runDelegateAction(binding, "submit_verdict", { verdict: "pass" }, deps);
    assert.equal(second.ok, true);
    assert.equal(getDelegationEvent(id).verdict, "pass");
    assert.equal(getDelegationEvent(id).verdictSummary, null);
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
