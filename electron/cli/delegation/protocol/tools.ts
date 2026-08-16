import type {
  DelegationResult,
  DelegationRosterEntry,
  DelegationPolicy
} from "../../delegationTeamTypes.js";
import type { DelegationVerdict } from "../../delegationTeamTypes.js";
import {
  getDelegationEvent,
  insertDelegationEvent,
  insertDelegationEventsAtomic,
  updateDelegationEvent,
  type DelegationEventRow
} from "../../delegationRuns.js";
import {
  ancestorRosterIds,
  isWholeTaskRedelegate
} from "./guards.js";
import { PROTOCOL_RULES } from "./text.js";

export interface DelegateToolBinding {
  token: string;
  taskSessionId: string;
  runId: string;
  parentEventId: string;
  depth: number;
  selfAgentId: string;
  selfLabel: string;
  /** Remote owner restored around local MCP callbacks; never supplied by the model. */
  ownerId?: string;
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
  /** Versioned terminal result. `result` remains for older agents. */
  outcome?: DelegationResult | null;
  teammates?: Array<{ id: string; label: string; capability: string; canWrite: boolean }>;
  event_id?: string | null;
  request_id?: string;
  requests?: Array<{
    request_id: string;
    event_id: string;
    teammate_id: string;
    status: "pending";
  }>;
  request_ids?: string[];
  accepted_count?: number;
  verdict?: DelegationVerdict | null;
  verdictSummary?: string | null;
  /** Present when status is running — model should end the turn. */
  instruction?: string;
}

export type ListTeammatesResult = DelegateToolResponse;
export type CheckResult = DelegateToolResponse;

export function listTeammatesAction(
  binding: DelegateToolBinding,
  ctx: DelegateRunContext | undefined
): ListTeammatesResult {
  if (!ctx) return { ok: false, error: "run context not found" };
  const banned = ancestorRosterIds({
    selfRosterId: binding.selfAgentId,
    parentEventId: binding.parentEventId,
    getEvent: getDelegationEvent,
    roster: ctx.roster
  });
  const teammates = ctx.roster
    .filter((r) => !banned.has(r.id))
    .map((r) => ({
      id: r.id,
      label: r.label,
      capability: r.capability,
      canWrite: r.canWrite
    }));
  return { ok: true, teammates };
}

function getOwnedDirectChildEvent(
  binding: DelegateToolBinding,
  requestId: string
): DelegationEventRow | undefined {
  const event = getDelegationEvent(requestId);
  if (
    !event ||
    event.runId !== binding.runId ||
    event.parentEventId !== binding.parentEventId
  ) {
    return undefined;
  }
  return event;
}

function getOwnedEvent(
  binding: DelegateToolBinding,
  requestId: string
): DelegationEventRow | undefined {
  const event = getDelegationEvent(requestId);
  if (!event || event.runId !== binding.runId) return undefined;
  if (event.id === binding.parentEventId || event.parentEventId === binding.parentEventId) {
    return event;
  }
  return undefined;
}

export function checkDelegateResultAction(
  binding: DelegateToolBinding,
  params: Record<string, unknown>
): CheckResult {
  const requestId = String(params.request_id ?? "");
  if (!requestId) return { ok: false, error: "request_id required" };
  const event = getOwnedEvent(binding, requestId);
  if (!event) return { ok: false, error: "request not found" };
  const response: CheckResult = {
    ok: true,
    status: event.status,
    result: event.resultSummary ?? "",
    outcome: event.result,
    request_id: requestId,
    verdict: event.verdict,
    verdictSummary: event.verdictSummary
  };
  if (event.status === "running") {
    response.instruction = PROTOCOL_RULES.runningCheckInstruction;
  }
  return response;
}

export function yieldToDelegatesAction(
  binding: DelegateToolBinding,
  params: Record<string, unknown>
): DelegateToolResponse {
  if (!Array.isArray(params.request_ids) || params.request_ids.length === 0) {
    return { ok: false, error: "request_ids must be a non-empty array" };
  }
  const requestIds = [...new Set(params.request_ids.map((id) => String(id).trim()))];
  if (requestIds.some((id) => !id)) {
    return { ok: false, error: "request_ids must contain non-empty strings" };
  }

  const events = requestIds.map((id) => getOwnedDirectChildEvent(binding, id));
  if (events.some((event) => !event)) {
    return { ok: false, error: "one or more delegation requests were not found" };
  }
  const activeIds = events
    .filter((event) => event!.status === "pending" || event!.status === "running")
    .map((event) => event!.id);
  if (activeIds.length === 0) {
    return {
      ok: false,
      status: "failed",
      error: "all requested delegations are already settled; inspect their results instead"
    };
  }
  return {
    ok: true,
    status: "running",
    request_ids: activeIds,
    instruction: PROTOCOL_RULES.yieldInstruction
  };
}

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
    verdictSummary: summary !== undefined ? summary : null
  });
  return { ok: true, verdict: verdict as DelegationVerdict, event_id: eventId };
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
  const normalizedTask = task.trim();
  if (!normalizedTask) {
    return { ok: false, error: "task required", status: "failed" };
  }
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
  if (parentTask && isWholeTaskRedelegate(normalizedTask, parentTask)) {
    return {
      ok: true,
      kind: "reject",
      status: "failed",
      result: "cannot delegate the entire task you were given; split a sub-task or do it yourself"
    };
  }

  return { ok: true, kind: "enqueue", teammate, task: normalizedTask, childDepth };
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

/** Atomically persist a validated batch before any executor is started. */
export function insertPendingChildEventsAtomic(
  items: Array<{
    runId: string;
    parentEventId: string;
    teammate: DelegationRosterEntry;
    task: string;
    childDepth: number;
  }>
): string[] {
  return insertDelegationEventsAtomic(
    items.map((item) => ({
      runId: item.runId,
      parentEventId: item.parentEventId,
      agentId: item.teammate.agentId,
      agentName: item.teammate.label,
      roleLabel: item.teammate.label,
      taskText: item.task,
      depth: item.childDepth,
      canWrite: item.teammate.canWrite,
      status: "pending"
    }))
  );
}
