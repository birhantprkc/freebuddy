import "./fixtures/electron-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";

let Database;
let bindingAvailable = true;
try {
  Database = (await import("better-sqlite3")).default;
  new Database(":memory:").close();
} catch { bindingAvailable = false; }

async function withDb(fn) {
  const db = new Database(":memory:");
  const { migrate, setDbForTest } = await import("../dist-electron/cli/db.js");
  migrate(db);
  setDbForTest(db);
  try { await fn(); } finally { setDbForTest(null); db.close(); }
}

const roster = [
  { id: "r-impl", label: "实现", agentId: "cli-codex-acp", capability: "写代码", canWrite: true },
  { id: "r-rev", label: "评审", agentId: "cli-claude-agent-acp", capability: "审代码", canWrite: false }
];
const policy = {
  allowWrites: true, requireApprovalBeforeDelegateWrite: false,
  maxDepth: 3, delegateTimeoutMs: 600000, maxConcurrentDelegates: 1, stopOnDelegateFailure: false
};
const ctx = { roster, policy, teamId: "team-1", cwd: "/repo" };
const contextProvider = (_runId) => ctx;
// check_delegate_result does not touch the executor/writeApproval, but the deps
// object still requires both; this sentinel throws if accidentally invoked.
const sentinelDeps = (ctxProvider = contextProvider) => ({
  contextProvider: ctxProvider,
  executor: async () => { throw new Error("executor should not be called"); },
  writeApproval: async () => true
});
function makeBinding(runId, depth = 0) {
  return { token: "t", taskSessionId: "sess-entry", runId, parentEventId: "evt-root", depth, selfAgentId: "r-impl", selfLabel: "实现" };
}
const writableOther = { id: "r-write2", label: "写2", agentId: "cli-write2", capability: "写代码2", canWrite: true };
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test("list_teammates returns roster minus self", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun } = await import("../dist-electron/cli/delegationRuns.js");
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    const runId = createDelegationRun({ goal: "g", teamId: "team-1", teamSnapshotJson: "{}" });
    const binding = makeBinding(runId);
    const res = await runDelegateAction(binding, "list_teammates", {}, sentinelDeps());
    const ids = res.teammates.map((x) => x.id);
    assert.deepEqual(ids, ["r-rev"]);
    assert.equal(res.teammates[0].capability, "审代码");
  });
});

test("delegate happy path: returns pending immediately, executor runs in background, poll -> done", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun, listDelegationEvents } = await import("../dist-electron/cli/delegationRuns.js");
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    const runId = createDelegationRun({ goal: "g", teamId: "team-1", teamSnapshotJson: "{}" });
    const binding = makeBinding(runId);
    let called = null;
    const res = await runDelegateAction(binding, "delegate", { teammate_id: "r-rev", task: "审 auth" }, {
      contextProvider,
      executor: async (args) => { called = args; return { summary: "LGTM", exitCode: 0, error: null }; },
      writeApproval: async () => true
    });
    // Returns pending immediately with a request_id; executor is NOT awaited inline.
    assert.equal(res.status, "pending");
    assert.ok(res.request_id, "pending response must include request_id");
    assert.equal(res.request_id, res.event_id);
    // Let the background executor settle.
    await tick(50);
    assert.equal(called.teammate.id, "r-rev");
    assert.equal(called.task, "审 auth");
    assert.equal(called.depth, 1);
    assert.equal(called.parentEventId, "evt-root");
    assert.equal(called.signal, undefined, "no AbortSignal is passed in async mode");
    // Poll for the result.
    const polled = await runDelegateAction(binding, "check_delegate_result", { request_id: res.request_id }, sentinelDeps());
    assert.equal(polled.ok, true);
    assert.equal(polled.status, "done");
    assert.equal(polled.result, "LGTM");
    assert.equal(polled.request_id, res.request_id);
    const ev = listDelegationEvents(runId).find((e) => e.id === res.event_id);
    assert.equal(ev.status, "done");
    assert.equal(ev.depth, 1);
    assert.equal(ev.parentEventId, "evt-root");
  });
});

test("delegate at maxDepth returns failed without calling executor", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun } = await import("../dist-electron/cli/delegationRuns.js");
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    const runId = createDelegationRun({ goal: "g", teamId: "team-1", teamSnapshotJson: "{}" });
    const atMax = makeBinding(runId, 3);
    let execCalled = false;
    const res = await runDelegateAction(atMax, "delegate", { teammate_id: "r-rev", task: "x" }, {
      contextProvider, executor: async () => { execCalled = true; return { summary: "", exitCode: 0, error: null }; }, writeApproval: async () => true
    });
    assert.equal(res.status, "failed");
    assert.match(res.result, /最大委派深度/);
    assert.equal(execCalled, false);
  });
});

test("delegate timeout: executor hanging -> pending now, poll -> timeout", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun, listDelegationEvents } = await import("../dist-electron/cli/delegationRuns.js");
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    const runId = createDelegationRun({ goal: "g", teamId: "team-1", teamSnapshotJson: "{}" });
    const binding = makeBinding(runId);
    const shortCtx = { roster, policy: { ...policy, delegateTimeoutMs: 30 }, teamId: "team-1", cwd: "/repo" };
    const res = await runDelegateAction(binding, "delegate", { teammate_id: "r-rev", task: "x" }, {
      contextProvider: () => shortCtx,
      executor: () => new Promise(() => {}), // never resolves
      writeApproval: async () => true
    });
    assert.equal(res.status, "pending");
    // 30ms timeout + margin for the background .catch to flush.
    await tick(80);
    const polled = await runDelegateAction(binding, "check_delegate_result", { request_id: res.request_id }, sentinelDeps(() => shortCtx));
    assert.equal(polled.status, "timeout");
    const ev = listDelegationEvents(runId).find((e) => e.id === res.request_id);
    assert.equal(ev.status, "timeout");
  });
});

test("delegate executor failure -> pending now, poll -> failed", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun } = await import("../dist-electron/cli/delegationRuns.js");
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    const runId = createDelegationRun({ goal: "g", teamId: "team-1", teamSnapshotJson: "{}" });
    const binding = makeBinding(runId);
    const res = await runDelegateAction(binding, "delegate", { teammate_id: "r-rev", task: "x" }, {
      contextProvider,
      executor: async () => ({ summary: "", exitCode: 1, error: "boom" }),
      writeApproval: async () => true
    });
    assert.equal(res.status, "pending");
    await tick(50);
    const polled = await runDelegateAction(binding, "check_delegate_result", { request_id: res.request_id }, sentinelDeps());
    assert.equal(polled.status, "failed");
    assert.equal(polled.result, "boom");
  });
});

test("allowWrites=false blocks writable teammate", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun } = await import("../dist-electron/cli/delegationRuns.js");
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    const runId = createDelegationRun({ goal: "g", teamId: "team-1", teamSnapshotJson: "{}" });
    const binding = makeBinding(runId);
    const noWrite = { roster: [...roster, writableOther], policy: { ...policy, allowWrites: false }, teamId: "team-1", cwd: "/repo" };
    let execCalled = false;
    const res = await runDelegateAction(binding, "delegate", { teammate_id: "r-write2", task: "x" }, {
      contextProvider: () => noWrite,
      executor: async () => { execCalled = true; return { summary: "", exitCode: 0, error: null }; },
      writeApproval: async () => true
    });
    assert.equal(res.status, "failed");
    assert.match(res.result, /allowWrites/);
    assert.equal(execCalled, false);
  });
});

test("requireApprovalBeforeDelegateWrite: rejected -> failed, not executed", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun } = await import("../dist-electron/cli/delegationRuns.js");
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    const runId = createDelegationRun({ goal: "g", teamId: "team-1", teamSnapshotJson: "{}" });
    const binding = makeBinding(runId);
    const apprCtx = { roster: [...roster, writableOther], policy: { ...policy, requireApprovalBeforeDelegateWrite: true }, teamId: "team-1", cwd: "/repo" };
    let execCalled = false;
    const res = await runDelegateAction(binding, "delegate", { teammate_id: "r-write2", task: "x" }, {
      contextProvider: () => apprCtx,
      executor: async () => { execCalled = true; return { summary: "", exitCode: 0, error: null }; },
      writeApproval: async () => false
    });
    assert.equal(res.status, "failed");
    assert.match(res.result, /拒绝/);
    assert.equal(execCalled, false);
  });
});

test("delegate to self returns failed without executor", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun } = await import("../dist-electron/cli/delegationRuns.js");
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    const runId = createDelegationRun({ goal: "g", teamId: "team-1", teamSnapshotJson: "{}" });
    const binding = makeBinding(runId);
    let execCalled = false;
    const res = await runDelegateAction(binding, "delegate", { teammate_id: "r-impl", task: "x" }, {
      contextProvider,
      executor: async () => { execCalled = true; return { summary: "", exitCode: 0, error: null }; },
      writeApproval: async () => true
    });
    assert.equal(res.status, "failed");
    assert.match(res.result, /self/);
    assert.equal(execCalled, false);
  });
});

test("unknown action returns ok:false error", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun } = await import("../dist-electron/cli/delegationRuns.js");
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    const runId = createDelegationRun({ goal: "g", teamId: "team-1", teamSnapshotJson: "{}" });
    const binding = makeBinding(runId);
    const res = await runDelegateAction(binding, "bogus", {}, sentinelDeps());
    assert.equal(res.ok, false);
    assert.match(res.error, /unknown action/);
  });
});

test("result summary is truncated past the bound", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun } = await import("../dist-electron/cli/delegationRuns.js");
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    const runId = createDelegationRun({ goal: "g", teamId: "team-1", teamSnapshotJson: "{}" });
    const binding = makeBinding(runId);
    const res = await runDelegateAction(binding, "delegate", { teammate_id: "r-rev", task: "x" }, {
      contextProvider,
      executor: async () => ({ summary: "x".repeat(20_000), exitCode: 0, error: null }),
      writeApproval: async () => true
    });
    assert.equal(res.status, "pending");
    await tick(50);
    const polled = await runDelegateAction(binding, "check_delegate_result", { request_id: res.request_id }, sentinelDeps());
    assert.ok(polled.result.length <= 12_000 + 100, `result not truncated: ${polled.result.length}`);
    assert.match(polled.result, /\[truncated\]/);
  });
});

test("check_delegate_result for unknown request_id -> ok:false", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun } = await import("../dist-electron/cli/delegationRuns.js");
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    const runId = createDelegationRun({ goal: "g", teamId: "team-1", teamSnapshotJson: "{}" });
    const binding = makeBinding(runId);
    const res = await runDelegateAction(binding, "check_delegate_result", { request_id: "does-not-exist" }, sentinelDeps());
    assert.equal(res.ok, false);
    assert.match(res.error, /not found/);
  });
});

test("check_delegate_result without request_id -> ok:false", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun } = await import("../dist-electron/cli/delegationRuns.js");
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    const runId = createDelegationRun({ goal: "g", teamId: "team-1", teamSnapshotJson: "{}" });
    const binding = makeBinding(runId);
    const res = await runDelegateAction(binding, "check_delegate_result", {}, sentinelDeps());
    assert.equal(res.ok, false);
    assert.match(res.error, /request_id required/);
  });
});

test("check_delegate_result returns running while executor is still running", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun } = await import("../dist-electron/cli/delegationRuns.js");
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    const runId = createDelegationRun({ goal: "g", teamId: "team-1", teamSnapshotJson: "{}" });
    const binding = makeBinding(runId);
    const res = await runDelegateAction(binding, "delegate", { teammate_id: "r-rev", task: "x" }, {
      contextProvider,
      executor: () => new Promise((r) => setTimeout(() => r({ summary: "slow", exitCode: 0, error: null }), 200)),
      writeApproval: async () => true
    });
    assert.equal(res.status, "pending");
    // Poll immediately: the background executor is executing -> status is now the real "running".
    const polled = await runDelegateAction(binding, "check_delegate_result", { request_id: res.request_id }, sentinelDeps());
    assert.equal(polled.status, "running");
    // Let it finish so no background timer is left dangling.
    await tick(250);
  });
});

test("maxConcurrentDelegates queues a second concurrent delegate until the first settles", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun } = await import("../dist-electron/cli/delegationRuns.js");
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    const runId = createDelegationRun({ goal: "g", teamId: "team-1", teamSnapshotJson: "{}" });
    const binding = makeBinding(runId);
    // Shared deps so the queue's drain (fired from the first delegate's settle)
    // invokes the same executor for the queued second delegate.
    let releaseFirst;
    const sharedDeps = {
      contextProvider,
      executor: (args) => args.task === "a"
        ? new Promise((r) => { releaseFirst = () => r({ summary: "A done", exitCode: 0, error: null }); })
        : Promise.resolve({ summary: "B done", exitCode: 0, error: null }),
      writeApproval: async () => true
    };
    // First delegate: pending receipt, executor hangs so it stays "running".
    const res1 = await runDelegateAction(binding, "delegate", { teammate_id: "r-rev", task: "a" }, sharedDeps);
    assert.equal(res1.status, "pending");
    await tick(20);
    // Second delegate while the first is still running: queued (pending), NOT failed.
    const res2 = await runDelegateAction(binding, "delegate", { teammate_id: "r-rev", task: "b" }, sharedDeps);
    assert.equal(res2.status, "pending");
    await tick(20);
    // Real statuses: first running, second pending (queued behind the limit=1).
    const poll1 = await runDelegateAction(binding, "check_delegate_result", { request_id: res1.request_id }, sentinelDeps());
    assert.equal(poll1.status, "running");
    const poll2 = await runDelegateAction(binding, "check_delegate_result", { request_id: res2.request_id }, sentinelDeps());
    assert.equal(poll2.status, "pending");
    // Release the first -> it settles -> drain starts the second -> it runs to done.
    releaseFirst();
    await tick(60);
    const poll1b = await runDelegateAction(binding, "check_delegate_result", { request_id: res1.request_id }, sentinelDeps());
    assert.equal(poll1b.status, "done");
    await tick(60);
    const poll2b = await runDelegateAction(binding, "check_delegate_result", { request_id: res2.request_id }, sentinelDeps());
    assert.equal(poll2b.status, "done");
  });
});
