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
function makeBinding(runId, depth = 0) {
  return { token: "t", taskSessionId: "sess-entry", runId, parentEventId: "evt-root", depth, selfAgentId: "r-impl", selfLabel: "实现" };
}
const writableOther = { id: "r-write2", label: "写2", agentId: "cli-write2", capability: "写代码2", canWrite: true };

test("list_teammates returns roster minus self", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun } = await import("../dist-electron/cli/delegationRuns.js");
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    const runId = createDelegationRun({ goal: "g", teamId: "team-1", teamSnapshotJson: "{}" });
    const binding = makeBinding(runId);
    const res = await runDelegateAction(binding, "list_teammates", {}, {
      contextProvider, executor: async () => { throw new Error("should not be called"); }, writeApproval: async () => true
    });
    const ids = res.teammates.map((x) => x.id);
    assert.deepEqual(ids, ["r-rev"]);
    assert.equal(res.teammates[0].capability, "审代码");
  });
});

test("delegate happy path: inserts child event, calls executor, returns done summary, marks event done", async (t) => {
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
    assert.equal(res.status, "done");
    assert.equal(res.result, "LGTM");
    assert.ok(res.event_id);
    assert.equal(called.teammate.id, "r-rev");
    assert.equal(called.task, "审 auth");
    assert.equal(called.depth, 1);
    assert.equal(called.parentEventId, "evt-root");
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

test("delegate timeout: executor hanging -> timeout status, event timeout", async (t) => {
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
    assert.equal(res.status, "timeout");
    const ev = listDelegationEvents(runId).find((e) => e.id === res.event_id);
    assert.equal(ev.status, "timeout");
  });
});

test("delegate executor failure -> failed status", async (t) => {
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
    assert.equal(res.status, "failed");
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

test("concurrency=1: two delegates from same run are serialized", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun } = await import("../dist-electron/cli/delegationRuns.js");
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    const runId = createDelegationRun({ goal: "g", teamId: "team-1", teamSnapshotJson: "{}" });
    const binding = makeBinding(runId);
    const order = [];
    const makeExec = (tag) => async () => {
      order.push(`start ${tag}`);
      await new Promise((r) => setTimeout(r, 20));
      order.push(`end ${tag}`);
      return { summary: tag, exitCode: 0, error: null };
    };
    const deps = (tag) => ({ contextProvider, executor: makeExec(tag), writeApproval: async () => true });
    await Promise.all([
      runDelegateAction(binding, "delegate", { teammate_id: "r-rev", task: "a" }, deps("a")),
      runDelegateAction(binding, "delegate", { teammate_id: "r-rev", task: "b" }, deps("b"))
    ]);
    assert.ok(order[0].startsWith("start") && order[1].startsWith("end") && order[2].startsWith("start"),
      `delegates not serialized: ${order.join(",")}`);
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
    const res = await runDelegateAction(binding, "bogus", {}, {
      contextProvider,
      executor: async () => { throw new Error("should not be called"); },
      writeApproval: async () => true
    });
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
    assert.ok(res.result.length <= 12_000 + 100, `result not truncated: ${res.result.length}`);
    assert.match(res.result, /\[truncated\]/);
  });
});

test("delegate passes a live AbortSignal to the executor, not aborted on success", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun } = await import("../dist-electron/cli/delegationRuns.js");
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    const runId = createDelegationRun({ goal: "g", teamId: "team-1", teamSnapshotJson: "{}" });
    let receivedSignal = null;
    const res = await runDelegateAction(makeBinding(runId), "delegate", { teammate_id: "r-rev", task: "x" }, {
      contextProvider,
      executor: async (args) => { receivedSignal = args.signal; return { summary: "ok", exitCode: 0, error: null }; },
      writeApproval: async () => true
    });
    assert.equal(res.status, "done");
    assert.ok(receivedSignal instanceof AbortSignal);
    assert.equal(receivedSignal.aborted, false);
  });
});

test("delegate aborts the executor signal on timeout", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun } = await import("../dist-electron/cli/delegationRuns.js");
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    const runId = createDelegationRun({ goal: "g", teamId: "team-1", teamSnapshotJson: "{}" });
    const shortCtx = { roster, policy: { ...policy, delegateTimeoutMs: 30 }, teamId: "team-1", cwd: "/repo" };
    let receivedSignal = null;
    const res = await runDelegateAction(makeBinding(runId), "delegate", { teammate_id: "r-rev", task: "x" }, {
      contextProvider: () => shortCtx,
      executor: (args) => { receivedSignal = args.signal; return new Promise(() => {}); },
      writeApproval: async () => true
    });
    assert.equal(res.status, "timeout");
    assert.ok(receivedSignal.aborted, "signal must be aborted on timeout");
  });
});

test("nested delegation does not deadlock (child agent delegates while parent delegate runs)", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun, listDelegationEvents } = await import("../dist-electron/cli/delegationRuns.js");
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    const runId = createDelegationRun({ goal: "g", teamId: "team-1", teamSnapshotJson: "{}" });
    const parentBinding = makeBinding(runId); // taskSessionId "sess-entry", selfAgentId "r-impl", depth 0

    // The parent delegates to r-rev; the r-rev agent (child) ITSELF delegates to r-impl (nested).
    const childExec = async (args) => {
      // args.depth === 1 (parent depth 0 + 1); args.childEventId is the r-rev event
      const childBinding = {
        token: "t2", taskSessionId: "sess-child", runId,
        parentEventId: args.childEventId, depth: args.depth, selfAgentId: "r-rev", selfLabel: "评审"
      };
      const nested = await runDelegateAction(childBinding, "delegate", { teammate_id: "r-impl", task: "nested" }, {
        contextProvider,
        executor: async () => ({ summary: "nested-ok", exitCode: 0, error: null }),
        writeApproval: async () => true
      });
      assert.equal(nested.status, "done", "nested delegate must complete (no deadlock)");
      return { summary: "child-done", exitCode: 0, error: null };
    };

    // Race against a hard 3s deadline: if the per-run mutex deadlocks, this rejects.
    const res = await Promise.race([
      runDelegateAction(parentBinding, "delegate", { teammate_id: "r-rev", task: "parent" }, {
        contextProvider, executor: childExec, writeApproval: async () => true
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("deadlock: nested delegate did not complete in 3s")), 3000))
    ]);
    assert.equal(res.status, "done");
    // a depth-2 event (the nested delegate) exists
    assert.ok(listDelegationEvents(runId).some((e) => e.depth === 2), "expected a depth-2 delegation event");
  });
});
