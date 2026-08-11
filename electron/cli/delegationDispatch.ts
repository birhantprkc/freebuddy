import type { DelegationRosterEntry, DelegationPolicy } from "./delegationTeamTypes.js";
import { updateDelegationEvent } from "./delegationRuns.js";
import { DelegateConcurrencyQueue } from "./delegation/bus/concurrency.js";
import {
  checkDelegateResultAction,
  decideDelegate,
  insertPendingChildEvent,
  listTeammatesAction,
  type DelegateToolBinding,
  type DelegateRunContext,
  type DelegateToolResponse
} from "./delegation/protocol/tools.js";

export type {
  DelegateToolBinding,
  DelegateRunContext,
  DelegateToolResponse
} from "./delegation/protocol/tools.js";

const MAX_RESULT_CHARS = 12_000;

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
  /** Optional: notify bus that a child node was enqueued / started. */
  onChildEnqueued?: (args: {
    runId: string;
    childEventId: string;
    parentEventId: string;
    depth: number;
  }) => void;
}

function boundSummary(text: string): string {
  if (text.length <= MAX_RESULT_CHARS) return text;
  const head = text.slice(0, Math.floor(MAX_RESULT_CHARS / 2));
  const tail = text.slice(text.length - Math.floor(MAX_RESULT_CHARS / 2));
  return `${head}\n…[truncated]…\n${tail}`;
}

/** Per-deps queue instance so tests injecting different deps don't share state incorrectly.
 *  We key by deps object identity via WeakMap; settle always drains the same queue. */
const queuesByDeps = new WeakMap<
  DelegateActionDeps,
  DelegateConcurrencyQueue<DelegateExecArgs, DelegateExecResult>
>();

function queueFor(deps: DelegateActionDeps): DelegateConcurrencyQueue<
  DelegateExecArgs,
  DelegateExecResult
> {
  let q = queuesByDeps.get(deps);
  if (!q) {
    q = new DelegateConcurrencyQueue<DelegateExecArgs, DelegateExecResult>({
      getPolicy: (runId) => deps.contextProvider(runId)?.policy,
      executor: (args) => deps.executor(args),
      onResult: (childEventId, result) => {
        const status = result.error ? "failed" : "done";
        updateDelegationEvent(childEventId, {
          status,
          resultSummary: result.error ?? boundSummary(result.summary)
        });
      },
      onTimeout: (childEventId) => {
        updateDelegationEvent(childEventId, {
          status: "timeout",
          resultSummary: "委派超时"
        });
      },
      onError: (childEventId, err) => {
        updateDelegationEvent(childEventId, {
          status: "failed",
          resultSummary: (err as Error)?.message ?? String(err)
        });
      },
      onSettled: (childEventId) => {
        deps.onSettle?.(childEventId);
      }
    });
    queuesByDeps.set(deps, q);
  }
  return q;
}

export async function runDelegateAction(
  binding: DelegateToolBinding,
  action: string,
  params: Record<string, unknown>,
  deps: DelegateActionDeps
): Promise<DelegateToolResponse> {
  if (action === "list_teammates") {
    return listTeammatesAction(binding, deps.contextProvider(binding.runId));
  }

  if (action === "delegate") {
    const ctx = deps.contextProvider(binding.runId);
    const decision = decideDelegate({
      binding,
      ctx,
      teammateId: String(params.teammate_id ?? ""),
      task: String(params.task ?? "")
    });
    if (!decision.ok) {
      return { ok: false, error: decision.error, status: decision.status };
    }
    if (decision.kind === "reject") {
      return { ok: true, status: decision.status, result: decision.result };
    }

    if (
      decision.teammate.canWrite &&
      ctx!.policy.requireApprovalBeforeDelegateWrite
    ) {
      const approved = await deps.writeApproval(binding, decision.teammate);
      if (!approved) {
        return { ok: true, status: "failed", result: "写委派被用户拒绝" };
      }
    }

    const childEventId = insertPendingChildEvent({
      runId: binding.runId,
      parentEventId: binding.parentEventId,
      teammate: decision.teammate,
      task: decision.task,
      childDepth: decision.childDepth
    });

    deps.onChildEnqueued?.({
      runId: binding.runId,
      childEventId,
      parentEventId: binding.parentEventId,
      depth: decision.childDepth
    });

    const execArgs: DelegateExecArgs = {
      teammate: decision.teammate,
      task: decision.task,
      runId: binding.runId,
      teamId: ctx!.teamId,
      cwd: ctx!.cwd,
      childEventId,
      parentEventId: binding.parentEventId,
      depth: decision.childDepth
    };
    queueFor(deps).enqueue(binding.runId, {
      childEventId,
      execArgs,
      timeoutMs: ctx!.policy.delegateTimeoutMs
    });
    return {
      ok: true,
      status: "pending",
      request_id: childEventId,
      event_id: childEventId
    };
  }

  if (action === "check_delegate_result") {
    return checkDelegateResultAction(params);
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

// Re-export policy type touch for consumers that imported from here historically.
export type { DelegationPolicy };
