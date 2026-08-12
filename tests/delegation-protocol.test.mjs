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
  assert.match(prompt, /立即结束本轮|禁止再.*check_delegate_result/);
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
  assert.match(check, /END THIS TURN IMMEDIATELY/i);
  assert.match(check, /Do NOT call `check_delegate_result` again/i);

  const skill = buildDelegationSkillMarkdown();
  assert.match(skill, /no ping-pong/);
  assert.match(skill, /entire task/);
  assert.match(skill, /wake/i);
  assert.match(skill, /submit_verdict/);
  assert.match(skill, /1\.2\.1/);
  assert.match(skill, /END THIS TURN IMMEDIATELY/);
  assert.doesNotMatch(skill, /every 3-5 seconds until status is/);
  assert.doesNotMatch(skill, /You MAY end your turn/);

  assert.ok(PROTOCOL_RULES.runningMeansEndTurn.includes("wake"));
  assert.ok(PROTOCOL_RULES.runningMeansEndTurn.includes("END THIS TURN IMMEDIATELY"));
  assert.match(PROTOCOL_RULES.runningCheckInstruction, /End this turn now/i);
});

test("checked-in SKILL.md matches protocol skill generator key rules", async () => {
  const skillPath = path.resolve("assets/skills/delegation/SKILL.md");
  const disk = fs.readFileSync(skillPath, "utf8");
  assert.match(disk, /no ping-pong/);
  assert.match(disk, /entire task/);
  assert.match(disk, /wake/i);
  assert.match(disk, /pending/);
  assert.match(disk, /submit_verdict/);
  assert.match(disk, /1\.2\.1/);
  assert.match(disk, /END THIS TURN IMMEDIATELY/);
  assert.doesNotMatch(disk, /Poll `check_delegate_result\(request_id\)` every 3-5 seconds\. When `status` is `"done"`/);
  assert.doesNotMatch(disk, /You MAY end your turn/);
});

test("wake prompt branches on verdict", async () => {
  const { buildDelegateWakePrompt } = await import(
    "../dist-electron/cli/delegation/protocol/text.js"
  );
  const roster = [
    { id: "r-impl", label: "实现", agentId: "a", capability: "写", canWrite: true },
    { id: "r-rev", label: "评审", agentId: "b", capability: "审", canWrite: false }
  ];
  const base = { taskText: "审查 hint", roleLabel: "评审", status: "done", resultSummary: "详情…" };

  const pass = buildDelegateWakePrompt({ ...base, verdict: "pass" }, roster, "r-impl", 0, 3);
  assert.match(pass, /可收尾|通过/);
  assert.doesNotMatch(pass, /必须再.*delegate|不要宣布收尾/);

  const needs = buildDelegateWakePrompt(
    { ...base, verdict: "needs_changes", verdictSummary: "toast" },
    roster, "r-impl", 0, 3
  );
  assert.match(needs, /delegate/);
  assert.match(needs, /复审|再次/);
  assert.match(needs, /不要宣布收尾|收尾之前/);
  assert.match(needs, /评审/);

  const missing = buildDelegateWakePrompt(
    { ...base, verdict: null },
    roster, "r-impl", 0, 3
  );
  assert.match(missing, /未提交|conservative|保守/i);
  assert.match(missing, /delegate/);
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
