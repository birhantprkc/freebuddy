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

const roster = [
  { id: "r-impl", label: "实现", agentId: "cli-codex-acp", capability: "写代码", canWrite: true },
  { id: "r-rev", label: "评审", agentId: "cli-claude-agent-acp", capability: "审代码", canWrite: false },
  { id: "r-fix", label: "修复", agentId: "cli-fix-acp", capability: "修小问题", canWrite: true }
];
const policy = {
  allowWrites: true,
  requireApprovalBeforeDelegateWrite: false,
  maxDepth: 3,
  delegateTimeoutMs: 600000,
  maxConcurrentDelegates: 1,
  stopOnDelegateFailure: false
};
const contextProvider = () => ({ roster, policy, teamId: "team-1", cwd: "/repo" });
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test("hard reject bounce to caller/ancestor", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun, insertDelegationEvent } = await import(
      "../dist-electron/cli/delegationRuns.js"
    );
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    const runId = createDelegationRun({ goal: "g", teamId: "team-1", teamSnapshotJson: "{}" });
    // Root entry event (r-impl)
    const rootId = insertDelegationEvent({
      runId,
      parentEventId: null,
      agentId: "cli-codex-acp",
      agentName: "实现",
      roleLabel: "实现",
      taskText: "实现功能",
      depth: 0,
      canWrite: true,
      status: "running"
    });
    // Reviewer event under root
    const revId = insertDelegationEvent({
      runId,
      parentEventId: rootId,
      agentId: "cli-claude-agent-acp",
      agentName: "评审",
      roleLabel: "评审",
      taskText: "审查改动",
      depth: 1,
      canWrite: false,
      status: "running"
    });
    const revBinding = {
      token: "t",
      taskSessionId: "s",
      runId,
      parentEventId: revId,
      depth: 1,
      selfAgentId: "r-rev",
      selfLabel: "评审"
    };
    const res = await runDelegateAction(
      revBinding,
      "delegate",
      { teammate_id: "r-impl", task: "请帮忙再看一眼" },
      {
        contextProvider,
        executor: async () => ({ summary: "nope", exitCode: 0, error: null }),
        writeApproval: async () => true
      }
    );
    assert.equal(res.status, "failed");
    assert.match(res.result, /ping-pong|bounce|ancestor/i);
  });
});

test("hard reject whole-task re-delegate", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun, insertDelegationEvent } = await import(
      "../dist-electron/cli/delegationRuns.js"
    );
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    const runId = createDelegationRun({ goal: "g", teamId: "team-1", teamSnapshotJson: "{}" });
    const rootId = insertDelegationEvent({
      runId,
      parentEventId: null,
      agentId: "cli-codex-acp",
      agentName: "实现",
      roleLabel: "实现",
      taskText: "请只读审查 upgrade-system.js 与 tests",
      depth: 0,
      canWrite: true,
      status: "running"
    });
    const binding = {
      token: "t",
      taskSessionId: "s",
      runId,
      parentEventId: rootId,
      depth: 0,
      selfAgentId: "r-impl",
      selfLabel: "实现"
    };
    const res = await runDelegateAction(
      binding,
      "delegate",
      {
        teammate_id: "r-rev",
        task: "请只读审查 upgrade-system.js 与 tests"
      },
      {
        contextProvider,
        executor: async () => ({ summary: "nope", exitCode: 0, error: null }),
        writeApproval: async () => true
      }
    );
    assert.equal(res.status, "failed");
    assert.match(res.result, /entire task|整/i);
  });
});

test("active-leaf concurrency: sub-delegate starts under parked parent", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun, insertDelegationEvent } = await import(
      "../dist-electron/cli/delegationRuns.js"
    );
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    const runId = createDelegationRun({ goal: "g", teamId: "team-1", teamSnapshotJson: "{}" });
    const rootId = insertDelegationEvent({
      runId,
      parentEventId: null,
      agentId: "cli-codex-acp",
      agentName: "实现",
      roleLabel: "实现",
      taskText: "goal",
      depth: 0,
      canWrite: true,
      status: "running"
    });
    const entryBinding = {
      token: "t",
      taskSessionId: "s",
      runId,
      parentEventId: rootId,
      depth: 0,
      selfAgentId: "r-impl",
      selfLabel: "实现"
    };

    let nestedStatus = null;
    const deps = {
      contextProvider,
      executor: async (args) => {
        // r-rev sub-delegates a DISTINCT task to r-impl
        const revBinding = {
          token: "t",
          taskSessionId: "s-rev",
          runId,
          parentEventId: args.childEventId,
          depth: args.depth,
          selfAgentId: "r-rev",
          selfLabel: "评审"
        };
        // Sub-delegate to a third teammate (not an ancestor) to exercise active-leaf concurrency.
        const nested = await runDelegateAction(
          revBinding,
          "delegate",
          { teammate_id: "r-fix", task: "修复评审指出的费用字段命名" },
          {
            contextProvider,
            executor: () =>
              new Promise((r) =>
                setTimeout(() => r({ summary: "fixed", exitCode: 0, error: null }), 60)
              ),
            writeApproval: async () => true
          }
        );
        assert.equal(nested.status, "pending");
        await tick(20);
        const poll = await runDelegateAction(
          revBinding,
          "check_delegate_result",
          { request_id: nested.request_id },
          {
            contextProvider,
            executor: async () => {
              throw new Error("no");
            },
            writeApproval: async () => true
          }
        );
        nestedStatus = poll.status;
        return { summary: "review done", exitCode: 0, error: null };
      },
      writeApproval: async () => true
    };

    const res = await runDelegateAction(
      entryBinding,
      "delegate",
      { teammate_id: "r-rev", task: "审查 auth 改动并给建议" },
      deps
    );
    assert.equal(res.status, "pending");
    await tick(80);
    assert.equal(
      nestedStatus,
      "running",
      "depth-2 delegate must start while parent is parked (active-leaf)"
    );
    await tick(120);
  });
});
