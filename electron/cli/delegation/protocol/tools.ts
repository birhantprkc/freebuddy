import type { DelegationRosterEntry, DelegationPolicy } from "../../delegationTeamTypes.js";
import {
  getDelegationEvent,
  insertDelegationEvent,
  type DelegationEventRow
} from "../../delegationRuns.js";
import {
  ancestorRosterIds,
  isWholeTaskRedelegate
} from "./guards.js";

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

export interface DelegateToolResponse {
  ok?: boolean;
  error?: string;
  status?: "pending" | "running" | "done" | "failed" | "timeout" | "cancelled";
  result?: string;
  teammates?: Array<{ id: string; label: string; capability: string; canWrite: boolean }>;
  event_id?: string | null;
  request_id?: string;
}

export type ListTeammatesResult = DelegateToolResponse;
export type CheckResult = DelegateToolResponse;

export function listTeammatesAction(
  binding: DelegateToolBinding,
  ctx: DelegateRunContext | undefined
): ListTeammatesResult {
  if (!ctx) return { ok: false, error: "run context not found" };
  const teammates = ctx.roster
    .filter((r) => r.id !== binding.selfAgentId)
    .map((r) => ({
      id: r.id,
      label: r.label,
      capability: r.capability,
      canWrite: r.canWrite
    }));
  return { ok: true, teammates };
}

export function checkDelegateResultAction(params: Record<string, unknown>): CheckResult {
  const requestId = String(params.request_id ?? "");
  if (!requestId) return { ok: false, error: "request_id required" };
  const event = getDelegationEvent(requestId);
  if (!event) return { ok: false, error: "request not found" };
  return {
    ok: true,
    status: event.status,
    result: event.resultSummary ?? "",
    request_id: requestId
  };
}

export type DelegateDecision =
  | { ok: true; kind: "reject"; status: "failed"; result: string }
  | {
      ok: true;
      kind: "enqueue";
      teammate: DelegationRosterEntry;
      task: string;
      childDepth: number;
    }
  | { ok: false; error: string; status?: "failed" };

/**
 * Validate a delegate request (hard guards). Does not insert/enqueue.
 */
export function decideDelegate(opts: {
  binding: DelegateToolBinding;
  ctx: DelegateRunContext | undefined;
  teammateId: string;
  task: string;
  getEvent?: (id: string) => DelegationEventRow | undefined;
}): DelegateDecision {
  const { binding, ctx, teammateId, task } = opts;
  if (!ctx) return { ok: false, error: "run context not found", status: "failed" };
  const teammate = ctx.roster.find((r) => r.id === teammateId);
  if (!teammate) {
    return { ok: true, kind: "reject", status: "failed", result: `teammate not found: ${teammateId}` };
  }
  if (teammate.id === binding.selfAgentId) {
    return { ok: true, kind: "reject", status: "failed", result: "cannot delegate to self" };
  }
  const childDepth = binding.depth + 1;
  if (childDepth > ctx.policy.maxDepth) {
    return {
      ok: true,
      kind: "reject",
      status: "failed",
      result: `已达最大委派深度(${ctx.policy.maxDepth})，请自行处理或简化该子任务`
    };
  }
  if (!ctx.policy.allowWrites && teammate.canWrite) {
    return {
      ok: true,
      kind: "reject",
      status: "failed",
      result: "策略禁止写操作（allowWrites=false）"
    };
  }

  const getEvent = opts.getEvent ?? getDelegationEvent;
  const banned = ancestorRosterIds({
    selfRosterId: binding.selfAgentId,
    parentEventId: binding.parentEventId,
    getEvent,
    roster: ctx.roster
  });
  if (banned.has(teammate.id)) {
    return {
      ok: true,
      kind: "reject",
      status: "failed",
      result: "cannot bounce to caller/ancestor (no ping-pong)"
    };
  }

  const parentEvent = getEvent(binding.parentEventId);
  const parentTask = parentEvent?.taskText ?? "";
  if (parentTask && isWholeTaskRedelegate(task, parentTask)) {
    return {
      ok: true,
      kind: "reject",
      status: "failed",
      result: "cannot delegate the entire task you were given; split a sub-task or do it yourself"
    };
  }

  return { ok: true, kind: "enqueue", teammate, task, childDepth };
}

/** Insert a pending child event after a successful decideDelegate enqueue decision. */
export function insertPendingChildEvent(opts: {
  runId: string;
  parentEventId: string;
  teammate: DelegationRosterEntry;
  task: string;
  childDepth: number;
}): string {
  return insertDelegationEvent({
    runId: opts.runId,
    parentEventId: opts.parentEventId,
    agentId: opts.teammate.agentId,
    agentName: opts.teammate.label,
    roleLabel: opts.teammate.label,
    taskText: opts.task,
    depth: opts.childDepth,
    canWrite: opts.teammate.canWrite,
    status: "pending"
  });
}
