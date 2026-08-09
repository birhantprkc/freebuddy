import type { DelegationRosterEntry, DelegationPolicy } from "./delegationTeamTypes.js";
import { insertDelegationEvent, updateDelegationEvent } from "./delegationRuns.js";
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
  /** Aborted when the delegate exceeds its timeout (so the real executor can kill the child). */
  signal?: AbortSignal;
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
  const head = text.slice(0, Math.floor(MAX_RESULT_CHARS / 2));
  const tail = text.slice(text.length - Math.floor(MAX_RESULT_CHARS / 2));
  return `${head}\n…[truncated]…\n${tail}`;
}

// v1: delegates are serialized per run (concurrency = 1) regardless of
// policy.maxConcurrentDelegates; honoring >1 is a future task.
const mutexByRun = new Map<string, Promise<unknown>>();
async function withRunMutex<T>(runId: string, fn: () => Promise<T>): Promise<T> {
  const prev = mutexByRun.get(runId) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => (release = r));
  mutexByRun.set(runId, next);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (mutexByRun.get(runId) === next) mutexByRun.delete(runId);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    p.finally(() => { if (timer) clearTimeout(timer); }),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => { onTimeout?.(); reject(new DelegateTimeout()); }, ms);
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
    // ok flag semantics: ok === true means the tool call succeeded (including
    // when it returns a status: "failed" DECISION the agent must handle, e.g.
    // teammate-not-found, depth-limit, policy rejection); ok === false means a
    // transport/execution error (context missing, executor exception, timeout).
    // This split is intentional so the agent can distinguish "the delegation
    // itself ran but the sub-task failed" from "we could not delegate at all".
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
    const controller = new AbortController();
    try {
      return await withRunMutex(binding.runId, async () => {
        try {
          const result = await withTimeout(
            deps.executor({
              teammate, task, runId: binding.runId, teamId: ctx.teamId, cwd: ctx.cwd,
              childEventId, parentEventId: binding.parentEventId, depth: childDepth,
              signal: controller.signal
            }),
            ctx.policy.delegateTimeoutMs,
            () => controller.abort()
          );
          const status: "done" | "failed" = result.error ? "failed" : "done";
          updateDelegationEvent(childEventId, {
            status,
            resultSummary: result.error ?? boundSummary(result.summary)
          });
          return {
            ok: status === "done",
            status,
            result: boundSummary(result.error ? (result.summary || result.error) : result.summary),
            event_id: childEventId
          };
        } catch (err) {
          if (err instanceof DelegateTimeout) {
            controller.abort();
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
