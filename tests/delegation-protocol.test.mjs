import "./fixtures/electron-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("protocol text is the single source for roster / MCP / skill phrases", async () => {
  const {
    buildDelegationRosterPrompt,
    mcpDelegateDescription,
    mcpCheckResultDescription,
    buildDelegationSkillMarkdown,
    PROTOCOL_RULES
  } = await import("../dist-electron/cli/delegation/protocol/text.js");

  const roster = [
    { id: "r-impl", label: "实现", agentId: "a", capability: "写代码", canWrite: true },
    { id: "r-rev", label: "评审", agentId: "b", capability: "审代码", canWrite: false }
  ];
  const prompt = buildDelegationRosterPrompt(roster, "r-impl", 0, 3);
  assert.match(prompt, /pending/);
  assert.match(prompt, /running/);
  assert.match(prompt, /唤醒/);
  assert.match(prompt, /别反弹/);
  assert.match(prompt, /整份任务/);

  const del = mcpDelegateDescription();
  assert.match(del, /pending/);
  assert.match(del, /no ping-pong|bounce/i);
  assert.match(del, /entire task/i);

  const check = mcpCheckResultDescription();
  assert.match(check, /wake/i);
  assert.match(check, /pending/i);
  assert.match(check, /running/i);

  const skill = buildDelegationSkillMarkdown();
  assert.match(skill, /no ping-pong/);
  assert.match(skill, /entire task/);
  assert.match(skill, /wake/i);
  assert.doesNotMatch(skill, /every 3-5 seconds until status is/);

  assert.ok(PROTOCOL_RULES.runningMeansMayEndTurn.includes("wake"));
});

test("checked-in SKILL.md matches protocol skill generator key rules", async () => {
  const skillPath = path.resolve("assets/skills/delegation/SKILL.md");
  const disk = fs.readFileSync(skillPath, "utf8");
  assert.match(disk, /no ping-pong/);
  assert.match(disk, /entire task/);
  assert.match(disk, /wake/i);
  assert.match(disk, /pending/);
  assert.doesNotMatch(disk, /Poll `check_delegate_result\(request_id\)` every 3-5 seconds\. When `status` is `"done"`/);
});

test("mcp submit_verdict description mentions required enums", async () => {
  const { mcpSubmitVerdictDescription } = await import(
    "../dist-electron/cli/delegation/protocol/text.js"
  );
  const d = mcpSubmitVerdictDescription();
  assert.match(d, /submit_verdict|verdict/i);
  assert.match(d, /pass/);
  assert.match(d, /needs_changes/);
  assert.match(d, /fail/);
});

test("task similarity / whole-task guard", async () => {
  const { taskSimilarity, isWholeTaskRedelegate, normalizeTaskText } = await import(
    "../dist-electron/cli/delegation/protocol/guards.js"
  );
  assert.equal(normalizeTaskText("  Foo   BAR "), "foo bar");
  assert.ok(taskSimilarity("审 auth 模块", "审 auth 模块") === 1);
  assert.ok(isWholeTaskRedelegate(
    "请只读审查当前工作区中 upgrade-system.js",
    "请只读审查当前工作区中 upgrade-system.js"
  ));
  assert.equal(
    isWholeTaskRedelegate(
      "修复评审指出的第 3 个问题：统一 hammer costs schema",
      "请只读审查当前工作区中 upgrade-system.js 与 tests"
    ),
    false
  );
});
