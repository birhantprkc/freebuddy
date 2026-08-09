import "./fixtures/electron-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";

let Database, bindingAvailable = true;
try { Database = (await import("better-sqlite3")).default; new Database(":memory:").close(); } catch { bindingAvailable = false; }

async function withDb(fn) {
  const db = new Database(":memory:");
  const { migrate, setDbForTest } = await import("../dist-electron/cli/db.js");
  migrate(db); setDbForTest(db);
  const { seedBuiltinSkills } = await import("../dist-electron/cli/skills.js");
  seedBuiltinSkills();
  try { await fn(); } finally { setDbForTest(null); db.close(); }
}

const roster = [
  { id: "r-impl", label: "实现", agentId: "cli-codex-acp", capability: "写", canWrite: true },
  { id: "r-rev", label: "评审", agentId: "cli-claude-agent-acp", capability: "审", canWrite: false }
];
const policy = { allowWrites: true, requireApprovalBeforeDelegateWrite: true, maxDepth: 3, delegateTimeoutMs: 600000, maxConcurrentDelegates: 1, stopOnDelegateFailure: false };
const snap = { roster, policy, entryRoleId: "r-impl" };

test("context provider returns the run's roster/policy", async (t) => {
  if (!bindingAvailable) { t.skip(); return; }
  await withDb(async () => {
    const { DelegationRuntime, DELEGATION_SKILL_ID } = await import("../dist-electron/cli/delegationRuntime.js");
    const rt = new DelegationRuntime({ webContents: undefined, resolveAgent: () => undefined, runAgent: async () => ({ summary: "", exitCode: 0, error: null }) });
    const runId = rt.prepareRun({ goal: "g", teamId: "t", teamSnapshot: snap, cwd: "/r" });
    const ctx = rt.getContext(runId);
    assert.deepEqual(ctx.roster, roster);
    assert.equal(ctx.policy.requireApprovalBeforeDelegateWrite, true);
    assert.equal(DELEGATION_SKILL_ID, "delegation");
  });
});

test("write-approval gate blocks until resolved true/false", async (t) => {
  if (!bindingAvailable) { t.skip(); return; }
  await withDb(async () => {
    const { DelegationRuntime } = await import("../dist-electron/cli/delegationRuntime.js");
    const rt = new DelegationRuntime({ webContents: undefined, resolveAgent: () => undefined, runAgent: async () => ({ summary: "", exitCode: 0, error: null }) });
    const runId = rt.prepareRun({ goal: "g", teamId: "t", teamSnapshot: snap, cwd: "/r" });
    const teammate = roster[0];
    const promise = rt.requestWriteApproval(runId, teammate);
    const pending = rt.listPendingApprovals();
    assert.equal(pending.length, 1);
    rt.resolveWriteApproval(pending[0].approvalId, true);
    assert.equal(await promise, true);

    const promise2 = rt.requestWriteApproval(runId, teammate);
    const a2 = rt.listPendingApprovals()[0];
    rt.resolveWriteApproval(a2.approvalId, false);
    assert.equal(await promise2, false);
  });
});

test("run start creates run row + root event and spawns entry via runAgent", async (t) => {
  if (!bindingAvailable) { t.skip(); return; }
  await withDb(async () => {
    const { DelegationRuntime } = await import("../dist-electron/cli/delegationRuntime.js");
    const { listDelegationEvents } = await import("../dist-electron/cli/delegationRuns.js");
    let spawned;
    const rt = new DelegationRuntime({
      webContents: undefined,
      resolveAgent: (id) => ({ adapter: "codex-acp", agentName: "Codex", skillIds: [] }),
      runAgent: async (args) => { spawned = args; return { summary: "done", exitCode: 0, error: null }; }
    });
    const runId = await rt.start({ goal: "实现X", teamId: "t", teamSnapshot: snap, cwd: "/r", conversationId: undefined });
    assert.ok(runId);
    assert.equal(spawned.agentId, "cli-codex-acp");
    assert.ok(spawned.prompt.includes("实现X"));
    assert.ok(spawned.skills?.some((s) => s.id === "delegation"));
    assert.equal(spawned.delegation.runId, runId);
    assert.equal(spawned.delegation.depth, 0);
    const root = listDelegationEvents(runId).find((e) => e.depth === 0);
    assert.ok(root);
  });
});

test("recoverInterruptedDelegationRuns marks running delegation runs as failed", async (t) => {
  if (!bindingAvailable) { t.skip(); return; }
  await withDb(async () => {
    const { recoverInterruptedDelegationRuns } = await import("../dist-electron/cli/delegationRuntime.js");
    const { createDelegationRun, getDelegationRun } = await import("../dist-electron/cli/delegationRuns.js");
    const runId = createDelegationRun({ goal: "g", teamId: "t", teamSnapshotJson: "{}" });
    assert.equal(getDelegationRun(runId).status, "running");
    const count = recoverInterruptedDelegationRuns();
    assert.equal(count, 1);
    assert.equal(getDelegationRun(runId).status, "failed");
    // a second call finds nothing left to recover
    assert.equal(recoverInterruptedDelegationRuns(), 0);
  });
});
