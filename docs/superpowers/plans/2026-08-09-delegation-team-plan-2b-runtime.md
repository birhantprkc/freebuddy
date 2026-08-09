# Delegation Team · Plan 2b: DelegationRuntime (orchestration layer)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the delegation bus (Plan 2a) into a real runtime: a `DelegationRuntime` that starts a run (spawns the entry agent with the delegation MCP + skill + roster prompt), provides the real `DelegateExecutor` (spawns child agents via `cliRun` so delegation recurses), a spawner-level write-approval gate (pauses → asks UI → resumes), run lifecycle + restart recovery, MCP injection into `acpRuntime`, and the IPC entry points. Plan 3 adds the UI.

**Architecture:** Mirror `WorkflowRuntime`/`workflowIpc.ts`: a singleton `DelegationRuntime({ webContents, resolveAgent, runAgent })` created per window. `runAgent` wraps `cliRun` + output harvest (injectable for tests). The runtime registers itself with the dispatch core via `setDelegateDeps` (contextProvider + executor + writeApproval). MCP injection: add a `delegation?` field to `CliRunArgs`; `acpRuntime` calls `registerDelegateToolSession` when present (so both entry and child agents get the `freebuddy-delegate` MCP and can recurse). The synchronous blocking is native — the entry agent's `session/prompt` stays pending while its `delegate()` MCP handler runs (Plan 2a + confirmed in research).

**Tech Stack:** TypeScript, Electron, better-sqlite3, node:test.
**Depends on:** Plan 1 (delegationRuns/Teams/Types) + Plan 2a (delegationDispatch, delegationToolService, inactivitySuppression, delegateMcpServer).
**Spec:** §运行时状态机, §委派协议, §治理与安全.
**Worktree:** `.worktrees/delegation-team` on `feature/delegation-team`.

---

## File Structure

- **Create** `assets/skills/delegation/SKILL.md` — the built-in delegation skill (auto-seeded by `seedBuiltinSkills`, id = `delegation`).
- **Create** `electron/cli/delegationPrompt.ts` — `buildDelegationRosterPrompt(roster, selfId, depth, maxDepth)` (pure) + `buildDelegateTaskPrompt(task, roster, selfId, depth, maxDepth)` (pure).
- **Create** `electron/cli/delegationRunner.ts` — `createDelegateAgentRunner(webContents)` (real `runAgent` over `cliRun` + harvest) + `summarizeDelegateOutput(items)` (pure) + `DelegateAgentRunner` type.
- **Create** `electron/cli/delegationRuntime.ts` — `DelegationRuntime` class: per-run context map, write-approval gate (promise registry + broadcast), `setDelegateDeps` wiring, `start(input)` (create run + root event + spawn entry), `resolveWriteApproval(approvalId, approved)`, `recoverInterrupted()`; `DELEGATION_SKILL_ID`.
- **Modify** `electron/cli/runtimeShared.ts` — add `delegation?: DelegationCliContext` to `CliRunArgs` + the type.
- **Modify** `electron/cli/acpRuntime.ts` — when `args.delegation` present, `mcpServers.push(await registerDelegateToolSession({...}))` before `establishSession()`; `unregisterDelegateToolSession(args.sessionId)` in `finish()`.
- **Create** `electron/cli/delegationIpc.ts` — `ensureDelegationRuntime(event)`, `registerDelegationIpc()` (handlers `workflow:createDelegationRun`, `workflow:approveDelegateWrite`; calls `recoverInterruptedDelegationRuns`), broadcast helper.
- **Modify** `electron/cli/workflows.ts` — add `recoverInterruptedDelegationRuns()`.
- **Modify** `electron/main.ts` — call `registerDelegationIpc()` next to `registerWorkflowIpc()`.
- **Modify** `electron/preload.ts` + `src/services/...` — expose the two new IPC channels on `window.freebuddy` (renderer bridge; minimal, Plan 3 consumes).
- **Create** `tests/delegation-prompt.test.mjs`, `tests/delegation-runner.test.mjs`, `tests/delegation-runtime.test.mjs`, `tests/delegation-skill.test.mjs`.

> **Testability strategy:** `DelegationRuntime` accepts an injectable `runAgent` (like `WorkflowRuntime.deps.executor`). Tests inject a fake `runAgent` + fake `webContents`, so the gate/context/recovery/run-start logic is unit-tested without real CLI/ACP. The real `runAgent` (`createDelegateAgentRunner`) is tested via the pure `summarizeDelegateOutput`. The acpRuntime MCP-injection edit and the IPC glue are verified by build + code review (they're surgical clones of existing patterns) and an end-to-end smoke deferred to Plan 3.

---

## Task 1: Delegation skill file

**Files:** Create `assets/skills/delegation/SKILL.md`

- [ ] **Step 1: Create `assets/skills/delegation/SKILL.md`**

```markdown
---
name: delegation
description: Collaborate with teammate agents in a self-organizing delegation run. Discover teammates and delegate sub-tasks synchronously.
version: 1.0.0
---

# Delegation

You are part of a self-organizing team. You can delegate sub-tasks to teammates and receive delegated sub-tasks from your caller.

## When to delegate
Delegate a sub-task ONLY when:
- It falls clearly in a teammate's `capability` (read it via `list_teammates`), AND
- It is non-trivial work you are not best suited to do yourself.

Do NOT delegate:
- Small things you can do directly.
- Back to your caller (no ping-pong).
- The entire task you were given.

## How to delegate
1. Call `list_teammates` to see who is available and their `capability` (excluding yourself).
2. Call `delegate(teammate_id, task)` with a self-contained `task` description. The call blocks until the teammate finishes and returns `{status, result, event_id}`.
3. Use the returned `result` to continue your own work.

## Handle the result
- `status: "done"` → use `result`.
- `status: "failed"` / `"timeout"` → decide: retry, delegate to a different teammate, or do it yourself. Do not loop forever.

## Current context
Your current delegation depth and the team roster are provided in your prompt header. There is a depth cap; as you approach it, prefer doing the work yourself over delegating.
```

- [ ] **Step 2: Create `tests/delegation-skill.test.mjs`**

```js
import "./fixtures/electron-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";

let Database, bindingAvailable = true;
try { Database = (await import("better-sqlite3")).default; new Database(":memory:").close(); } catch { bindingAvailable = false; }

test("delegation skill seeds as builtin trusted with id 'delegation'", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  const db = new Database(":memory:");
  const { migrate, setDbForTest } = await import("../dist-electron/cli/db.js");
  migrate(db); setDbForTest(db);
  t.after(() => { setDbForTest(null); db.close(); });
  const { seedBuiltinSkills, getSkill } = await import("../dist-electron/cli/skills.js");
  seedBuiltinSkills();
  const skill = getSkill("delegation");
  assert.ok(skill, "delegation skill not seeded");
  assert.equal(skill.source, "builtin");
  assert.equal(skill.trusted, 1 || true);
  assert.equal(skill.enabled, 1 || true);
});
```

- [ ] **Step 3: Run, confirm FAIL (skill not seeded — file didn't exist at build)**
`npm run build:electron && node scripts/run-electron-node-test.mjs tests/delegation-skill.test.mjs`
> If the assets dir isn't copied into dist for the test, verify how `builtinRoot()` resolves in dev (it points at `assets/skills`). The test runs against the source tree's `assets/skills/delegation/SKILL.md`. If `builtinRoot()` in the built/test context points elsewhere, read `skills.ts:builtinRoot` and ensure the file is where it looks; adjust the path only if needed.

- [ ] **Step 4: Run, confirm PASS**

- [ ] **Step 5: Add `tests/delegation-skill.test.mjs` to `test:handoff-db` in `package.json`.**

- [ ] **Step 6: Commit**
```bash
git add assets/skills/delegation/SKILL.md tests/delegation-skill.test.mjs package.json
git commit -m "feat(delegation): add builtin delegation skill"
```

---

## Task 2: Roster prompt builders (pure)

**Files:** Create `electron/cli/delegationPrompt.ts`; Test `tests/delegation-prompt.test.mjs`

- [ ] **Step 1: Test `tests/delegation-prompt.test.mjs`**

```js
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
```

- [ ] **Step 2: Run, confirm FAIL**

- [ ] **Step 3: Create `electron/cli/delegationPrompt.ts`**

```ts
import type { DelegationRosterEntry } from "./delegationTeamTypes.js";

function writeFlag(canWrite: boolean): string {
  return canWrite ? "可写" : "只读";
}

export function buildDelegationRosterPrompt(
  roster: DelegationRosterEntry[],
  selfId: string,
  depth: number,
  maxDepth: number
): string {
  const lines = roster
    .filter((r) => r.id !== selfId)
    .map((r) => `- [${r.id}] ${r.label} (${writeFlag(r.canWrite)})："${r.capability}"`)
    .join("\n");
  return [
    "## 协作团队（可委派）",
    "某子任务更适合某队友时，调 MCP 工具 delegate(teammate_id, task)；list_teammates() 查队友。",
    "优先自己能完成的；别滥用委派；别反弹回调用方。",
    `当前深度 ${depth} \/ 上限 ${maxDepth}。`,
    "队友：",
    lines || "- （无其他队友）"
  ].join("\n");
}

export function buildDelegateTaskPrompt(
  task: string,
  roster: DelegationRosterEntry[],
  selfId: string,
  depth: number,
  maxDepth: number
): string {
  return [buildDelegationRosterPrompt(roster, selfId, depth, maxDepth), "", "## 本次任务", task].join("\n");
}
```

- [ ] **Step 4: Run, confirm PASS**

- [ ] **Step 5: Add to `test:handoff-db`; Commit**
```bash
git add electron/cli/delegationPrompt.ts tests/delegation-prompt.test.mjs package.json
git commit -m "feat(delegation): add roster/task prompt builders"
```

---

## Task 3: Real delegate runner (cliRun + harvest)

**Files:** Create `electron/cli/delegationRunner.ts`; Test `tests/delegation-runner.test.mjs`

- [ ] **Step 1: Test `tests/delegation-runner.test.mjs`**

```js
import "./fixtures/electron-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";

test("summarizeDelegateOutput joins assistant text items", async () => {
  const { summarizeDelegateOutput } = await import("../dist-electron/cli/delegationRunner.js");
  const items = [
    { type: "text", text: "hello " },
    { type: "thinking", text: "internal" },
    { type: "text", text: "world" },
    { type: "tool_call" }
  ];
  assert.equal(summarizeDelegateOutput(items), "hello world");
});

test("summarizeDelegateOutput falls back when no text", async () => {
  const { summarizeDelegateOutput } = await import("../dist-electron/cli/delegationRunner.js");
  assert.match(summarizeDelegateOutput([{ type: "tool_call" }]), /tool actions|completed/i);
  assert.equal(summarizeDelegateOutput([]).length > 0, true);
});
```

- [ ] **Step 2: Run, confirm FAIL**

- [ ] **Step 3: Create `electron/cli/delegationRunner.ts`**

```ts
import type { WebContents } from "electron";
import { cliRun } from "./runtime.js";
import type { CliRunArgs } from "./runtimeShared.js";

export interface DelegateRunResult {
  summary: string;
  exitCode: number | null;
  error: string | null;
}

export type DelegateAgentRunner = (args: CliRunArgs) => Promise<DelegateRunResult>;

const MAX_SUMMARY_CHARS = 12_000;

export function summarizeDelegateOutput(items: unknown[]): string {
  const texts: string[] = [];
  for (const raw of items) {
    const item = raw as { type?: string; text?: string };
    if (item && item.type === "text" && typeof item.text === "string") {
      texts.push(item.text);
    }
  }
  const joined = texts.join("").trim();
  if (joined) {
    return joined.length <= MAX_SUMMARY_CHARS
      ? joined
      : joined.slice(0, MAX_SUMMARY_CHARS / 2) + `\n…[truncated]…\n` + joined.slice(joined.length - MAX_SUMMARY_CHARS / 2);
  }
  const toolCount = items.filter((i) => (i as { type?: string }).type === "tool_call").length;
  return toolCount > 0 ? `Completed ${toolCount} tool action${toolCount > 1 ? "s" : ""}.` : "(no output)";
}

export function createDelegateAgentRunner(webContents: WebContents | undefined): DelegateAgentRunner {
  return async (args: CliRunArgs): Promise<DelegateRunResult> => {
    const collected: unknown[] = [];
    let exitCode: number | null = null;
    let errored: string | null = null;
    await cliRun(webContents, args, (e) => {
      if (e.type === "items" && (e as { items?: unknown[] }).items?.length) {
        collected.push(...((e as { items: unknown[] }).items));
      } else if (e.type === "done") {
        exitCode = (e as { exitCode: number }).exitCode;
      } else if (e.type === "error") {
        errored = (e as { message: string }).message;
      }
    });
    return {
      summary: summarizeDelegateOutput(collected),
      exitCode,
      error: errored
    };
  };
}
```

> Confirm the `CliEvent` shape used above (`e.type === "items" | "done" | "error"`, with `items`/`exitCode`/`message`) matches `runtimeShared.ts` (the explore report confirmed these variants). If field names differ, adapt.

- [ ] **Step 4: Run, confirm PASS**

- [ ] **Step 5: Add to `test:handoff-db`; Commit**
```bash
git add electron/cli/delegationRunner.ts tests/delegation-runner.test.mjs package.json
git commit -m "feat(delegation): add real delegate runner (cliRun + harvest)"
```

---

## Task 4: DelegationRuntime (gate + context + run start + recovery)

**Files:** Create `electron/cli/delegationRuntime.ts`; Test `tests/delegation-runtime.test.mjs`

- [ ] **Step 1: Test `tests/delegation-runtime.test.mjs`** (inject fake runAgent + fake context)

```js
import "./fixtures/electron-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";

let Database, bindingAvailable = true;
try { Database = (await import("better-sqlite3")).default; new Database(":memory:").close(); } catch { bindingAvailable = false; }

async function withDb(fn) {
  const db = new Database(":memory:");
  const { migrate, setDbForTest } = await import("../dist-electron/cli/db.js");
  migrate(db); setDbForTest(db);
  try { await fn(); } finally { setDbForTest(null); db.close(); }
}

const roster = [
  { id: "r-impl", label: "实现", agentId: "cli-codex-acp", capability: "写", canWrite: true },
  { id: "r-rev", label: "评审", agentId: "cli-claude-agent-acp", capability: "审", canWrite: false }
];
const policy = { allowWrites: true, requireApprovalBeforeDelegateWrite: true, maxDepth: 3, delegateTimeoutMs: 600000, maxConcurrentDelegates: 1, stopOnDelegateFailure: false };

test("context provider returns the run's roster/policy", async (t) => {
  if (!bindingAvailable) { t.skip(); return; }
  await withDb(async () => {
    const { DelegationRuntime, DELEGATION_SKILL_ID } = await import("../dist-electron/cli/delegationRuntime.js");
    const rt = new DelegationRuntime({ webContents: undefined, resolveAgent: () => undefined, runAgent: async () => ({ summary: "", exitCode: 0, error: null }) });
    const runId = rt.prepareRun({ goal: "g", teamId: "t", teamSnapshot: { roster, policy, entryRoleId: "r-impl" }, cwd: "/r" });
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
    const runId = rt.prepareRun({ goal: "g", teamId: "t", teamSnapshot: { roster, policy, entryRoleId: "r-impl" }, cwd: "/r" });
    const teammate = roster[0];
    const promise = rt.requestWriteApproval(runId, teammate);
    const pending = rt.listPendingApprovals();
    assert.equal(pending.length, 1);
    rt.resolveWriteApproval(pending[0].approvalId, true);
    assert.equal(await promise, true);
    rt.prepareRun({ goal: "g2", teamId: "t", teamSnapshot: { roster, policy, entryRoleId: "r-impl" }, cwd: "/r" });
    const p2 = rt.requestWriteApproval(runId, teammate);
    const a2 = rt.listPendingApprovals()[0];
    rt.resolveWriteApproval(a2.approvalId, false);
    assert.equal(await p2, false);
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
    const runId = await rt.start({ goal: "实现X", teamId: "t", teamSnapshot: { roster, policy, entryRoleId: "r-impl" }, cwd: "/r", conversationId: undefined });
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
```

- [ ] **Step 2: Run, confirm FAIL**

- [ ] **Step 3: Create `electron/cli/delegationRuntime.ts`**

```ts
import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import { safeSendToWebContents } from "./ipcSend.js";
import { logMain } from "../debugLog.js";
import { getDb } from "./db.js";
import {
  createDelegationRun,
  setDelegationRunStatus,
  insertDelegationEvent,
  updateDelegationEvent
} from "./delegationRuns.js";
import type { DelegationRosterEntry, DelegationPolicy, DelegationTeam } from "./delegationTeamTypes.js";
import { resolveSkillSnapshots } from "./skills.js";
import { setDelegateDeps, type DelegateRunContext, type DelegateExecutor, type DelegateExecArgs, type DelegateExecResult, type DelegateToolBinding } from "./delegationDispatch.js";
import { buildDelegationRosterPrompt, buildDelegateTaskPrompt } from "./delegationPrompt.js";
import type { DelegateAgentRunner } from "./delegationRunner.js";

export const DELEGATION_SKILL_ID = "delegation";

type ResolvedAgent = {
  adapter: string;
  agentName: string;
  binary?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
  skillIds?: string[];
};

export interface DelegationRuntimeDeps {
  webContents: WebContents | undefined;
  resolveAgent: (agentId: string) => ResolvedAgent | undefined;
  runAgent: DelegateAgentRunner;
}

interface RunContext {
  runId: string;
  teamId: string;
  roster: DelegationRosterEntry[];
  policy: DelegationPolicy;
  entryRoleId: string;
  cwd?: string;
  conversationId?: string;
}

interface PendingApproval {
  approvalId: string;
  runId: string;
  teammate: DelegationRosterEntry;
  resolve: (approved: boolean) => void;
}

export class DelegationRuntime {
  private contexts = new Map<string, RunContext>();
  private pendingApprovals: PendingApproval[] = [];
  constructor(private deps: DelegationRuntimeDeps) {
    setDelegateDeps({
      contextProvider: (runId) => this.getContext(runId),
      executor: (args) => this.executor(args),
      writeApproval: (binding, teammate) => this.requestWriteApproval(binding.runId, teammate)
    });
  }

  getContext(runId: string): DelegateRunContext | undefined {
    const ctx = this.contexts.get(runId);
    if (!ctx) return undefined;
    return { roster: ctx.roster, policy: ctx.policy, teamId: ctx.teamId, cwd: ctx.cwd };
  }

  prepareRun(input: {
    goal: string; teamId: string;
    teamSnapshot: { roster: DelegationRosterEntry[]; policy: DelegationPolicy; entryRoleId: string };
    cwd?: string; conversationId?: string;
  }): string {
    const runId = createDelegationRun({
      goal: input.goal,
      cwd: input.cwd,
      teamId: input.teamId,
      teamSnapshotJson: JSON.stringify(input.teamSnapshot),
      conversationId: input.conversationId
    });
    this.contexts.set(runId, {
      runId, teamId: input.teamId, roster: input.teamSnapshot.roster,
      policy: input.teamSnapshot.policy, entryRoleId: input.teamSnapshot.entryRoleId,
      cwd: input.cwd, conversationId: input.conversationId
    });
    return runId;
  }

  async start(input: {
    goal: string; teamId: string;
    teamSnapshot: DelegationTeam | { roster: DelegationRosterEntry[]; policy: DelegationPolicy; entryRoleId: string };
    cwd?: string; conversationId?: string;
  }): Promise<string> {
    const runId = this.prepareRun({
      goal: input.goal, teamId: input.teamId,
      teamSnapshot: input.teamSnapshot as { roster: DelegationRosterEntry[]; policy: DelegationPolicy; entryRoleId: string },
      cwd: input.cwd, conversationId: input.conversationId
    });
    const ctx = this.contexts.get(runId)!;
    const entry = ctx.roster.find((r) => r.id === ctx.entryRoleId) ?? ctx.roster[0];
    const rootEventId = insertDelegationEvent({
      runId, parentEventId: null, agentId: entry.agentId, agentName: entry.label,
      roleLabel: entry.label, taskText: input.goal, depth: 0, canWrite: entry.canWrite, status: "running"
    });
    const resolved = this.deps.resolveAgent(entry.agentId);
    if (!resolved) {
      updateDelegationEvent(rootEventId, { status: "failed", resultSummary: `agent not found: ${entry.agentId}` });
      setDelegationRunStatus(runId, "failed");
      return runId;
    }
    const prompt = buildDelegateTaskPrompt(input.goal, ctx.roster, entry.id, 0, ctx.policy.maxDepth);
    try {
      const result = await this.deps.runAgent({
        sessionId: `del-${runId}`,
        conversationId: ctx.conversationId,
        agentId: entry.agentId,
        agentName: resolved.agentName,
        adapter: resolved.adapter as any,
        binary: resolved.binary,
        extraArgs: resolved.extraArgs,
        env: resolved.env,
        prompt,
        cwd: ctx.cwd,
        approvalMode: "auto",
        skills: resolveSkillSnapshots([...(entry.skillIds ?? []), DELEGATION_SKILL_ID]),
        announceSkills: true,
        delegation: { runId, parentEventId: rootEventId, depth: 0, selfAgentId: entry.id, selfLabel: entry.label }
      } as any);
      const status = result.error ? "failed" : "done";
      updateDelegationEvent(rootEventId, { status, resultSummary: result.summary });
      setDelegationRunStatus(runId, status === "done" ? "completed" : "failed");
    } catch (err) {
      updateDelegationEvent(rootEventId, { status: "failed", resultSummary: (err as Error).message });
      setDelegationRunStatus(runId, "failed");
    }
    return runId;
  }

  private async executor(args: DelegateExecArgs): Promise<DelegateExecResult> {
    const ctx = this.contexts.get(args.runId);
    const resolved = ctx ? this.deps.resolveAgent(args.teammate.agentId) : undefined;
    if (!resolved || !ctx) {
      return { summary: "", exitCode: null, error: `agent not resolved: ${args.teammate.agentId}` };
    }
    const prompt = buildDelegateTaskPrompt(args.task, ctx.roster, args.teammate.id, args.depth, ctx.policy.maxDepth);
    try {
      const result = await this.deps.runAgent({
        sessionId: `del-${args.runId}-${args.childEventId}`,
        conversationId: ctx.conversationId,
        agentId: args.teammate.agentId,
        agentName: resolved.agentName,
        adapter: resolved.adapter as any,
        binary: resolved.binary,
        extraArgs: resolved.extraArgs,
        env: resolved.env,
        prompt,
        cwd: ctx.cwd,
        approvalMode: "auto",
        skills: resolveSkillSnapshots([...(args.teammate.skillIds ?? []), DELEGATION_SKILL_ID]),
        announceSkills: true,
        delegation: { runId: args.runId, parentEventId: args.childEventId, depth: args.depth, selfAgentId: args.teammate.id, selfLabel: args.teammate.label }
      } as any);
      return result;
    } catch (err) {
      return { summary: "", exitCode: null, error: (err as Error).message };
    }
  }

  requestWriteApproval(runId: string, teammate: DelegationRosterEntry): Promise<boolean> {
    const approvalId = randomUUID();
    setDelegationRunStatus(runId, "blocked");
    safeSendToWebContents(this.deps.webContents, `delegation://approval/${runId}`, { runId, approvalId, teammate });
    return new Promise<boolean>((resolve) => {
      this.pendingApprovals.push({ approvalId, runId, teammate, resolve });
    });
  }

  listPendingApprovals(): Array<{ approvalId: string; runId: string }> {
    return this.pendingApprovals.map((p) => ({ approvalId: p.approvalId, runId: p.runId }));
  }

  resolveWriteApproval(approvalId: string, approved: boolean): void {
    const idx = this.pendingApprovals.findIndex((p) => p.approvalId === approvalId);
    if (idx < 0) return;
    const [pending] = this.pendingApprovals.splice(idx, 1);
    if (approved) {
      const ctx = this.contexts.get(pending.runId);
      if (ctx) setDelegationRunStatus(pending.runId, "running");
    }
    pending.resolve(approved);
  }
}

export function recoverInterruptedDelegationRuns(): number {
  const now = new Date().toISOString();
  const rows = getDb()
    .prepare("SELECT id FROM workflow_runs WHERE kind = 'delegation' AND status = 'running'")
    .all() as Array<{ id: string }>;
  getDb()
    .prepare("UPDATE workflow_runs SET status = 'failed', summary = COALESCE(summary, 'Interrupted by app restart.'), updated_at = ? WHERE id = ? AND status = 'running'")
    .run(now, ...rows.map((r) => r.id));
  return rows.length;
}
```

> `recoverInterruptedDelegationRuns` uses a parameterized batch update; if `better-sqlite3`'s `.run(...ids)` variadic doesn't bind a multi-value `WHERE id IN`-style update, iterate `for (const r of rows) update.run(now, r.id)` instead — match the safe pattern used in `recoverInterruptedWorkflowRuns` (workflows.ts:210) which iterates. Prefer the iterating form to avoid binding pitfalls.

- [ ] **Step 4: Run, confirm PASS (3 tests)**

- [ ] **Step 5: Add to `test:handoff-db`; Commit**
```bash
git add electron/cli/delegationRuntime.ts tests/delegation-runtime.test.mjs package.json
git commit -m "feat(delegation): add DelegationRuntime (gate, context, run start, recovery)"
```

---

## Task 5: MCP injection into acpRuntime + CliRunArgs field

**Files:** Modify `electron/cli/runtimeShared.ts`, `electron/cli/acpRuntime.ts`

- [ ] **Step 1: Add the delegation context type + field to `electron/cli/runtimeShared.ts`**

Append after `DelegationCliContext` (define it next to `CliRunArgs`):

```ts
export interface DelegationCliContext {
  runId: string;
  parentEventId: string;
  depth: number;
  selfAgentId: string;
  selfLabel: string;
}
```

Add a field to `CliRunArgs` (after `contextReferences?: ...`):

```ts
  /** When set, attach the freebuddy-delegate MCP so this agent can delegate in a delegation run. */
  delegation?: DelegationCliContext;
```

- [ ] **Step 2: Inject the MCP in `electron/cli/acpRuntime.ts`**

Add imports at the top:

```ts
import { registerDelegateToolSession, unregisterDelegateToolSession } from "../delegationToolService.js";
```

In the `mcpServers` construction (right after the butler block, ~line 1226, before `establishSession()`), add:

```ts
  if (args.delegation && !remoteIsolated) {
    mcpServers.push(
      await registerDelegateToolSession({
        taskSessionId: args.sessionId,
        runId: args.delegation.runId,
        parentEventId: args.delegation.parentEventId,
        depth: args.delegation.depth,
        selfAgentId: args.delegation.selfAgentId,
        selfLabel: args.delegation.selfLabel,
        webContents
      })
    );
  }
```

In `finish()` (next to the other unregister calls, ~lines 368-373), add:

```ts
  unregisterDelegateToolSession(args.sessionId);
```

- [ ] **Step 3: Typecheck + build**
`npm run typecheck && npm run build:electron` → clean.

- [ ] **Step 4: Commit**
```bash
git add electron/cli/runtimeShared.ts electron/cli/acpRuntime.ts
git commit -m "feat(delegation): inject freebuddy-delegate MCP into ACP sessions with delegation context"
```

---

## Task 6: IPC entry points + startup wiring + preload bridge

**Files:** Create `electron/cli/delegationIpc.ts`; modify `electron/main.ts`; modify `electron/preload.ts`; (light) `src/services/workflows/client.ts` re-export.

- [ ] **Step 1: Create `electron/cli/delegationIpc.ts`**

```ts
import type { IpcMainInvokeEvent, BrowserWindow } from "electron";
import { registerHandler } from "../invokeRegistry.js";
import { recoverInterruptedDelegationRuns } from "./delegationRuntime.js";
import { DelegationRuntime } from "./delegationRuntime.js";
import { createDelegateAgentRunner } from "./delegationRunner.js";
import { listCliMembers } from "./members.js";
import { getDelegationTeam } from "./delegationTeams.js";

let runtime: DelegationRuntime | null = null;

export function ensureDelegationRuntime(event: IpcMainInvokeEvent): DelegationRuntime {
  if (runtime) return runtime;
  const win = BrowserWindow.fromWebContents(event.sender);
  runtime = new DelegationRuntime({
    webContents: win?.webContents,
    resolveAgent(agentId) {
      const member = listCliMembers().find((m) => m.id === agentId);
      if (!member) return undefined;
      return {
        adapter: member.cli.adapter, agentName: member.name,
        binary: member.cli.binary, extraArgs: member.cli.extraArgs,
        env: member.cli.env, skillIds: member.cli.skillIds
      };
    },
    runAgent: createDelegateAgentRunner(win?.webContents)
  });
  return runtime;
}

export function registerDelegationIpc(): void {
  recoverInterruptedDelegationRuns();

  registerHandler(
    "workflow:createDelegationRun",
    async (event, input: { teamId: string; goal: string; cwd?: string; conversationId?: string }) => {
      const team = getDelegationTeam(input.teamId);
      if (!team) return { ok: false as const, error: "team not found" };
      const rt = ensureDelegationRuntime(event);
      const runId = await rt.start({
        goal: input.goal, teamId: input.teamId, teamSnapshot: team,
        cwd: input.cwd, conversationId: input.conversationId
      });
      return { ok: true as const, runId };
    }
  );

  registerHandler(
    "workflow:approveDelegateWrite",
    (event, input: { runId: string; approvalId: string; approved: boolean }) => {
      ensureDelegationRuntime(event).resolveWriteApproval(input.approvalId, input.approved);
      return true;
    }
  );
}
```

- [ ] **Step 2: Wire into `electron/main.ts`**

Add import next to `registerWorkflowIpc`:
```ts
import { registerDelegationIpc } from "./cli/delegationIpc.js";
```
Call it right after `registerWorkflowIpc()`:
```ts
  registerWorkflowIpc();
  registerDelegationIpc();
```

- [ ] **Step 3: Expose the bridge in `electron/preload.ts`**

Find the existing `createTeamRun`/`previewTeamRun` exposure (around lines 471-474) and add, in the same style:
```ts
    createDelegationRun: (input) => ipcRenderer.invoke("workflow:createDelegationRun", input),
    approveDelegateWrite: (input) => ipcRenderer.invoke("workflow:approveDelegateWrite", input),
```
(Match the exact bridge object/namespace the preload uses for workflow channels; place these adjacent to the workflow team channels.)

- [ ] **Step 4: Typecheck + build**
`npm run typecheck && npm run build:electron` → clean.

- [ ] **Step 5: Commit**
```bash
git add electron/cli/delegationIpc.ts electron/main.ts electron/preload.ts
git commit -m "feat(delegation): add delegation run IPC handlers and preload bridge"
```

---

## Task 7: Full regression + (optional) headless smoke

- [ ] **Step 1:** `npm run typecheck && npm run build:electron` → clean.
- [ ] **Step 2:** `npm run test:handoff-db` → all pass. Report counts.
- [ ] **Step 3 (deferred smoke, optional):** A live end-to-end smoke (real entry agent issuing `delegate`) requires a running app window + real CLI agents and belongs in Plan 3's UI verification. Skip here unless time permits.
- [ ] **Step 4:** Commit any fixups.

---

## Self-Review (run after all tasks)

- **Spec coverage:** §运行时状态机 — synchronous delegate (entry blocked, child spawned via runAgent) ✓; per-run mutex + depth/timeout/write guards from Plan 2a ✓; restart recovery ✓ (Task 4 + Task 6); watchdog suppression ✓ (Plan 2a Task 1, exercised when delegation MCP is attached). §委派协议 — roster/task prompt injection ✓ (Task 2); delegation skill auto-attached ✓ (Tasks 1, 4). §治理与安全 — write-approval gate (spawner-level, UI event + IPC) ✓ (Task 4 + Task 6); allowWrites guard ✓ (Plan 2a).
- **Recursion correctness:** both entry (Task 4 `start`) and child (Task 4 `executor`) spawn with a `delegation` context whose `depth` = their event depth, so a child's own `delegate()` calls create depth+1 events and recurse, bounded by `maxDepth` (enforced in Plan 2a dispatch).
- **Placeholder scan:** none. Surgical edits into `runtimeShared.ts`/`acpRuntime.ts`/`main.ts`/`preload.ts` are given verbatim. Where an exact line could shift (e.g. butler block ~1226, finish ~368), the implementer is told to locate by reference and place adjacent.
- **Testability:** runtime accepts injectable `runAgent`; pure helpers (`buildDelegationRosterPrompt`, `summarizeDelegateOutput`) tested directly. MCP injection + IPC glue verified by build + review; live smoke deferred to Plan 3.
- **Deferred to Plan 3 (UI):** Settings editor for delegation teams, ChatView team picker + preview card, delegation-tree Run view, approval buttons, renderer store/bridge wiring, the `list_teammates`/`delegate`-issued chat cards, i18n. Plus the kind-scope guard on `getWorkflowTeam` (noted in Plan 1's final review).
