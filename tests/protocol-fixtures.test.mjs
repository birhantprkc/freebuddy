import test from "node:test";
import assert from "node:assert/strict";

const { HOST_API_VERSION, RUNTIME_BUNDLE_ID, RUNTIME_RPC_VERSION } = await import(
  "../packages/protocol/dist/runtime.js"
);

test("workflow plan fixture keeps serialized field names", async () => {
  const plan = {
    name: "Review Loop",
    goal: "Fix the bug",
    template: "review-loop",
    maxLoops: 3,
    phases: [
      {
        id: "p1",
        title: "Phase 1",
        parallelism: 1,
        steps: [
          {
            id: "s1",
            title: "Research",
            agentId: "cli-codex-acp",
            mode: "research",
            prompt: "Look around"
          }
        ],
        gate: { type: "all_done" }
      }
    ]
  };
  const json = JSON.parse(JSON.stringify(plan));
  assert.equal(json.phases[0].steps[0].agentId, "cli-codex-acp");
  assert.equal(json.phases[0].gate.type, "all_done");
  assert.equal(json.template, "review-loop");
});

test("delegation result fixture keeps versioned contract fields", () => {
  const result = {
    schemaVersion: 1,
    status: "done",
    summary: "ok",
    exitCode: 0,
    error: null,
    artifacts: [{ kind: "text", label: "note" }],
    verdict: "pass",
    verdictSummary: "ready"
  };
  const json = JSON.parse(JSON.stringify(result));
  assert.equal(json.schemaVersion, 1);
  assert.equal(json.verdict, "pass");
  assert.equal(json.error, null);
});

test("runtime manifest primitives are stable", () => {
  assert.equal(RUNTIME_RPC_VERSION, 1);
  assert.equal(RUNTIME_BUNDLE_ID, "dev.freebuddy.runtime");
  assert.equal(HOST_API_VERSION, "1.0.0");
});
