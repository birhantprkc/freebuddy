# Delegation Verdict + 修复后再次委派 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让子委派通过 MCP `submit_verdict` 写入结构化结论，父节点唤醒时按 `pass` / `needs_changes` / `fail` / 缺失分支提示「修完必须再委派复审」。

**Architecture:** Verdict 落在 `delegation_events`；`submit_verdict` 经现有 delegate bridge 写入本节点；`buildDelegateWakePrompt`（`protocol/text.ts` 单源）按 verdict 分支；orchestrator / runtime 从 settled event 读字段传入。软约束，不拦截 `TurnEnded`。

**Tech Stack:** TypeScript (Electron main), better-sqlite3, MCP SDK, node:test, 现有 `electron/cli/delegation/**` 协议层。

**Spec:** `docs/superpowers/specs/2026-08-12-delegation-verdict-redelegate-design.zh-CN.md`

## Global Constraints

- 约束级别：文案 + 轻量运行时；**不**拦截 `TurnEnded`，**不**自动代发复审
- `verdict` ∈ `pass` | `needs_changes` | `fail` | `null`（未提交）
- 协议文案单源：`electron/cli/delegation/protocol/text.ts`；Skill 版本升到 `1.2.0`
- `binding.parentEventId` 表示**当前节点** event id（历史命名）；`submit_verdict` 写入该 id
- 测试前需 `npm run build:electron`（测试从 `dist-electron/` import）
- 不改 `list_teammates` 祖先过滤；不修 Cursor MCP rawOutput 可观测性

## File map

| File | Responsibility |
|------|----------------|
| `electron/cli/delegationTeamTypes.ts` | `DelegationVerdict` 类型；`DelegationEvent` 新字段 |
| `electron/cli/db.ts` | `delegation_events` 列迁移 |
| `electron/cli/delegationRuns.ts` | row 映射、`updateDelegationEvent` patch |
| `electron/cli/delegation/protocol/tools.ts` | `submitVerdictAction`；`checkDelegateResultAction` 返回 verdict |
| `electron/cli/delegationDispatch.ts` | 路由 `submit_verdict` |
| `electron/mcp/delegateMcpServer.ts` | 注册 MCP tool |
| `electron/cli/delegation/protocol/text.ts` | MCP 描述、wake 分支、skill 1.2.0、canonical phrases |
| `assets/skills/delegation/SKILL.md` | 与 generator 同步 |
| `electron/cli/delegation/bus/types.ts` | `ChildSettled` / `SpawnWake` 带 verdict |
| `electron/cli/delegation/bus/stateMachine.ts` | 透传 verdict 到 `SpawnWake` |
| `electron/cli/delegation/bus/orchestrator.ts` | settled → wake 传入 verdict |
| `electron/cli/delegationRuntime.ts` | 同上（legacy park loop） |
| `tests/delegation-protocol.test.mjs` | wake 分支 + skill 短语 |
| `tests/delegation-guards-dispatch.test.mjs`（或新建 `tests/delegation-verdict.test.mjs`） | submit / check / 覆盖 / 非法 enum |

---

### Task 1: Schema + types

**Files:**
- Modify: `electron/cli/delegationTeamTypes.ts`
- Modify: `electron/cli/db.ts`（`delegation_events` CREATE + ALTER）
- Modify: `electron/cli/delegationRuns.ts`（`rowToEvent`、`UpdateDelegationEventPatch`）
- Test: `tests/delegation-verdict.test.mjs`（新建）

**Interfaces:**
- Produces:
  - `export type DelegationVerdict = "pass" | "needs_changes" | "fail"`
  - `DelegationEvent.verdict: DelegationVerdict | null`
  - `DelegationEvent.verdictSummary: string | null`
  - `updateDelegationEvent(id, { verdict?, verdictSummary? })`

- [ ] **Step 1: Write failing test**

Create `tests/delegation-verdict.test.mjs`:

```js
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

test("delegation_events stores verdict fields", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun, insertDelegationEvent, updateDelegationEvent, getDelegationEvent } =
      await import("../dist-electron/cli/delegationRuns.js");
    const runId = createDelegationRun({ goal: "g", teamId: "t", teamSnapshotJson: "{}" });
    const id = insertDelegationEvent({
      runId,
      parentEventId: null,
      agentId: "a",
      agentName: "评审",
      roleLabel: "评审",
      taskText: "审",
      depth: 1,
      canWrite: false,
      status: "running"
    });
    const before = getDelegationEvent(id);
    assert.equal(before.verdict, null);
    assert.equal(before.verdictSummary, null);
    updateDelegationEvent(id, { verdict: "needs_changes", verdictSummary: "fix toast" });
    const after = getDelegationEvent(id);
    assert.equal(after.verdict, "needs_changes");
    assert.equal(after.verdictSummary, "fix toast");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run build:electron && node --test --test-force-exit tests/delegation-verdict.test.mjs
```

Expected: FAIL（`verdict` undefined / SQL 无列）

- [ ] **Step 3: Implement types + migration + mapping**

`delegationTeamTypes.ts` — 在 `DelegationEventStatus` 旁加：

```ts
export type DelegationVerdict = "pass" | "needs_changes" | "fail";
```

`DelegationEvent` 增加：

```ts
verdict: DelegationVerdict | null;
verdictSummary: string | null;
```

`db.ts` — `CREATE TABLE delegation_events` 增加列：

```sql
verdict TEXT,
verdict_summary TEXT,
```

并在 CREATE 之后用 PRAGMA 迁移（与 `workflow_teams.kind` 同模式）：

```ts
const delegationEventCols = db
  .prepare("PRAGMA table_info(delegation_events)")
  .all() as Array<{ name: string }>;
if (!delegationEventCols.some((c) => c.name === "verdict")) {
  db.exec("ALTER TABLE delegation_events ADD COLUMN verdict TEXT");
}
if (!delegationEventCols.some((c) => c.name === "verdict_summary")) {
  db.exec("ALTER TABLE delegation_events ADD COLUMN verdict_summary TEXT");
}
```

`delegationRuns.ts` — `rowToEvent`：

```ts
verdict: (r.verdict as DelegationVerdict | null) ?? null,
verdictSummary: r.verdict_summary ?? null,
```

`UpdateDelegationEventPatch`：

```ts
verdict?: DelegationVerdict | null;
verdictSummary?: string | null;
```

在 `updateDelegationEvent` 中写入对应列。

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run build:electron && node --test --test-force-exit tests/delegation-verdict.test.mjs
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/cli/delegationTeamTypes.ts electron/cli/db.ts electron/cli/delegationRuns.ts tests/delegation-verdict.test.mjs
git commit -m "$(cat <<'EOF'
feat(delegation): persist verdict fields on delegation events

EOF
)"
```

---

### Task 2: `submitVerdictAction` + dispatch + check result

**Files:**
- Modify: `electron/cli/delegation/protocol/tools.ts`
- Modify: `electron/cli/delegationDispatch.ts`
- Modify: `tests/delegation-verdict.test.mjs`

**Interfaces:**
- Consumes: `updateDelegationEvent`, `getDelegationEvent`, `DelegateToolBinding.parentEventId`
- Produces:
  - `submitVerdictAction(binding, params): DelegateToolResponse`
  - `checkDelegateResultAction` 增加返回 `verdict` / `verdictSummary`
  - `runDelegateAction(..., "submit_verdict", ...)`

- [ ] **Step 1: Write failing tests**

Append to `tests/delegation-verdict.test.mjs`:

```js
test("submit_verdict writes and check_delegate_result returns it", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun, insertDelegationEvent, updateDelegationEvent } =
      await import("../dist-electron/cli/delegationRuns.js");
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    const runId = createDelegationRun({ goal: "g", teamId: "t", teamSnapshotJson: "{}" });
    const rootId = insertDelegationEvent({
      runId, parentEventId: null, agentId: "impl", agentName: "实现", roleLabel: "实现",
      taskText: "实现", depth: 0, canWrite: true, status: "running"
    });
    const revId = insertDelegationEvent({
      runId, parentEventId: rootId, agentId: "rev", agentName: "评审", roleLabel: "评审",
      taskText: "审查", depth: 1, canWrite: false, status: "running"
    });
    const binding = {
      token: "t", taskSessionId: "s", runId, parentEventId: revId, depth: 1,
      selfAgentId: "r-rev", selfLabel: "评审"
    };
    const deps = {
      contextProvider: () => undefined,
      executor: async () => ({ summary: "", exitCode: 0, error: null }),
      writeApproval: async () => true
    };
    const submitted = await runDelegateAction(binding, "submit_verdict", {
      verdict: "needs_changes",
      summary: "toast copy"
    }, deps);
    assert.equal(submitted.ok, true);
    assert.equal(submitted.verdict, "needs_changes");
    assert.equal(submitted.event_id, revId);

    updateDelegationEvent(revId, { status: "done", resultSummary: "long review text" });
    const checked = await runDelegateAction(binding, "check_delegate_result", {
      request_id: revId
    }, deps);
    assert.equal(checked.ok, true);
    assert.equal(checked.verdict, "needs_changes");
    assert.equal(checked.verdictSummary, "toast copy");
  });
});

test("submit_verdict rejects invalid enum and allows overwrite", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun, insertDelegationEvent } =
      await import("../dist-electron/cli/delegationRuns.js");
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    const runId = createDelegationRun({ goal: "g", teamId: "t", teamSnapshotJson: "{}" });
    const id = insertDelegationEvent({
      runId, parentEventId: null, agentId: "rev", agentName: "评审", roleLabel: "评审",
      taskText: "审", depth: 1, canWrite: false, status: "running"
    });
    const binding = {
      token: "t", taskSessionId: "s", runId, parentEventId: id, depth: 1,
      selfAgentId: "r-rev", selfLabel: "评审"
    };
    const deps = {
      contextProvider: () => undefined,
      executor: async () => ({ summary: "", exitCode: 0, error: null }),
      writeApproval: async () => true
    };
    const bad = await runDelegateAction(binding, "submit_verdict", { verdict: "lgtm" }, deps);
    assert.equal(bad.ok, false);
    const first = await runDelegateAction(binding, "submit_verdict", { verdict: "fail" }, deps);
    const second = await runDelegateAction(binding, "submit_verdict", {
      verdict: "pass", summary: "ok now"
    }, deps);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.verdict, "pass");
    const { getDelegationEvent } = await import("../dist-electron/cli/delegationRuns.js");
    assert.equal(getDelegationEvent(id).verdict, "pass");
    assert.equal(getDelegationEvent(id).verdictSummary, "ok now");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run build:electron && node --test --test-force-exit tests/delegation-verdict.test.mjs
```

Expected: FAIL（unknown action / 无 verdict）

- [ ] **Step 3: Implement**

`tools.ts` — 扩展 response 类型可选字段；实现：

```ts
const VERDICTS = new Set(["pass", "needs_changes", "fail"]);

export function submitVerdictAction(
  binding: DelegateToolBinding,
  params: Record<string, unknown>
): DelegateToolResponse {
  const verdict = String(params.verdict ?? "");
  if (!VERDICTS.has(verdict)) {
    return { ok: false, error: `invalid verdict: ${verdict}` };
  }
  const eventId = binding.parentEventId;
  if (!eventId || !getDelegationEvent(eventId)) {
    return { ok: false, error: "current event not found" };
  }
  const summary =
    params.summary === undefined || params.summary === null
      ? undefined
      : String(params.summary);
  updateDelegationEvent(eventId, {
    verdict: verdict as DelegationVerdict,
    ...(summary !== undefined ? { verdictSummary: summary } : {})
  });
  return { ok: true, verdict, event_id: eventId };
}
```

`checkDelegateResultAction`：

```ts
return {
  ok: true,
  status: event.status,
  result: event.resultSummary ?? "",
  request_id: requestId,
  verdict: event.verdict,
  verdictSummary: event.verdictSummary
};
```

`DelegateToolResponse` 增加可选 `verdict?` / `verdictSummary?`。

`delegationDispatch.ts` — 在 `list_teammates` 分支旁：

```ts
if (action === "submit_verdict") {
  return submitVerdictAction(binding, params);
}
```

从 `./delegation/protocol/tools.js` import `submitVerdictAction`。

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run build:electron && node --test --test-force-exit tests/delegation-verdict.test.mjs
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/cli/delegation/protocol/tools.ts electron/cli/delegationDispatch.ts tests/delegation-verdict.test.mjs
git commit -m "$(cat <<'EOF'
feat(delegation): add submit_verdict bridge action

EOF
)"
```

---

### Task 3: MCP `submit_verdict` tool

**Files:**
- Modify: `electron/cli/delegation/protocol/text.ts`（`mcpSubmitVerdictDescription`）
- Modify: `electron/mcp/delegateMcpServer.ts`
- Modify: `tests/delegation-protocol.test.mjs`（描述含关键短语）

**Interfaces:**
- Consumes: bridge `submit_verdict`
- Produces: MCP tool `submit_verdict`；`mcpSubmitVerdictDescription(): string`

- [ ] **Step 1: Write failing assertion**

In `tests/delegation-protocol.test.mjs` 增加：

```js
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
```

- [ ] **Step 2: Run to verify fail**

```bash
npm run build:electron && node --test --test-force-exit tests/delegation-protocol.test.mjs
```

Expected: FAIL（export 不存在）

- [ ] **Step 3: Implement description + MCP registration**

`text.ts`:

```ts
export function mcpSubmitVerdictDescription(): string {
  return [
    "Submit a structured verdict for the current delegated task before you finish.",
    "Required for review/audit sub-tasks.",
    "verdict must be one of: pass (ready to close), needs_changes (caller must fix then re-delegate review), fail (blocking).",
    "Optional summary: one or two sentences."
  ].join(" ");
}
```

`delegateMcpServer.ts` — import 并注册：

```ts
server.registerTool(
  "submit_verdict",
  {
    title: "Submit Delegation Verdict",
    description: mcpSubmitVerdictDescription(),
    inputSchema: {
      verdict: z.enum(["pass", "needs_changes", "fail"]),
      summary: z.string().optional().describe("Optional short summary.")
    }
  },
  async (args) => {
    try {
      return toolResult(await invokeDelegateBridge("submit_verdict", args));
    } catch (error) {
      return toolError(error);
    }
  }
);
```

- [ ] **Step 4: Run tests**

```bash
npm run build:electron && node --test --test-force-exit tests/delegation-protocol.test.mjs
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/cli/delegation/protocol/text.ts electron/mcp/delegateMcpServer.ts tests/delegation-protocol.test.mjs
git commit -m "$(cat <<'EOF'
feat(delegation): expose submit_verdict MCP tool

EOF
)"
```

---

### Task 4: Wake prompt branches + skill 1.2.0

**Files:**
- Modify: `electron/cli/delegation/protocol/text.ts`
- Modify: `assets/skills/delegation/SKILL.md`
- Modify: `tests/delegation-protocol.test.mjs`
- Modify: `tests/delegation-skill.test.mjs`（若断言 version）

**Interfaces:**
- Consumes: `DelegationVerdict | null`
- Produces: 更新后的 `buildDelegateWakePrompt(info & { verdict?: DelegationVerdict | null; verdictSummary?: string | null }, ...)`
- Skill markdown version `1.2.0`；含 `submit_verdict` 与复审约束

- [ ] **Step 1: Write failing wake-branch tests**

```js
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
```

Also update skill assertions to expect `1.2.0` and `submit_verdict`：

```js
assert.match(skill, /submit_verdict/);
assert.match(skill, /1\.2\.0/);
assert.match(disk, /submit_verdict/);
```

- [ ] **Step 2: Run to verify fail**

```bash
npm run build:electron && node --test --test-force-exit tests/delegation-protocol.test.mjs tests/delegation-skill.test.mjs
```

Expected: FAIL

- [ ] **Step 3: Implement wake branches + skill**

扩展 `DelegateWakeInfo`：

```ts
export interface DelegateWakeInfo {
  taskText: string;
  roleLabel: string;
  status: string;
  resultSummary: string;
  verdict?: DelegationVerdict | null;
  verdictSummary?: string | null;
}
```

`buildDelegateWakePrompt` 尾部指令改为：

```ts
const verdict = info.verdict ?? null;
const verdictLine =
  verdict === null
    ? "结构化结论：未提交 verdict（按 needs_changes 保守处理）。"
    : `结构化结论：verdict=${verdict}${info.verdictSummary ? `；摘要：${info.verdictSummary}` : ""}`;

let nextSteps: string;
if (verdict === "pass") {
  nextSteps =
    "评审已通过（pass）。若无新待办可以收尾；不要无故再开一轮复审。";
} else {
  // needs_changes | fail | null
  nextSteps = [
    "存在待改项或未通过（或对方未提交 verdict）。",
    "请先按上方结果修改。",
    `改完后必须再 delegate 给角色「${info.roleLabel}」做复审（用 list_teammates 选对应 id）。`,
    "在复审返回 verdict=pass 之前，不要宣布收尾。"
  ].join("");
}

return [
  buildDelegationRosterPrompt(...),
  "",
  "## 委派结果返回（你被唤醒）",
  `你之前委派给「${info.roleLabel}」的子任务已结束（status: ${info.status}）。`,
  verdictLine,
  "子任务：",
  info.taskText,
  "",
  "结果：",
  summary,
  "",
  nextSteps
].join("\n");
```

`buildDelegationSkillMarkdown`：version `1.2.0`；增加 Handle / Review 小节：

```md
## Review verdicts
For review/audit sub-tasks, call `submit_verdict` before you finish:
- `pass` — ready to close
- `needs_changes` — caller must fix, then re-delegate review
- `fail` — blocking

## After a wake with needs_changes/fail
Fix first, then `delegate` review again. Do not declare done until a later wake has `verdict=pass`.
```

同步重写 `assets/skills/delegation/SKILL.md` 为 generator 输出（或跑生成后粘贴）。  
`protocolCanonicalPhrases()` 增加：`submit_verdict`、`needs_changes`。

- [ ] **Step 4: Run tests**

```bash
npm run build:electron && node --test --test-force-exit tests/delegation-protocol.test.mjs tests/delegation-skill.test.mjs
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/cli/delegation/protocol/text.ts assets/skills/delegation/SKILL.md tests/delegation-protocol.test.mjs tests/delegation-skill.test.mjs
git commit -m "$(cat <<'EOF'
feat(delegation): branch wake prompts on structured verdict

EOF
)"
```

---

### Task 5: Plumb verdict through bus + runtime wake callers

**Files:**
- Modify: `electron/cli/delegation/bus/types.ts`
- Modify: `electron/cli/delegation/bus/stateMachine.ts`
- Modify: `electron/cli/delegation/bus/orchestrator.ts`
- Modify: `electron/cli/delegationRuntime.ts`
- Modify: `tests/delegation-bus-fsm.test.mjs`（透传断言，可选但推荐）

**Interfaces:**
- Consumes: `DelegationEvent.verdict` / `verdictSummary`
- Produces: `ChildSettled` / `SpawnWake` 含 `verdict` / `verdictSummary`；wake callers 传入 `buildDelegateWakePrompt`

- [ ] **Step 1: Extend FSM test**

In `tests/delegation-bus-fsm.test.mjs`，构造 `ChildSettled` 时带上：

```js
verdict: "needs_changes",
verdictSummary: "toast"
```

断言：

```js
const wake = effects.find((e) => e.type === "SpawnWake");
assert.equal(wake.verdict, "needs_changes");
assert.equal(wake.verdictSummary, "toast");
```

- [ ] **Step 2: Run to verify fail**

```bash
npm run build:electron && node --test --test-force-exit tests/delegation-bus-fsm.test.mjs
```

Expected: FAIL

- [ ] **Step 3: Implement plumbing**

`types.ts` — `ChildSettled` 与 `SpawnWake` 增加：

```ts
verdict?: string | null;
verdictSummary?: string | null;
```

`stateMachine.ts` — `SpawnWake` effect 复制这两字段。

`orchestrator.ts` — `onEventSettled` 与 park loop 里 `ChildSettled` / `buildDelegateWakePrompt`：

```ts
verdict: evt.verdict,
verdictSummary: evt.verdictSummary,
// ...
buildDelegateWakePrompt({
  taskText: settled?.taskText ?? "",
  roleLabel: settled?.roleLabel ?? "",
  status: settled?.status ?? "done",
  resultSummary: settled?.resultSummary ?? "",
  verdict: settled?.verdict ?? null,
  verdictSummary: settled?.verdictSummary ?? null
}, ...)
```

`delegationRuntime.ts` 中对应 `buildDelegateWakePrompt` 调用同样传入。

- [ ] **Step 4: Run related tests**

```bash
npm run build:electron && node --test --test-force-exit \
  tests/delegation-bus-fsm.test.mjs \
  tests/delegation-verdict.test.mjs \
  tests/delegation-protocol.test.mjs \
  tests/delegation-guards-dispatch.test.mjs \
  tests/delegation-followup-wake.test.mjs \
  tests/delegation-runtime.test.mjs
```

Expected: PASS

- [ ] **Step 5: Full handoff db suite slice + commit**

```bash
npm run test:handoff-db
```

（若太慢，至少跑上列 delegation 相关测试。）

```bash
git add electron/cli/delegation/bus/types.ts electron/cli/delegation/bus/stateMachine.ts electron/cli/delegation/bus/orchestrator.ts electron/cli/delegationRuntime.ts tests/delegation-bus-fsm.test.mjs
git commit -m "$(cat <<'EOF'
feat(delegation): pass verdict into wake orchestration

EOF
)"
```

---

## Spec coverage checklist

| Spec 项 | Task |
|---------|------|
| `verdict` / `verdict_summary` 列 | 1 |
| `submit_verdict` MCP + bridge | 2, 3 |
| `check_delegate_result` 返回 verdict | 2 |
| wake 三分支 + null 保守 | 4 |
| skill 1.2.0 / 单源 text.ts | 4 |
| bus/runtime 传入 | 5 |
| 不拦截 TurnEnded / 不自动 delegate | 全局约束（无代码） |
| 非法 enum / 覆盖 | 2 |
| 测试 | 1–5 |

## Plan self-review

- 无 TBD；签名与 `binding.parentEventId` = 当前 event 一致
- `verdictSummary` 命名在 TS 层统一 camelCase，DB 用 `verdict_summary`
- FSM 字段可选，避免破坏仅传旧字段的测试调用点；新测试显式传 verdict
