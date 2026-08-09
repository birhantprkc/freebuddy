import "./fixtures/electron-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";

test("roster prompt lists teammates minus self with depth", async () => {
  const { buildDelegationRosterPrompt } = await import("../dist-electron/cli/delegationPrompt.js");
  const roster = [
    { id: "r-impl", label: "实现", agentId: "a", capability: "写代码", canWrite: true },
    { id: "r-rev", label: "评审", agentId: "b", capability: "审代码", canWrite: false }
  ];
  const p = buildDelegationRosterPrompt(roster, "r-impl", 1, 3);
  assert.match(p, /当前深度 1 \/ 上限 3/);
  assert.match(p, /\[r-rev\]/);
  assert.doesNotMatch(p, /\[r-impl\]/);
  assert.match(p, /只读|可写/);
});

test("task prompt wraps the task with the roster header", async () => {
  const { buildDelegateTaskPrompt } = await import("../dist-electron/cli/delegationPrompt.js");
  const roster = [{ id: "r-x", label: "X", agentId: "a", capability: "do x", canWrite: false }];
  const p = buildDelegateTaskPrompt("审 auth", roster, "r-x", 2, 3);
  assert.match(p, /审 auth/);
  assert.match(p, /协作团队/);
});
