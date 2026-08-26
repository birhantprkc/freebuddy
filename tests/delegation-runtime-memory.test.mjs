import test from "node:test";
import assert from "node:assert/strict";
import { DelegationRuntime, createMemoryDelegationRepository } from "../packages/delegation-runtime/dist/index.js";

const roster = [
  { id: "r-impl", label: "实现", agentId: "agent-a", capability: "写", canWrite: true },
  { id: "r-rev", label: "评审", agentId: "agent-b", capability: "审", canWrite: false }
];
const policy = {
  allowWrites: true,
  requireApprovalBeforeDelegateWrite: true,
  maxDepth: 3,
  delegateTimeoutMs: 600000,
  maxConcurrentDelegates: 1,
  stopOnDelegateFailure: false
};

function fakeExecutor() {
  return {
    async run(_request, onEvent) {
      onEvent({ type: "done", exitCode: 0 });
    },
    kill() {}
  };
}

test("in-memory delegation runtime completes a nested-capable entry turn", async () => {
  const repository = createMemoryDelegationRepository();
  const runtime = new DelegationRuntime({
    repository,
    executor: fakeExecutor(),
    events: { publish() {} },
    approval: { async request() { return true; } },
    clock: { now: () => new Date(), nowIso: () => new Date().toISOString() },
    ids: { id: () => "id" },
    skills: { resolve: () => [] },
    resolveAgent: (id) => ({ adapter: "claude", agentName: id }),
    getTeam: () => ({
      id: "t",
      name: "t",
      enabled: true,
      source: "user",
      kind: "delegation",
      entryRoleId: "r-impl",
      roster,
      policy,
      createdAt: "",
      updatedAt: ""
    })
  });
  const runId = await runtime.start({
    goal: "ship it",
    teamId: "t",
    teamSnapshot: { roster, policy, entryRoleId: "r-impl" },
    runtimeVersion: "1.0.0",
    runtimeApiVersion: "1.0.0"
  });
  const run = repository.getRun(runId);
  assert.ok(run);
  assert.equal(run.runtimeVersion, "1.0.0");
  assert.ok(["completed", "failed", "running"].includes(run.status));
});

test("crash recovery marks active events failed via repository transitions", () => {
  const repository = createMemoryDelegationRepository();
  const run = repository.createRun({
    goal: "g",
    status: "running",
    teamId: "t",
    teamSnapshotJson: "{}"
  });
  const eventId = repository.insertEvent({
    runId: run.id,
    parentEventId: null,
    agentId: "a",
    agentName: "a",
    roleLabel: "a",
    taskText: "t",
    depth: 0,
    canWrite: false,
    status: "running"
  });
  assert.equal(repository.transitionEvent(eventId, "failed", "Interrupted by app restart."), true);
  assert.equal(repository.getEvent(eventId)?.status, "failed");
  assert.equal(repository.setStatus(run.id, "failed"), true);
});
