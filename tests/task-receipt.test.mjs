import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

async function loadModule() {
  const source = fs.readFileSync(
    new URL("../src/utils/taskReceipt.ts", import.meta.url),
    "utf8"
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
  );
}

test("task receipt summarizes today's unique completions and success rate", async () => {
  const mod = await loadModule();
  const summary = mod.buildTaskReceiptSummary(
    [
      {
        id: "run-1",
        title: "整理季度汇报",
        result: "success",
        completedAt: "2026-08-09T08:00:00.000Z"
      },
      {
        id: "run-2",
        title: "检查发布配置",
        result: "failure",
        completedAt: "2026-08-09T09:00:00.000Z"
      },
      {
        id: "run-3",
        title: "汇总用户反馈",
        result: "success",
        completedAt: "2026-08-09T10:00:00.000Z"
      },
      {
        id: "run-3",
        title: "重复事件不会计数",
        result: "success",
        completedAt: "2026-08-09T10:00:00.000Z"
      }
    ],
    new Date("2026-08-09T12:00:00.000Z")
  );

  assert.equal(summary.successCount, 2);
  assert.equal(summary.totalCount, 3);
  assert.equal(summary.completionRate, 67);
  assert.deepEqual(summary.representativeTasks, ["汇总用户反馈", "整理季度汇报"]);
});

test("task receipt calculates a consecutive local-day streak", async () => {
  const mod = await loadModule();
  const completions = [0, 1, 2].map((daysAgo) => {
    const completedAt = new Date(2026, 7, 9 - daysAgo, 12).toISOString();
    return {
      id: `run-${daysAgo}`,
      title: `任务 ${daysAgo}`,
      result: "success",
      completedAt
    };
  });
  const summary = mod.buildTaskReceiptSummary(
    completions,
    new Date(2026, 7, 9, 18)
  );
  assert.equal(summary.streakDays, 3);
});

test("task receipt rejects malformed completion records", async () => {
  const mod = await loadModule();
  assert.equal(
    mod.normalizeTaskReceiptCompletion({
      id: "",
      title: "任务",
      result: "success",
      completedAt: new Date().toISOString()
    }),
    null
  );
  assert.equal(
    mod.normalizeTaskReceiptCompletion({
      id: "run",
      title: "",
      result: "success",
      completedAt: new Date().toISOString()
    }),
    null
  );
});

test("task receipt auto-opens once after the third success of the day", async () => {
  const mod = await loadModule();
  const summary = {
    dayKey: "2026-08-09",
    successCount: 3,
    totalCount: 3,
    completionRate: 100,
    streakDays: 1,
    representativeTasks: []
  };
  assert.equal(mod.shouldAutoOpenTaskReceipt(summary, "success"), true);
  assert.equal(
    mod.shouldAutoOpenTaskReceipt(summary, "success", "2026-08-09"),
    false
  );
  assert.equal(mod.shouldAutoOpenTaskReceipt(summary, "failure"), false);
});
