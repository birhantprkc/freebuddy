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
      "started_at", "ended_at", "verdict", "verdict_summary"
    ]) {
      assert.ok(cols.includes(name), `delegation_events.${name} missing`);
    }
    const indexes = db.prepare("PRAGMA index_list('delegation_events')").all().map((i) => i.name);
    assert.ok(indexes.includes("idx_delegation_events_run"), "idx_delegation_events_run index missing");
  });
});

test("delegation team CRUD round-trips roster, policy, entryRoleId", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  await withDb(async () => {
    const { insertDelegationTeam, getDelegationTeam, listDelegationTeams, updateDelegationTeam, deleteDelegationTeam } =
      await import("../dist-electron/cli/delegationTeams.js");

    const roster = [
      { id: "r-impl", label: "实现", agentId: "cli-codex-acp", capability: "写代码", canWrite: true },
      { id: "r-rev", label: "评审", agentId: "cli-claude-agent-acp", capability: "审代码", canWrite: false }
    ];
    const created = insertDelegationTeam({
      id: "team-del-1", name: "Impl+Review", enabled: true, source: "user",
      entryRoleId: "r-impl", roster,
      policy: {
        allowWrites: true, requireApprovalBeforeDelegateWrite: true,
        maxDepth: 3, delegateTimeoutMs: 600000, maxConcurrentDelegates: 1,
        stopOnDelegateFailure: false
      }
    });
    assert.equal(created.kind, "delegation");
    assert.equal(created.entryRoleId, "r-impl");
    assert.equal(created.roster.length, 2);

    const fetched = getDelegationTeam("team-del-1");
    assert.deepEqual(fetched?.roster, roster);

    assert.ok(listDelegationTeams().some((x) => x.id === "team-del-1"));

    updateDelegationTeam("team-del-1", { entryRoleId: "r-rev", name: "Renamed" });
    assert.equal(getDelegationTeam("team-del-1")?.entryRoleId, "r-rev");
    assert.equal(getDelegationTeam("team-del-1")?.name, "Renamed");

    assert.equal(deleteDelegationTeam("team-del-1"), true);
    assert.equal(getDelegationTeam("team-del-1"), undefined);
  });
});

test("listWorkflowTeams excludes delegation teams", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  await withDb(async () => {
    const { insertDelegationTeam } = await import("../dist-electron/cli/delegationTeams.js");
    const { listWorkflowTeams } = await import("../dist-electron/cli/workflowTeams.js");

    insertDelegationTeam({
      id: "team-del-isolate", name: "Del", enabled: true, source: "user",
      entryRoleId: "r-1", roster: [{ id: "r-1", label: "x", agentId: "a", capability: "y", canWrite: false }],
      policy: {
        allowWrites: true, requireApprovalBeforeDelegateWrite: false,
        maxDepth: 2, delegateTimeoutMs: 1000, maxConcurrentDelegates: 1,
        stopOnDelegateFailure: false
      }
    });
    const ids = listWorkflowTeams().map((t) => t.id);
    assert.ok(!ids.includes("team-del-isolate"), "delegation team leaked into workflow list");
  });
});

test("seedBuiltinDelegationTeams is idempotent and appears in list", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  await withDb(async () => {
    const { seedBuiltinDelegationTeams, getDelegationTeam, listDelegationTeams, updateDelegationTeam } =
      await import("../dist-electron/cli/delegationTeams.js");

    seedBuiltinDelegationTeams();
    const team = getDelegationTeam("team-delegation-impl-review");
    assert.ok(team, "builtin delegation team missing after seed");
    assert.equal(team?.source, "builtin");
    assert.ok(team?.roster.length >= 2);
    assert.ok(listDelegationTeams().some((x) => x.id === "team-delegation-impl-review"));

    // user customization preserved across re-seed
    const customized = team?.roster.map((r) =>
      r.id === "r-impl" ? { ...r, agentId: "cli-claude-agent-acp", skillIds: ["skill-debug"] } : r
    );
    updateDelegationTeam("team-delegation-impl-review", { roster: customized });

    seedBuiltinDelegationTeams();
    const reseated = getDelegationTeam("team-delegation-impl-review");
    const impl = reseated?.roster.find((r) => r.id === "r-impl");
    assert.equal(impl?.agentId, "cli-claude-agent-acp", "user agent binding not preserved on re-seed");
    assert.deepEqual(impl?.skillIds, ["skill-debug"], "user skillIds not preserved on re-seed");
  });
});

test("createDelegationRun inserts a kind=delegation run row", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun, getDelegationRun } =
      await import("../dist-electron/cli/delegationRuns.js");
    const id = createDelegationRun({
      goal: "实现登录页",
      cwd: "/repo",
      teamId: "team-del-1",
      teamSnapshotJson: JSON.stringify({ id: "team-del-1" })
    });
    const run = getDelegationRun(id);
    assert.ok(run);
    assert.equal(run.kind, "delegation");
    assert.equal(run.goal, "实现登录页");
    assert.equal(run.status, "running");
    assert.equal(run.teamId, "team-del-1");
  });
});

test("setDelegationRunStatus sets ended_at on terminal statuses", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun, setDelegationRunStatus, getDelegationRun } =
      await import("../dist-electron/cli/delegationRuns.js");
    const id = createDelegationRun({ goal: "g", teamId: "t", teamSnapshotJson: "{}" });

    setDelegationRunStatus(id, "blocked");
    assert.equal(getDelegationRun(id)?.endedAt, null, "non-terminal status must not set ended_at");

    setDelegationRunStatus(id, "partial");
    assert.ok(getDelegationRun(id)?.endedAt, "terminal 'partial' must set ended_at");
    assert.equal(getDelegationRun(id)?.status, "partial");
  });
});

test("getDelegationRun returns undefined for unknown id and for non-delegation rows", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  await withDb(async () => {
    const { getDelegationRun } = await import("../dist-electron/cli/delegationRuns.js");
    const { getDb } = await import("../dist-electron/cli/db.js");

    assert.equal(getDelegationRun("does-not-exist"), undefined);

    // insert a plain workflow-kind run and ensure it is NOT returned by the delegation getter
    const now = new Date().toISOString();
    getDb().prepare(
      `INSERT INTO workflow_runs (id, conversation_id, name, goal, status, template, loop_index, max_loops, plan_json, kind, created_at, updated_at)
       VALUES (?, NULL, 'wf', 'g', 'completed', 'review-loop', 0, 1, '{}', 'workflow', ?, ?)`
    ).run("wf-run-1", now, now);
    assert.equal(getDelegationRun("wf-run-1"), undefined, "workflow-kind run leaked into delegation getter");
  });
});

test("delegation events CRUD builds a parent-linked tree", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun, insertDelegationEvent, updateDelegationEvent, listDelegationEvents } =
      await import("../dist-electron/cli/delegationRuns.js");
    const runId = createDelegationRun({
      goal: "g", teamId: "t", teamSnapshotJson: "{}"
    });

    const root = insertDelegationEvent({
      runId, parentEventId: null, agentId: "cli-codex-acp", agentName: "Codex",
      roleLabel: "实现", taskText: "根任务", depth: 0, canWrite: true, status: "running"
    });
    const child = insertDelegationEvent({
      runId, parentEventId: root, agentId: "cli-claude-agent-acp", agentName: "Claude",
      roleLabel: "评审", taskText: "审 auth", depth: 1, canWrite: false, status: "running"
    });

    updateDelegationEvent(child, { status: "done", resultSummary: "LGTM" });

    const events = listDelegationEvents(runId);
    assert.equal(events.length, 2);
    const childEvent = events.find((e) => e.id === child);
    assert.equal(childEvent?.status, "done");
    assert.equal(childEvent?.resultSummary, "LGTM");
    assert.equal(childEvent?.parentEventId, root);
    const rootEvent = events.find((e) => e.id === root);
    assert.equal(rootEvent?.depth, 0);
  });
});

test("delegation events cascade-delete with their run", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun, insertDelegationEvent, listDelegationEvents } =
      await import("../dist-electron/cli/delegationRuns.js");
    const { getDb } = await import("../dist-electron/cli/db.js");
    const runId = createDelegationRun({ goal: "g", teamId: "t", teamSnapshotJson: "{}" });
    insertDelegationEvent({
      runId, parentEventId: null, agentId: "a", agentName: "A",
      roleLabel: "x", taskText: "t", depth: 0, canWrite: false, status: "running"
    });
    getDb().prepare("DELETE FROM workflow_runs WHERE id = ?").run(runId);
    assert.equal(listDelegationEvents(runId).length, 0);
  });
});
