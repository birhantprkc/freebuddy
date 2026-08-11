import type { DelegationRosterEntry, DelegationPolicy } from "./delegationTeamTypes.js";
import { getDelegationEvent, insertDelegationEvent, updateDelegationEvent, countRunningDelegationEvents } from "./delegationRuns.js";

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
  /** Fired after a delegated event reaches a terminal status (done/failed/timeout/cancelled). */
  onSettle?: (eventId: string) => void;
}

export interface DelegateToolResponse {
  ok?: boolean;
  error?: string;
  status?: "pending" | "running" | "done" | "failed" | "timeout" | "cancelled";
  result?: string;
  teammates?: Array<{ id: string; label: string; capability: string; canWrite: boolean }>;
  event_id?: string | null;
  request_id?: string;
}

class DelegateTimeout extends Error {
  constructor() { super("delegate exceeded timeout"); this.name = "DelegateTimeout"; }
}

function boundSummary(text: string): string {
  if (text.length <= MAX_RESULT_CHARS) return text;
  const head = text.slice(0, Math.floor(MAX_RESULT_CHARS / 2));
  const tail = text.slice(text.length - Math.floor(MAX_RESULT_CHARS / 2));
  return `${head}\n…[truncated]…\n${tail}`;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    p.finally(() => { if (timer) clearTimeout(timer); }),
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new DelegateTimeout()), ms); })
  ]);
}

// ---- per-run delegate queue (concurrency control) ----------------------
// A delegate event is inserted as "pending"; drainRun starts it (flips to
// "running" and fires the executor) only when a slot under
// policy.maxConcurrentDelegates is free. Otherwise it stays queued here.
interface QueuedDelegate {
  childEventId: string;
  execArgs: DelegateExecArgs;
  timeoutMs: number;
}
const runQueues = new Map<string, QueuedDelegate[]>();

function drainRun(deps: DelegateActionDeps, runId: string): void {
  const ctx = deps.contextProvider(runId);
  if (!ctx) return;
  const max = ctx.policy.maxConcurrentDelegates;
  const limit = typeof max === "number" && max > 0 ? max : Infinity;
  const queue = runQueues.get(runId);
  while (queue && queue.length > 0 && countRunningDelegationEvents(runId) < limit) {
    const next = queue.shift()!;
    if (queue.length === 0) runQueues.delete(runId);
    startDelegate(deps, runId, next);
  }
}

function startDelegate(deps: DelegateActionDeps, runId: string, q: QueuedDelegate): void {
  updateDelegationEvent(q.childEventId, { status: "running" });
  void withTimeout(deps.executor(q.execArgs), q.timeoutMs)
    .then((result) => {
      const status = result.error ? "failed" : "done";
      updateDelegationEvent(q.childEventId, { status, resultSummary: result.error ?? boundSummary(result.summary) });
      deps.onSettle?.(q.childEventId);
      drainRun(deps, runId);
    })
    .catch((err) => {
      if (err instanceof DelegateTimeout) {
        updateDelegationEvent(q.childEventId, { status: "timeout", resultSummary: "委派超时" });
      } else {
        updateDelegationEvent(q.childEventId, { status: "failed", resultSummary: (err as Error)?.message ?? String(err) });
      }
      deps.onSettle?.(q.childEventId);
      drainRun(deps, runId);
    });
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
    // ok flag semantics: ok === true means the tool call succeeded (including
    // a status:"failed" DECISION the agent must handle synchronously, e.g.
    // teammate-not-found / depth-limit / policy rejection, and status:"pending"
    // when the executor has been dispatched in the background); ok === false
    // means a transport/execution error (e.g. run context missing). The
    // executor's own outcome is reported later via check_delegate_result, not
    // via ok here.
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
      return { ok: true, status: "failed", result: `已达最大委派深度(${ctx.policy.maxDepth})，请自行处理或简化该子任务` };
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

    // Insert as "pending" (queued). drainRun will flip it to "running" and fire
    // the executor as soon as a slot under maxConcurrentDelegates is free. The
    // caller gets an immediate pending receipt and polls check_delegate_result
    // to observe pending (queued) / running / terminal. This sidesteps the MCP
    // transport's 60s call timeout, which would otherwise kill long-running
    // delegates mid-flight; withTimeout still enforces delegateTimeoutMs.
    const childEventId = insertDelegationEvent({
      runId: binding.runId,
      parentEventId: binding.parentEventId,
      agentId: teammate.agentId,
      agentName: teammate.label,
      roleLabel: teammate.label,
      taskText: task,
      depth: childDepth,
      canWrite: teammate.canWrite,
      status: "pending"
    });

    const execArgs: DelegateExecArgs = {
      teammate, task, runId: binding.runId, teamId: ctx.teamId, cwd: ctx.cwd,
      childEventId, parentEventId: binding.parentEventId, depth: childDepth
    };
    const queue = runQueues.get(binding.runId) ?? [];
    queue.push({ childEventId, execArgs, timeoutMs: ctx.policy.delegateTimeoutMs });
    if (queue.length === 1) runQueues.set(binding.runId, queue);
    drainRun(deps, binding.runId);
    return { ok: true, status: "pending", request_id: childEventId, event_id: childEventId };
  }

  if (action === "check_delegate_result") {
    const requestId = String(params.request_id ?? "");
    if (!requestId) return { ok: false, error: "request_id required" };
    const event = getDelegationEvent(requestId);
    if (!event) return { ok: false, error: "request not found" };
    // Report the real event status verbatim: "pending" = queued behind the
    // concurrency limit, "running" = executing, then done/failed/timeout/cancelled.
    return { ok: true, status: event.status, result: event.resultSummary ?? "", request_id: requestId };
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
