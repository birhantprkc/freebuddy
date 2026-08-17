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
  const { seedBuiltinSkills } = await import("../dist-electron/cli/skills.js");
  seedBuiltinSkills();
  try {
    await fn();
  } finally {
    setDbForTest(null);
    db.close();
  }
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

const roster = [
  { id: "r-impl", label: "实现", agentId: "cli-codex-acp", capability: "写", canWrite: true },
  { id: "r-rev", label: "评审", agentId: "cli-claude-agent-acp", capability: "审", canWrite: false }
];
const policy = {
  allowWrites: true,
  requireApprovalBeforeDelegateWrite: false,
  maxDepth: 3,
  delegateTimeoutMs: 600000,
  maxConcurrentDelegates: 1,
  stopOnDelegateFailure: false
};
const snap = { roster, policy, entryRoleId: "r-impl" };

test("pauseRun cancels active events and sets status paused", async (t) => {
  if (!bindingAvailable) {
    t.skip("better-sqlite3 unavailable");
    return;
  }
  await withDb(async () => {
    const { DelegationRuntime } = await import("../dist-electron/cli/delegationRuntime.js");
    const { getDelegationRun, listDelegationEvents } = await import(
      "../dist-electron/cli/delegationRuns.js"
    );

    let entryStarted = false;
    const rt = new DelegationRuntime({
      webContents: undefined,
      resolveAgent: () => ({ adapter: "codex-acp", agentName: "Codex", skillIds: [] }),
      runAgent: () => {
        entryStarted = true;
        return new Promise(() => {});
      }
    });

    const runId = rt.prepareRun({
      goal: "做功能",
      teamId: "t",
      teamSnapshot: snap,
      cwd: "/r"
    });
    const entryPromise = rt.runEntry(runId, "做功能");

    for (let i = 0; i < 50 && !entryStarted; i++) await tick(20);
    assert.equal(entryStarted, true);

    const paused = rt.pauseRun(runId);
    assert.equal(paused, true);
    assert.equal(getDelegationRun(runId).status, "paused");

    const active = listDelegationEvents(runId).filter((e) =>
      ["pending", "running"].includes(e.status)
    );
    assert.equal(active.length, 0);
    const cancelled = listDelegationEvents(runId).filter((e) => e.status === "cancelled");
    assert.ok(cancelled.length >= 1);
    assert.match(cancelled[0].resultSummary ?? "", /暂停/);

    await Promise.race([entryPromise, tick(100)]);
  });
});

test("resumeRun restarts from interrupted role", async (t) => {
  if (!bindingAvailable) {
    t.skip("better-sqlite3 unavailable");
    return;
  }
  await withDb(async () => {
    const { DelegationRuntime } = await import("../dist-electron/cli/delegationRuntime.js");
    const { getDelegationRun } = await import("../dist-electron/cli/delegationRuns.js");

    let turn = 0;
    const prompts = [];
    const rt = new DelegationRuntime({
      webContents: undefined,
      resolveAgent: () => ({ adapter: "codex-acp", agentName: "Codex", skillIds: [] }),
      runAgent: async (args) => {
        turn += 1;
        prompts.push(args.prompt);
        if (turn === 1) return new Promise(() => {});
        return { summary: "resumed ok", exitCode: 0, error: null };
      }
    });

    const runId = rt.prepareRun({
      goal: "做功能",
      teamId: "t",
      teamSnapshot: snap,
      cwd: "/r"
    });
    const entryPromise = rt.runEntry(runId, "做功能");
    for (let i = 0; i < 50 && turn < 1; i++) await tick(20);
    assert.equal(turn, 1);

    assert.equal(rt.pauseRun(runId), true);
    await tick(30);

    const resumed = await rt.resumeRun(runId);
    assert.equal(resumed, true);
    assert.equal(getDelegationRun(runId).status, "completed");
    assert.ok(turn >= 2, "resume must spawn another agent turn");
    assert.match(prompts[prompts.length - 1] ?? "", /暂停/);

    await Promise.race([entryPromise, tick(50)]);
  });
});

test("resumeRun uses updated team model after mid-run team edit", async (t) => {
  if (!bindingAvailable) {
    t.skip("better-sqlite3 unavailable");
    return;
  }
  await withDb(async () => {
    const { DelegationRuntime } = await import("../dist-electron/cli/delegationRuntime.js");
    const { insertDelegationTeam, updateDelegationTeam } = await import(
      "../dist-electron/cli/delegationTeams.js"
    );

    insertDelegationTeam({
      id: "t-model",
      name: "t",
      source: "user",
      enabled: true,
      roster,
      policy,
      entryRoleId: "r-impl"
    });

    const overrides = [];
    let entryStarted = false;
    let turn = 0;
    const rt = new DelegationRuntime({
      webContents: undefined,
      resolveAgent: () => ({ adapter: "codex-acp", agentName: "Codex", skillIds: [] }),
      runAgent: (args) => {
        turn += 1;
        overrides.push(args.configOptionOverrides?.model ?? null);
        if (turn === 1) {
          entryStarted = true;
          return new Promise(() => {});
        }
        return Promise.resolve({ summary: "ok", exitCode: 0, error: null });
      }
    });

    const runId = rt.prepareRun({
      goal: "做功能",
      teamId: "t-model",
      teamSnapshot: snap,
      cwd: "/r"
    });
    const entryPromise = rt.runEntry(runId, "做功能");
    for (let i = 0; i < 50 && !entryStarted; i++) await tick(20);
    assert.equal(entryStarted, true);

    assert.equal(rt.pauseRun(runId), true);
    updateDelegationTeam("t-model", {
      roster: roster.map((r) =>
        r.id === "r-impl" ? { ...r, model: "new-model-id", modelOptionId: "model" } : r
      )
    });
    assert.equal(await rt.resumeRun(runId), true);
    for (let i = 0; i < 50 && turn < 2; i++) await tick(20);
    assert.equal(overrides[overrides.length - 1], "new-model-id");
    await Promise.race([entryPromise, tick(50)]);
  });
});

test("recoverInterruptedDelegationRuns leaves paused runs alone", async (t) => {
  if (!bindingAvailable) {
    t.skip("better-sqlite3 unavailable");
    return;
  }
  await withDb(async () => {
    const { createDelegationRun, setDelegationRunStatus, getDelegationRun } = await import(
      "../dist-electron/cli/delegationRuns.js"
    );
    const { recoverInterruptedDelegationRuns } = await import(
      "../dist-electron/cli/delegationRuntime.js"
    );
    const runId = createDelegationRun({
      goal: "g",
      teamId: "t",
      teamSnapshotJson: "{}"
    });
    setDelegationRunStatus(runId, "paused");
    recoverInterruptedDelegationRuns();
    assert.equal(getDelegationRun(runId).status, "paused");
  });
});
