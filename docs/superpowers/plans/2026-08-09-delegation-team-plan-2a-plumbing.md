# Delegation Team · Plan 2a: Delegation Plumbing (MCP bus + spawner + guards)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the synchronous delegation "bus": a `freebuddy-delegate` MCP server (clone of butler), an HTTP bridge + tool service, and a testable dispatch core that resolves teammates, enforces depth/timeout/concurrency/write guards, inserts delegation events, and drives an **injectable executor** (so it is fully testable without real CLI). Also add an inactivity-watchdog suppression API (the agent stays silent while blocked in `delegate()`).

**Architecture:** Clone the butler MCP pattern (`electron/butlerToolService.ts` + `electron/mcp/butlerMcpServer.ts`): the MCP server is a stdio child that HTTP-POSTs `{action,params}` to a main-process bridge; the bridge dispatches to logic that spawns/awaits the delegate and returns the result. The dispatch logic lives in a dependency-light `electron/cli/delegationDispatch.ts` so it can be unit-tested with a fake executor + fake run-context provider. The synchronous blocking works because the ACP `session/prompt` response is only sent when the MCP tool handler returns (confirmed in research). Two butler gotchas are fixed: drop the 20s client fetch timeout; add watchdog suppression for the silent parent session.

**Tech Stack:** TypeScript, @modelcontextprotocol/sdk, zod, better-sqlite3, node:test, Electron main.

**Spec:** `docs/superpowers/specs/2026-08-09-delegation-team-design.zh-CN.md` (§委派协议, §运行时状态机)
**Depends on:** Plan 1 (`delegationRuns.ts`, `delegationTeamTypes.ts` — done).
**Worktree:** `.worktrees/delegation-team` on `feature/delegation-team`. Run commands from there.

---

## File Structure

- **Create** `electron/cli/inactivitySuppression.ts` — tiny module: a `Set<sessionId>` + `addInactivitySuppression`/`removeInactivitySuppression`/`isInactivitySuppressed`/`clearInactivitySuppression`. No electron deps → unit-testable.
- **Create** `electron/cli/delegationDispatch.ts` — the testable core: types (`DelegateToolBinding`, `DelegateRunContext`, `DelegateExecutor`, `DelegateExecArgs/Result`, `DelegateWriteApprovalHook`), `runDelegateAction(binding, action, params, deps)` (pure), module-level singletons + setters (`setDelegateRunContextProvider`, `setDelegateExecutor`, `setDelegateWriteApprovalHook`), `dispatchDelegateAction(binding, action, params)` (uses singletons, called by the HTTP glue), per-run concurrency mutex, timeout wrapper, bounded-summary helper.
- **Create** `electron/mcp/delegateMcpServer.ts` — MCP child (clone of `butlerMcpServer.ts`): `list_teammates` + `delegate` tools; **long** client timeout via `FREEBUDDY_DELEGATE_TIMEOUT_MS` (default 30 min) instead of butler's 20 s.
- **Create** `electron/delegationToolService.ts` — HTTP bridge glue (clone of `butlerToolService.ts`): `registerDelegateToolSession`/`unregisterDelegateToolSession`, `handleDelegateToolHttpRequest`, `DELEGATE_TOOL_PATH`.
- **Modify** `electron/cli/acpRuntime.ts` — import `isInactivitySuppressed` and skip arming the inactivity timer when the current session is suppressed.
- **Modify** `electron/previewServer.ts` — register `handleDelegateToolHttpRequest` next to `handleButlerToolHttpRequest`.
- **Create** `tests/inactivity-suppression.test.mjs` — unit test the Set API.
- **Create** `tests/delegation-dispatch.test.mjs` — unit test `runDelegateAction` with fake executor + fake context provider (in-memory db).

> **Not in 2a (deferred to 2b):** the real `DelegateExecutor` (calls `cliRun`), the `DelegateRunContextProvider` wiring (owned by DelegationRuntime), the write-approval UI hook, MCP injection into `acpRuntime` for delegation sessions, the delegation skill, roster prompt injection, run lifecycle. 2a's dispatch is exercised with fakes; 2b wires production deps.

---

## Conventions

- Tests import compiled JS from `../dist-electron/...`. Always `npm run build:electron` before running.
- DB tests: `import "./fixtures/electron-stub.mjs"` first; in-memory sqlite; `migrate(db)`; `setDbForTest(db)`.
- Run a single test file: `npm run build:electron && node scripts/run-electron-node-test.mjs tests/<file>.mjs`
- Add each new db test file to `test:handoff-db` in `package.json` (only for files needing the electron-node harness / better-sqlite3).
- Style: 2-space indent, semicolons, match neighboring files.

---

## Task 1: Inactivity-watchdog suppression module

**Files:**
- Create: `electron/cli/inactivitySuppression.ts`
- Test: `tests/inactivity-suppression.test.mjs`

- [ ] **Step 1: Create the failing test `tests/inactivity-suppression.test.mjs`**

```js
import "./fixtures/electron-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";

test("inactivity suppression set add/remove/is/clear", async () => {
  const { addInactivitySuppression, removeInactivitySuppression, isInactivitySuppressed, clearInactivitySuppression } =
    await import("../dist-electron/cli/inactivitySuppression.js");
  clearInactivitySuppression();
  assert.equal(isInactivitySuppressed("s1"), false);
  addInactivitySuppression("s1");
  assert.equal(isInactivitySuppressed("s1"), true);
  assert.equal(isInactivitySuppressed("s2"), false);
  removeInactivitySuppression("s1");
  assert.equal(isInactivitySuppressed("s1"), false);
  addInactivitySuppression("s1");
  addInactivitySuppression("s2");
  clearInactivitySuppression();
  assert.equal(isInactivitySuppressed("s1"), false);
  assert.equal(isInactivitySuppressed("s2"), false);
});

test("inactivity suppression is idempotent", async () => {
  const { addInactivitySuppression, removeInactivitySuppression, isInactivitySuppressed, clearInactivitySuppression } =
    await import("../dist-electron/cli/inactivitySuppression.js");
  clearInactivitySuppression();
  addInactivitySuppression("s1");
  addInactivitySuppression("s1");
  assert.equal(isInactivitySuppressed("s1"), true);
  removeInactivitySuppression("s1");
  assert.equal(isInactivitySuppressed("s1"), false);
  removeInactivitySuppression("s1"); // removing absent does not throw
  clearInactivitySuppression();
});
```

- [ ] **Step 2: Run, confirm FAIL**
`npm run build:electron && node scripts/run-electron-node-test.mjs tests/inactivity-suppression.test.mjs` (module not found)

- [ ] **Step 3: Create `electron/cli/inactivitySuppression.ts`**

```ts
const suppressed = new Set<string>();

export function addInactivitySuppression(sessionId: string): void {
  suppressed.add(sessionId);
}

export function removeInactivitySuppression(sessionId: string): void {
  suppressed.delete(sessionId);
}

export function isInactivitySuppressed(sessionId: string): boolean {
  return suppressed.has(sessionId);
}

export function clearInactivitySuppression(): void {
  suppressed.clear();
}
```

- [ ] **Step 4: Run, confirm PASS (2 tests)**

- [ ] **Step 5: Wire the guard into `electron/cli/acpRuntime.ts` (TWO places)**

Add an import at the top next to other `./` imports:

```ts
import { isInactivitySuppressed } from "./inactivitySuppression.js";
```

`armInactivityTimer` (line ~342) and `onInactivityExpired` (line ~310) are closures inside `runAcpAgent`, so `args.sessionId` is in scope in both. Add a guard to **both**:

(a) In `armInactivityTimer` — at the very top of its body, before it schedules/resets any timer, short-circuit so a suppressed session never (re)arms:

```ts
  if (args.sessionId && isInactivitySuppressed(args.sessionId)) {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    return;
  }
```

(b) In `onInactivityExpired` — at the very top, so an already-scheduled timer that fires *during* suppression does not kill the run (the timer was armed at prompt start, before suppression was added; this second guard is essential):

```ts
  if (args.sessionId && isInactivitySuppressed(args.sessionId)) {
    inactivityFired = false;
    return;
  }
```

> `args` is the `runAcpAgent` parameter and is captured by both closures — confirmed in scope. If the parameter name in this file differs, use the actual name. Intent: while a delegating agent is blocked inside `delegate()` (suppressed), the 10-min watchdog must neither arm nor fire-and-kill.

- [ ] **Step 6: Confirm build still clean**
`npm run build:electron` → clean. (No new test for the acpRuntime guard — it needs a real ACP session to exercise; the guard is small and reviewable. The exported Set API is tested in Step 1.)

- [ ] **Step 7: Add `tests/inactivity-suppression.test.mjs` to `test:handoff-db` in `package.json`** (append after `tests/delegation-teams-db.test.mjs`).

- [ ] **Step 8: Commit**
```bash
git add electron/cli/inactivitySuppression.ts electron/cli/acpRuntime.ts tests/inactivity-suppression.test.mjs package.json
git commit -m "feat(delegation): add inactivity-watchdog suppression API and guard armInactivityTimer"
```

---

## Task 2: Delegation dispatch core (testable, fake-executor driven)

**Files:**
- Create: `electron/cli/delegationDispatch.ts`
- Test: `tests/delegation-dispatch.test.mjs`

This is the heart of 2a. Implement `runDelegateAction(binding, action, params, deps)` with injected `contextProvider`, `executor`, `writeApproval`; plus module singletons + `dispatchDelegateAction` that the HTTP glue will call.

- [ ] **Step 1: Create the failing test `tests/delegation-dispatch.test.mjs`**

```js
import "./fixtures/electron-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";

let Database;
let bindingAvailable = true;
try {
  Database = (await import("better-sqlite3")).default;
  new Database(":memory:").close();
} catch { bindingAvailable = false; }

async function withDb(fn) {
  const db = new Database(":memory:");
  const { migrate, setDbForTest } = await import("../dist-electron/cli/db.js");
  migrate(db);
  setDbForTest(db);
  try { await fn(); } finally { setDbForTest(null); db.close(); }
}

const roster = [
  { id: "r-impl", label: "实现", agentId: "cli-codex-acp", capability: "写代码", canWrite: true },
  { id: "r-rev", label: "评审", agentId: "cli-claude-agent-acp", capability: "审代码", canWrite: false }
];
const policy = {
  allowWrites: true, requireApprovalBeforeDelegateWrite: false,
  maxDepth: 3, delegateTimeoutMs: 600000, maxConcurrentDelegates: 1, stopOnDelegateFailure: false
};
const ctx = { roster, policy, teamId: "team-1", cwd: "/repo" };
const contextProvider = (_runId) => ctx;
const binding = { token: "t", taskSessionId: "sess-entry", runId: "run-1", parentEventId: "evt-root", depth: 0, selfAgentId: "r-impl", selfLabel: "实现" };

test("list_teammates returns roster minus self", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun, runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    const { createDelegationRun: cr } = await import("../dist-electron/cli/delegationRuns.js");
    cr({ goal: "g", teamId: "team-1", teamSnapshotJson: "{}" });
    const res = await runDelegateAction(binding, "list_teammates", {}, {
      contextProvider, executor: async () => { throw new Error("should not be called"); }, writeApproval: async () => true
    });
    const ids = res.teammates.map((x) => x.id);
    assert.deepEqual(ids, ["r-rev"]);
    assert.equal(res.teammates[0].capability, "审代码");
  });
});

test("delegate happy path: inserts child event, calls executor, returns done summary, marks event done", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun, listDelegationEvents } = await import("../dist-electron/cli/delegationRuns.js");
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    createDelegationRun({ goal: "g", teamId: "team-1", teamSnapshotJson: "{}" });
    let called = null;
    const res = await runDelegateAction(binding, "delegate", { teammate_id: "r-rev", task: "审 auth" }, {
      contextProvider,
      executor: async (args) => { called = args; return { summary: "LGTM", exitCode: 0, error: null }; },
      writeApproval: async () => true
    });
    assert.equal(res.status, "done");
    assert.equal(res.result, "LGTM");
    assert.ok(res.event_id);
    assert.equal(called.teammate.id, "r-rev");
    assert.equal(called.task, "审 auth");
    assert.equal(called.depth, 1);
    assert.equal(called.parentEventId, "evt-root");
    const ev = listDelegationEvents("run-1").find((e) => e.id === res.event_id);
    assert.equal(ev.status, "done");
    assert.equal(ev.depth, 1);
    assert.equal(ev.parentEventId, "evt-root");
  });
});

test("delegate at maxDepth returns failed without calling executor", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun } = await import("../dist-electron/cli/delegationRuns.js");
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    createDelegationRun({ goal: "g", teamId: "team-1", teamSnapshotJson: "{}" });
    const atMax = { ...binding, depth: 3 };
    let execCalled = false;
    const res = await runDelegateAction(atMax, "delegate", { teammate_id: "r-rev", task: "x" }, {
      contextProvider, executor: async () => { execCalled = true; return { summary: "", exitCode: 0, error: null }; }, writeApproval: async () => true
    });
    assert.equal(res.status, "failed");
    assert.match(res.result, /最大委派深度/);
    assert.equal(execCalled, false);
  });
});

test("delegate timeout: executor hanging -> timeout status, event timeout", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun, listDelegationEvents } = await import("../dist-electron/cli/delegationRuns.js");
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    createDelegationRun({ goal: "g", teamId: "team-1", teamSnapshotJson: "{}" });
    const shortCtx = { roster, policy: { ...policy, delegateTimeoutMs: 30 }, teamId: "team-1", cwd: "/repo" };
    const res = await runDelegateAction(binding, "delegate", { teammate_id: "r-rev", task: "x" }, {
      contextProvider: () => shortCtx,
      executor: () => new Promise(() => {}), // never resolves
      writeApproval: async () => true
    });
    assert.equal(res.status, "timeout");
    const ev = listDelegationEvents("run-1").find((e) => e.id === res.event_id);
    assert.equal(ev.status, "timeout");
  });
});

test("delegate executor failure -> failed status", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun } = await import("../dist-electron/cli/delegationRuns.js");
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    createDelegationRun({ goal: "g", teamId: "team-1", teamSnapshotJson: "{}" });
    const res = await runDelegateAction(binding, "delegate", { teammate_id: "r-rev", task: "x" }, {
      contextProvider,
      executor: async () => ({ summary: "", exitCode: 1, error: "boom" }),
      writeApproval: async () => true
    });
    assert.equal(res.status, "failed");
  });
});

test("allowWrites=false blocks writable teammate", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun } = await import("../dist-electron/cli/delegationRuns.js");
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    createDelegationRun({ goal: "g", teamId: "team-1", teamSnapshotJson: "{}" });
    const noWrite = { roster, policy: { ...policy, allowWrites: false }, teamId: "team-1", cwd: "/repo" };
    let execCalled = false;
    const res = await runDelegateAction(binding, "delegate", { teammate_id: "r-impl", task: "x" }, {
      contextProvider: () => noWrite,
      executor: async () => { execCalled = true; return { summary: "", exitCode: 0, error: null }; },
      writeApproval: async () => true
    });
    assert.equal(res.status, "failed");
    assert.match(res.result, /allowWrites/);
    assert.equal(execCalled, false);
  });
});

test("requireApprovalBeforeDelegateWrite: rejected -> failed, not executed", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun } = await import("../dist-electron/cli/delegationRuns.js");
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    createDelegationRun({ goal: "g", teamId: "team-1", teamSnapshotJson: "{}" });
    const apprCtx = { roster, policy: { ...policy, requireApprovalBeforeDelegateWrite: true }, teamId: "team-1", cwd: "/repo" };
    let execCalled = false;
    const res = await runDelegateAction(binding, "delegate", { teammate_id: "r-impl", task: "x" }, {
      contextProvider: () => apprCtx,
      executor: async () => { execCalled = true; return { summary: "", exitCode: 0, error: null }; },
      writeApproval: async () => false
    });
    assert.equal(res.status, "failed");
    assert.match(res.result, /拒绝/);
    assert.equal(execCalled, false);
  });
});

test("concurrency=1: two delegates from same run are serialized", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun } = await import("../dist-electron/cli/delegationRuns.js");
    const { runDelegateAction } = await import("../dist-electron/cli/delegationDispatch.js");
    createDelegationRun({ goal: "g", teamId: "team-1", teamSnapshotJson: "{}" });
    const order = [];
    const makeExec = (tag) => async () => {
      order.push(`start ${tag}`);
      await new Promise((r) => setTimeout(r, 20));
      order.push(`end ${tag}`);
      return { summary: tag, exitCode: 0, error: null };
    };
    const deps = (tag) => ({ contextProvider, executor: makeExec(tag), writeApproval: async () => true });
    await Promise.all([
      runDelegateAction(binding, "delegate", { teammate_id: "r-rev", task: "a" }, deps("a")),
      runDelegateAction(binding, "delegate", { teammate_id: "r-rev", task: "b" }, deps("b"))
    ]);
    // serialized: one full start/end pair before the other starts
    assert.ok(order[0].startsWith("start") && order[1].startsWith("end") && order[2].startsWith("start"),
      `delegates not serialized: ${order.join(",")}`);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL (delegationDispatch.js missing)**
`npm run build:electron && node scripts/run-electron-node-test.mjs tests/delegation-dispatch.test.mjs`

- [ ] **Step 3: Create `electron/cli/delegationDispatch.ts`**

```ts
import type { DelegationRosterEntry, DelegationPolicy } from "./delegationTeamTypes.js";
import {
  insertDelegationEvent,
  updateDelegationEvent
} from "./delegationRuns.js";
import { addInactivitySuppression, removeInactivitySuppression } from "./inactivitySuppression.js";

const MAX_RESULT_CHARS = 12_000;

export interface DelegateToolBinding {
  token: string;
  taskSessionId: string;
  runId: string;
  parentEventId: string;
  depth: number;
  selfAgentId: string;
  selfLabel: string;
}

export interface DelegateRunContext {
  roster: DelegationRosterEntry[];
  policy: DelegationPolicy;
  teamId: string;
  cwd?: string;
}

export type DelegateRunContextProvider = (runId: string) => DelegateRunContext | undefined;

export interface DelegateExecArgs {
  teammate: DelegationRosterEntry;
  task: string;
  runId: string;
  teamId: string;
  cwd?: string;
  childEventId: string;
  parentEventId: string;
  depth: number;
}

export interface DelegateExecResult {
  summary: string;
  exitCode: number | null;
  error: string | null;
}

export type DelegateExecutor = (args: DelegateExecArgs) => Promise<DelegateExecResult>;
export type DelegateWriteApprovalHook = (
  binding: DelegateToolBinding,
  teammate: DelegationRosterEntry
) => Promise<boolean>;

export interface DelegateActionDeps {
  contextProvider: DelegateRunContextProvider;
  executor: DelegateExecutor;
  writeApproval: DelegateWriteApprovalHook;
}

export interface DelegateToolResponse {
  ok?: boolean;
  error?: string;
  status?: "done" | "failed" | "timeout";
  result?: string;
  teammates?: Array<{ id: string; label: string; capability: string; canWrite: boolean }>;
  event_id?: string | null;
}

class DelegateTimeout extends Error {
  constructor() { super("delegate exceeded timeout"); this.name = "DelegateTimeout"; }
}

function boundSummary(text: string): string {
  if (text.length <= MAX_RESULT_CHARS) return text;
  const head = text.slice(0, MAX_RESULT_CHARS / 2);
  const tail = text.slice(text.length - MAX_RESULT_CHARS / 2);
  return `${head}\n…[truncated]…\n${tail}`;
}

const mutexByRun = new Map<string, Promise<unknown>>();
async function withRunMutex<T>(runId: string, fn: () => Promise<T>): Promise<T> {
  const prev = mutexByRun.get(runId) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => (release = r));
  mutexByRun.set(runId, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (mutexByRun.get(runId) === prev.then(() => next)) {
      // best-effort cleanup; leave map entry if another chain already replaced it
    }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new DelegateTimeout()), ms);
    })
  ]);
}

export async function runDelegateAction(
  binding: DelegateToolBinding,
  action: string,
  params: Record<string, unknown>,
  deps: DelegateActionDeps
): Promise<DelegateToolResponse> {
  if (action === "list_teammates") {
    const ctx = deps.contextProvider(binding.runId);
    if (!ctx) return { ok: false, error: "run context not found" };
    const teammates = ctx.roster
      .filter((r) => r.id !== binding.selfAgentId)
      .map((r) => ({ id: r.id, label: r.label, capability: r.capability, canWrite: r.canWrite }));
    return { ok: true, teammates };
  }

  if (action === "delegate") {
    const ctx = deps.contextProvider(binding.runId);
    if (!ctx) return { ok: false, error: "run context not found", status: "failed" };
    const teammateId = String(params.teammate_id ?? "");
    const task = String(params.task ?? "");
    const teammate = ctx.roster.find((r) => r.id === teammateId);
    if (!teammate) {
      return { ok: true, status: "failed", result: `teammate not found: ${teammateId}` };
    }
    if (teammate.id === binding.selfAgentId) {
      return { ok: true, status: "failed", result: "cannot delegate to self" };
    }
    const childDepth = binding.depth + 1;
    if (childDepth > ctx.policy.maxDepth) {
      return {
        ok: true,
        status: "failed",
        result: `已达最大委派深度(${ctx.policy.maxDepth})，请自行处理或简化该子任务`
      };
    }
    if (!ctx.policy.allowWrites && teammate.canWrite) {
      return { ok: true, status: "failed", result: "策略禁止写操作（allowWrites=false）" };
    }
    if (teammate.canWrite && ctx.policy.requireApprovalBeforeDelegateWrite) {
      const approved = await deps.writeApproval(binding, teammate);
      if (!approved) {
        return { ok: true, status: "failed", result: "写委派被用户拒绝" };
      }
    }

    const childEventId = insertDelegationEvent({
      runId: binding.runId,
      parentEventId: binding.parentEventId,
      agentId: teammate.agentId,
      agentName: teammate.label,
      roleLabel: teammate.label,
      taskText: task,
      depth: childDepth,
      canWrite: teammate.canWrite,
      status: "running"
    });

    addInactivitySuppression(binding.taskSessionId);
    try {
      return await withRunMutex(binding.runId, async () => {
        try {
          const result = await withTimeout(
            deps.executor({
              teammate,
              task,
              runId: binding.runId,
              teamId: ctx.teamId,
              cwd: ctx.cwd,
              childEventId,
              parentEventId: binding.parentEventId,
              depth: childDepth
            }),
            ctx.policy.delegateTimeoutMs
          );
          const status: "done" | "failed" = result.error ? "failed" : "done";
          updateDelegationEvent(childEventId, {
            status,
            resultSummary: result.error ?? boundSummary(result.summary)
          });
          return {
            ok: status === "done",
            status,
            result: boundSummary(result.error ? result.summary || result.error : result.summary),
            event_id: childEventId
          };
        } catch (err) {
          if (err instanceof DelegateTimeout) {
            updateDelegationEvent(childEventId, { status: "timeout", resultSummary: "委派超时" });
            return { ok: false, status: "timeout", result: "delegate exceeded timeout", event_id: childEventId };
          }
          const msg = (err as Error)?.message ?? String(err);
          updateDelegationEvent(childEventId, { status: "failed", resultSummary: msg });
          return { ok: false, status: "failed", result: msg, event_id: childEventId };
        }
      });
    } finally {
      removeInactivitySuppression(binding.taskSessionId);
    }
  }

  return { ok: false, error: `unknown action: ${action}` };
}

let singletonDeps: DelegateActionDeps | null = null;

export function setDelegateDeps(deps: DelegateActionDeps | null): void {
  singletonDeps = deps;
}

export async function dispatchDelegateAction(
  binding: DelegateToolBinding,
  action: string,
  params: Record<string, unknown>
): Promise<DelegateToolResponse> {
  if (!singletonDeps) return { ok: false, error: "delegate deps not configured" };
  return runDelegateAction(binding, action, params, singletonDeps);
}
```

- [ ] **Step 4: Run, confirm PASS (8 tests)**
`npm run build:electron && node scripts/run-electron-node-test.mjs tests/delegation-dispatch.test.mjs`

- [ ] **Step 5: Add `tests/delegation-dispatch.test.mjs` to `test:handoff-db` in `package.json`.**

- [ ] **Step 6: Commit**
```bash
git add electron/cli/delegationDispatch.ts tests/delegation-dispatch.test.mjs package.json
git commit -m "feat(delegation): add testable delegation dispatch core with guards"
```

---

## Task 3: Delegate MCP server (clone butler, long timeout)

**Files:**
- Create: `electron/mcp/delegateMcpServer.ts`

- [ ] **Step 1: Create `electron/mcp/delegateMcpServer.ts`**

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

interface DelegateToolResponse {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
}

function bridgeEnvironment(): { endpoint: string; token: string } {
  const endpoint = process.env.FREEBUDDY_DELEGATE_ENDPOINT?.trim();
  const token = process.env.FREEBUDDY_DELEGATE_TOKEN?.trim();
  if (!endpoint || !token) {
    throw new Error("FreeBuddy Delegate tool environment is incomplete.");
  }
  return { endpoint, token };
}

function clientTimeoutMs(): number {
  const raw = Number(process.env.FREEBUDDY_DELEGATE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 30 * 60 * 1000;
}

async function invokeDelegateBridge(
  action: string,
  params: Record<string, unknown> = {}
): Promise<DelegateToolResponse> {
  const { endpoint, token } = bridgeEnvironment();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ action, params }),
    signal: AbortSignal.timeout(clientTimeoutMs())
  });
  const result = (await response.json().catch(() => ({
    ok: false,
    error: `Delegate bridge returned HTTP ${response.status}`
  }))) as DelegateToolResponse;
  if (!response.ok) {
    throw new Error(result.error || `Delegate bridge returned HTTP ${response.status}`);
  }
  return result;
}

function toolResult(result: DelegateToolResponse) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    ...(result.ok === false ? { isError: true } : {})
  };
}

function toolError(error: unknown) {
  return toolResult({ ok: false, error: (error as Error)?.message || String(error) });
}

export function createDelegateMcpServer(): McpServer {
  const server = new McpServer({
    name: "freebuddy-delegate",
    version: process.env.FB_APP_VERSION || "0.1.0"
  });

  server.registerTool(
    "list_teammates",
    {
      title: "List Delegation Teammates",
      description:
        "List the teammates available to delegate to in the current delegation run (excluding yourself). Each entry has id, label, capability (what to delegate to it), and canWrite. Read-only.",
      inputSchema: {}
    },
    async () => {
      try {
        return toolResult(await invokeDelegateBridge("list_teammates", {}));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "delegate",
    {
      title: "Delegate a Sub-task to a Teammate",
      description:
        "Synchronously delegate a sub-task to a teammate. This call blocks until the teammate finishes (or times out), then returns {status, result, event_id}. Pick the teammate by matching its capability to the sub-task. Do not delegate trivial work you can do yourself, and do not bounce back to your caller.",
      inputSchema: {
        teammate_id: z.string().describe("The roster entry id from list_teammates."),
        task: z.string().describe("A self-contained description of the sub-task to delegate.")
      }
    },
    async (args) => {
      try {
        return toolResult(await invokeDelegateBridge("delegate", args));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  return server;
}

export async function runDelegateMcpServer(): Promise<void> {
  const server = createDelegateMcpServer();
  await server.connect(new StdioServerTransport());
}

const isMainModule =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  runDelegateMcpServer().catch((error) => {
    console.error("[FreeBuddy Delegate MCP]", error);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 2: Confirm it compiles**
`npm run build:electron` → clean. (The MCP child is exercised end-to-end only in 2b; here we only ensure it builds and mirrors the butler scaffolding. Verify the `server.registerTool` signature matches `electron/mcp/butlerMcpServer.ts` exactly — read that file's first tool registration to confirm the call shape; if the SDK uses a different signature in this codebase, match it.)

- [ ] **Step 3: Commit**
```bash
git add electron/mcp/delegateMcpServer.ts
git commit -m "feat(delegation): add freebuddy-delegate MCP server (list_teammates + delegate)"
```

---

## Task 4: Delegate tool service (HTTP bridge glue) + wire HTTP handler

**Files:**
- Create: `electron/delegationToolService.ts`
- Modify: `electron/previewServer.ts` (register the handler)

- [ ] **Step 1: Read `electron/butlerToolService.ts` lines around `registerButlerToolSession` (280-315), `unregisterButlerToolSession` (313), `handleButlerToolHttpRequest` (1117-1164), and the env/`createCapabilityToken`/`waitForActiveBridgePort` usage, to mirror them exactly. Also read `electron/previewServer.ts` around line 37 to see how `handleButlerToolHttpRequest` is registered.**

- [ ] **Step 2: Create `electron/delegationToolService.ts`**

```ts
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import type { WebContents } from "electron";

import { waitForActiveBridgePort } from "./agentBridge.js";
import type { AcpStdioMcpServer } from "./shared/draftToolProtocol.js";
import { sendJson } from "./httpUtils.js";
import { readJsonBody } from "./httpUtils.js";
import { dispatchDelegateAction, type DelegateToolBinding } from "./cli/delegationDispatch.js";

const DELEGATE_TOOL_PATH = "/freebuddy/delegate-tool";
const MAX_REQUEST_BYTES = 64 * 1024;

interface DelegateToolBindingRecord extends DelegateToolBinding {
  // DelegateToolBinding already carries token/taskSessionId/runId/parentEventId/depth/selfAgentId/selfLabel
}

const bindingsByToken = new Map<string, DelegateToolBindingRecord>();
const tokensByTaskSession = new Map<string, string>();

function createCapabilityToken(): string {
  return randomBytes(32).toString("base64url");
}

function delegateMcpServerPath(): string {
  return fileURLToPath(new URL("./mcp/delegateMcpServer.js", import.meta.url));
}

export async function registerDelegateToolSession(input: {
  taskSessionId: string;
  runId: string;
  parentEventId: string;
  depth: number;
  selfAgentId: string;
  selfLabel: string;
  webContents: WebContents | undefined;
}): Promise<AcpStdioMcpServer> {
  unregisterDelegateToolSession(input.taskSessionId);
  const port = await waitForActiveBridgePort();
  const token = createCapabilityToken();
  const binding: DelegateToolBindingRecord = {
    token,
    taskSessionId: input.taskSessionId,
    runId: input.runId,
    parentEventId: input.parentEventId,
    depth: input.depth,
    selfAgentId: input.selfAgentId,
    selfLabel: input.selfLabel
  };
  bindingsByToken.set(token, binding);
  tokensByTaskSession.set(input.taskSessionId, token);
  return {
    name: "freebuddy-delegate",
    command: process.execPath,
    args: [delegateMcpServerPath()],
    env: [
      { name: "ELECTRON_RUN_AS_NODE", value: "1" },
      { name: "FREEBUDDY_DELEGATE_ENDPOINT", value: `http://127.0.0.1:${port}${DELEGATE_TOOL_PATH}` },
      { name: "FREEBUDDY_DELEGATE_TOKEN", value: token },
      { name: "FREEBUDDY_DELEGATE_TIMEOUT_MS", value: String(30 * 60 * 1000) },
      { name: "FB_APP_VERSION", value: process.env.FB_APP_VERSION || "0.1.0" }
    ]
  };
}

export function unregisterDelegateToolSession(taskSessionId: string): void {
  const token = tokensByTaskSession.get(taskSessionId);
  if (token) {
    bindingsByToken.delete(token);
    tokensByTaskSession.delete(taskSessionId);
  }
}

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export async function handleDelegateToolHttpRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  if (req.method !== "POST") return false;
  let url: URL;
  try {
    url = new URL(req.url ?? "", "http://localhost");
  } catch {
    return false;
  }
  if (url.pathname !== DELEGATE_TOOL_PATH) return false;

  const token = bearerToken(req);
  const binding = token ? bindingsByToken.get(token) : undefined;
  if (!binding) {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return true;
  }

  let body: { action?: string; params?: Record<string, unknown> };
  try {
    body = await readJsonBody(req, MAX_REQUEST_BYTES);
  } catch (error) {
    sendJson(res, 400, { ok: false, error: (error as Error).message });
    return true;
  }
  const action = typeof body.action === "string" ? body.action : "";
  const params = body.params && typeof body.params === "object" ? body.params as Record<string, unknown> : {};

  try {
    const result = await dispatchDelegateAction(binding, action, params);
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: (error as Error).message });
  }
  return true;
}
```

> **Verify against the real helpers:** confirm `sendJson` and `readJsonBody` signatures in `electron/httpUtils.ts` (the grep showed `sendJson` at httpUtils.ts:3 and `readJsonBody` at :16). If `readJsonBody` does not accept a max-bytes second arg, read its signature and adapt (mirror how `butlerToolService.ts` reads the body). Match exactly what butler does.

- [ ] **Step 3: Register the handler in `electron/previewServer.ts`**

Find the line where `handleButlerToolHttpRequest(req, res)` is called (around line 37). Add immediately after it:

```ts
  if (await handleDelegateToolHttpRequest(req, res)) return;
```

Add the import at the top next to the butler import:

```ts
import { handleDelegateToolHttpRequest } from "./delegationToolService.js";
```

- [ ] **Step 4: Confirm typecheck + build**
`npm run typecheck && npm run build:electron` → clean. If `readJsonBody`/`sendJson` signatures differ, fix the usage to match.

- [ ] **Step 5: Commit**
```bash
git add electron/delegationToolService.ts electron/previewServer.ts
git commit -m "feat(delegation): add delegate tool HTTP bridge and register handler"
```

---

## Task 5: Full-suite regression check

- [ ] **Step 1: Run the full db suite**
`npm run build:electron && npm run test:handoff-db`
Expected: all pass (now includes inactivity-suppression + delegation-dispatch + delegation-teams tests). Report counts.

- [ ] **Step 2: Typecheck**
`npm run typecheck` → clean.

- [ ] **Step 3: Commit (only if any fixups were needed; otherwise skip)**
If you made fixups during the regression check, commit them with a clear message. Otherwise no commit.

---

## Self-Review (run after all tasks)

- **Spec coverage:** §委派协议 — `list_teammates` ✓ (Task 2), `delegate` synchronous ✓ (Task 2), depth/timeout/concurrency guards ✓ (Task 2), result bounding ✓, return contract {status,result,event_id} ✓; §运行时状态机 — watchdog suppression ✓ (Task 1). The real executor + run lifecycle + MCP injection + skill + write-approval UI are intentionally deferred to Plan 2b.
- **Butler gotchas fixed:** 20s client timeout → long configurable timeout (Task 3); watchdog kill → suppression API + guard (Task 1).
- **Placeholder scan:** none. Where a helper signature (sendJson/readJsonBody, armInactivityTimer scope) could not be pinned in advance, the plan instructs the implementer to read the reference file and match it exactly.
- **Type consistency:** `DelegateToolBinding` is defined once in `delegationDispatch.ts` and re-used by `delegationToolService.ts`. `DelegateToolResponse` fields (ok/status/result/teammates/event_id) line up across tests and implementation.
- **Test isolation:** `delegationDispatch` tests inject fakes (executor/contextProvider/writeApproval) — no real CLI, no real ACP, no HTTP. The HTTP glue (Task 4) is verified by build + code review + the 2b integration smoke.
