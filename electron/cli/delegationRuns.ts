import { getDb } from "./db.js";
import { getCallerUserId, isCallerAdmin } from "./callerContext.js";
import type { WorkflowRunStatus } from "./workflowTypes.js";
import type {
  DelegationArtifact,
  DelegationEvent,
  DelegationEventStatus,
  DelegationResult,
  DelegationVerdict
} from "./delegationTeamTypes.js";

export interface CreateDelegationRunInput {
  goal: string;
  cwd?: string;
  teamId: string;
  teamSnapshotJson: string;
  conversationId?: string;
}

export interface DelegationRunRow {
  id: string;
  kind: "delegation";
  conversationId: string | null;
  name: string;
  goal: string;
  status: WorkflowRunStatus;
  cwd: string | null;
  teamId: string | null;
  teamSnapshotJson: string | null;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
}

export type DelegationRunFinishedEvent = {
  runId: string;
  conversationId?: string;
  status: string;
  name: string;
};

let delegationRunFinishedHandler:
  | ((event: DelegationRunFinishedEvent) => void)
  | null = null;

export function bindDelegationRunFinishedNotifier(
  fn: ((event: DelegationRunFinishedEvent) => void) | null
): void {
  delegationRunFinishedHandler = fn;
}

const TERMINAL_RUN_STATUSES = new Set<WorkflowRunStatus>([
  "completed",
  "failed",
  "killed",
  "partial"
]);

function mapDelegationRunRow(r: any): DelegationRunRow {
  return {
    id: r.id,
    kind: "delegation",
    conversationId: r.conversation_id,
    name: typeof r.name === "string" && r.name.trim() ? r.name : r.goal,
    goal: r.goal,
    status: r.status,
    cwd: r.cwd,
    teamId: r.team_id,
    teamSnapshotJson: r.team_snapshot_json,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    endedAt: r.ended_at
  };
}

function callerOwnsConversation(conversationId: string | null | undefined): boolean {
  if (isCallerAdmin() || getCallerUserId() === null) return true;
  if (!conversationId) return false;
  const row = getDb()
    .prepare("SELECT owner_id FROM conversations WHERE id = ?")
    .get(conversationId) as { owner_id: string | null } | undefined;
  return row?.owner_id === getCallerUserId();
}

export function callerCanAccessDelegationRun(runId: string): boolean {
  if (isCallerAdmin() || getCallerUserId() === null) return true;
  const row = getDb()
    .prepare(
      `SELECT wr.conversation_id, c.owner_id
       FROM workflow_runs wr
       LEFT JOIN conversations c ON c.id = wr.conversation_id
       WHERE wr.id = ? AND wr.kind = 'delegation'`
    )
    .get(runId) as
    | { conversation_id: string | null; owner_id: string | null }
    | undefined;
  return Boolean(row?.conversation_id) && row?.owner_id === getCallerUserId();
}

/** Internal owner lookup used to restore caller context for agent/tool callbacks. */
export function getDelegationRunOwnerId(runId: string): string | null {
  const row = getDb()
    .prepare(
      `SELECT c.owner_id
       FROM workflow_runs wr
       LEFT JOIN conversations c ON c.id = wr.conversation_id
       WHERE wr.id = ? AND wr.kind = 'delegation'`
    )
    .get(runId) as { owner_id: string | null } | undefined;
  return row?.owner_id ?? null;
}

export function createDelegationRun(input: CreateDelegationRunInput): string {
  const id = `delrun_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO workflow_runs
         (id, conversation_id, name, goal, status, cwd, template,
          loop_index, max_loops, plan_json, team_id, team_snapshot_json, kind,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, 'running', ?, 'delegation', 0, 1, '{}', ?, ?, 'delegation', ?, ?)`
    )
    .run(
      id,
      input.conversationId ?? null,
      input.goal.slice(0, 80) || "Delegation run",
      input.goal,
      input.cwd ?? null,
      input.teamId,
      input.teamSnapshotJson,
      now,
      now
    );
  return id;
}

export function getDelegationRun(id: string): DelegationRunRow | undefined {
  const r = getDb()
    .prepare("SELECT * FROM workflow_runs WHERE id = ? AND kind = 'delegation'")
    .get(id) as any;
  if (!r) return undefined;
  const run = mapDelegationRunRow(r);
  return callerOwnsConversation(run.conversationId) ? run : undefined;
}

export function getDelegationRunByConversation(
  conversationId: string
): DelegationRunRow | undefined {
  if (!callerOwnsConversation(conversationId)) return undefined;
  const r = getDb()
    .prepare(
      "SELECT * FROM workflow_runs WHERE kind = 'delegation' AND conversation_id = ? ORDER BY created_at DESC LIMIT 1"
    )
    .get(conversationId) as any;
  if (!r) return undefined;
  return mapDelegationRunRow(r);
}

export function setDelegationRunStatus(
  id: string,
  status: WorkflowRunStatus,
  options?: { allowReopen?: boolean }
): boolean {
  const previous = getDelegationRun(id);
  if (!previous) return false;
  if (
    TERMINAL_RUN_STATUSES.has(previous.status) &&
    previous.status !== status &&
    !options?.allowReopen
  ) {
    return false;
  }
  const now = new Date().toISOString();
  const result = getDb()
    .prepare(
      `UPDATE workflow_runs SET status = ?, updated_at = ?, ended_at = ?
       WHERE id = ? AND kind = 'delegation' AND status = ?`
    )
    .run(
      status,
      now,
      TERMINAL_RUN_STATUSES.has(status) ? now : null,
      id,
      previous.status
    );
  if (result.changes === 0) return false;

  // Mirror workflow finalize: notify on first transition into a non-killed
  // terminal status so unread / OS notification / pet broadcast can fire.
  if (
    previous &&
    !TERMINAL_RUN_STATUSES.has(previous.status) &&
    TERMINAL_RUN_STATUSES.has(status) &&
    status !== "killed"
  ) {
    delegationRunFinishedHandler?.({
      runId: id,
      conversationId: previous.conversationId ?? undefined,
      status,
      name: previous.name || previous.goal || "Delegation run"
    });
  }
  return true;
}

export type DelegationEventRow = DelegationEvent;

function parseDelegationResult(value: unknown): DelegationResult | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value) as DelegationResult;
    return parsed?.schemaVersion === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function rowToEvent(r: any): DelegationEventRow {
  const verdict = (r.verdict as DelegationVerdict | null) ?? null;
  const verdictSummary = r.verdict_summary ?? null;
  const storedResult = parseDelegationResult(r.result_json);
  return {
    id: r.id,
    runId: r.run_id,
    parentEventId: r.parent_event_id,
    agentId: r.agent_id,
    agentName: r.agent_name,
    roleLabel: r.role_label,
    taskText: r.task_text,
    depth: r.depth,
    status: r.status,
    resultSummary: r.result_summary,
    result: storedResult
      ? { ...storedResult, verdict, verdictSummary }
      : null,
    canWrite: r.can_write === 1 || r.can_write === true,
    acceptedAt: r.accepted_at ?? r.started_at ?? null,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    verdict,
    verdictSummary,
  };
}

export interface InsertDelegationEventInput {
  runId: string;
  parentEventId: string | null;
  agentId: string;
  agentName: string;
  roleLabel: string;
  taskText: string;
  depth: number;
  canWrite: boolean;
  status: DelegationEventStatus;
}

function createDelegationEventId(): string {
  return `delevent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const INSERT_DELEGATION_EVENT_SQL = `INSERT INTO delegation_events
  (id, run_id, parent_event_id, agent_id, agent_name, role_label,
   task_text, depth, status, result_summary, can_write, accepted_at, started_at, ended_at)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL)`;

export function insertDelegationEvent(input: InsertDelegationEventInput): string {
  const id = createDelegationEventId();
  const now = new Date().toISOString();
  getDb()
    .prepare(INSERT_DELEGATION_EVENT_SQL)
    .run(
      id, input.runId, input.parentEventId, input.agentId, input.agentName,
      input.roleLabel, input.taskText, input.depth, input.status,
      input.canWrite ? 1 : 0, now, input.status === "running" ? now : null
    );
  return id;
}

/**
 * Insert a batch of delegation events as one durable acceptance operation.
 * Either every event is visible to the runtime, or none of them are.
 */
export function insertDelegationEventsAtomic(
  inputs: InsertDelegationEventInput[]
): string[] {
  if (inputs.length === 0) return [];
  const db = getDb();
  const statement = db.prepare(INSERT_DELEGATION_EVENT_SQL);
  return db.transaction((items: InsertDelegationEventInput[]) =>
    items.map((input) => {
      const id = createDelegationEventId();
      const now = new Date().toISOString();
      statement.run(
        id, input.runId, input.parentEventId, input.agentId, input.agentName,
        input.roleLabel, input.taskText, input.depth, input.status,
        input.canWrite ? 1 : 0, now, input.status === "running" ? now : null
      );
      return id;
    })
  )(inputs);
}

export interface UpdateDelegationEventPatch {
  status?: DelegationEventStatus;
  resultSummary?: string | null;
  verdict?: DelegationVerdict | null;
  verdictSummary?: string | null;
}

type TerminalDelegationStatus = DelegationResult["status"];

export function buildDelegationResult(input: {
  status: TerminalDelegationStatus;
  summary?: string | null;
  exitCode?: number | null;
  errorMessage?: string | null;
  artifacts?: DelegationArtifact[];
  verdict?: DelegationVerdict | null;
  verdictSummary?: string | null;
}): DelegationResult {
  const summary = input.summary ?? input.errorMessage ?? "";
  const error = input.status === "done"
    ? null
    : {
        code: input.status === "timeout"
          ? "delegate_timeout" as const
          : input.status === "cancelled"
            ? "delegate_cancelled" as const
            : "delegate_failed" as const,
        message: input.errorMessage ?? summary,
        retryable: input.status !== "cancelled"
      };
  return {
    schemaVersion: 1,
    status: input.status,
    summary,
    exitCode: input.exitCode ?? null,
    error,
    artifacts: input.artifacts ?? [],
    verdict: input.verdict ?? null,
    verdictSummary: input.verdictSummary ?? null
  };
}

const EVENT_TRANSITION_SOURCES: Record<DelegationEventStatus, DelegationEventStatus[]> = {
  pending: [],
  running: ["pending"],
  done: ["running"],
  failed: ["pending", "running"],
  timeout: ["pending", "running"],
  cancelled: ["pending", "running"]
};

/**
 * The only status writer for delegation events. The SQL precondition makes a
 * terminal event immutable when a cancelled/timed-out executor resolves late.
 */
export function transitionDelegationEvent(
  id: string,
  status: DelegationEventStatus,
  resultSummary?: string | null,
  options?: { allowReopen?: boolean; result?: DelegationResult | null }
): boolean {
  const sources = options?.allowReopen
    ? (["pending", "running", "done", "failed", "timeout", "cancelled"] as DelegationEventStatus[])
    : EVENT_TRANSITION_SOURCES[status];
  if (sources.length === 0) return false;
  const terminal = isTerminalDelegationStatus(status);
  const transitionedAt = new Date().toISOString();
  const current = getDb()
    .prepare("SELECT verdict, verdict_summary FROM delegation_events WHERE id = ?")
    .get(id) as { verdict?: DelegationVerdict | null; verdict_summary?: string | null } | undefined;
  const structuredResult = terminal
    ? {
        ...(options?.result ?? buildDelegationResult({
          status: status as TerminalDelegationStatus,
          summary: resultSummary
        })),
        status: status as TerminalDelegationStatus,
        summary: resultSummary ?? options?.result?.summary ?? "",
        verdict: current?.verdict ?? options?.result?.verdict ?? null,
        verdictSummary:
          current?.verdict_summary ?? options?.result?.verdictSummary ?? null
      }
    : null;
  const placeholders = sources.map(() => "?").join(",");
  const result = getDb()
    .prepare(
      `UPDATE delegation_events
       SET status = ?, result_summary = ?, result_json = ?,
           started_at = CASE WHEN ? = 'running' THEN COALESCE(started_at, ?) ELSE started_at END,
           ended_at = ?
       WHERE id = ? AND status IN (${placeholders})`
    )
    .run(
      status,
      resultSummary ?? null,
      structuredResult ? JSON.stringify(structuredResult) : null,
      status,
      transitionedAt,
      terminal ? transitionedAt : null,
      id,
      ...sources
    );
  return result.changes > 0;
}

export function updateDelegationEvent(
  id: string,
  patch: UpdateDelegationEventPatch
): void {
  if (patch.status !== undefined) {
    transitionDelegationEvent(id, patch.status, patch.resultSummary);
    patch = { ...patch, status: undefined, resultSummary: undefined };
  }
  const fields: string[] = [];
  const params: any[] = [];
  if (patch.resultSummary !== undefined) {
    fields.push("result_summary = ?");
    params.push(patch.resultSummary);
  }
  if (patch.verdict !== undefined) {
    fields.push("verdict = ?");
    params.push(patch.verdict);
  }
  if (patch.verdictSummary !== undefined) {
    fields.push("verdict_summary = ?");
    params.push(patch.verdictSummary);
  }
  if (fields.length === 0) return;
  params.push(id);
  getDb()
    .prepare(`UPDATE delegation_events SET ${fields.join(", ")} WHERE id = ?`)
    .run(...params);
  if (patch.verdict !== undefined || patch.verdictSummary !== undefined) {
    const row = getDb()
      .prepare("SELECT result_json, verdict, verdict_summary FROM delegation_events WHERE id = ?")
      .get(id) as any;
    const stored = parseDelegationResult(row?.result_json);
    if (stored) {
      getDb()
        .prepare("UPDATE delegation_events SET result_json = ? WHERE id = ?")
        .run(JSON.stringify({
          ...stored,
          verdict: (row.verdict as DelegationVerdict | null) ?? null,
          verdictSummary: row.verdict_summary ?? null
        }), id);
    }
  }
}

export function listDelegationEvents(runId: string): DelegationEventRow[] {
  if (!callerCanAccessDelegationRun(runId)) return [];
  const rows = getDb()
    .prepare(
      "SELECT * FROM delegation_events WHERE run_id = ? ORDER BY COALESCE(accepted_at, started_at) ASC"
    )
    .all(runId) as any[];
  return rows.map(rowToEvent);
}

export function getDelegationEvent(id: string): DelegationEventRow | undefined {
  const row = getDb().prepare("SELECT * FROM delegation_events WHERE id = ?").get(id) as any;
  if (!row || !callerCanAccessDelegationRun(row.run_id)) return undefined;
  return rowToEvent(row);
}

const ACTIVE_DELEGATION_STATUSES = ["running", "pending"] as const;
const TERMINAL_DELEGATION_STATUSES = ["done", "failed", "timeout", "cancelled"] as const;

export function isTerminalDelegationStatus(status: string): boolean {
  return (TERMINAL_DELEGATION_STATUSES as readonly string[]).includes(status);
}

/** Outstanding delegates (depth>=1) still running/pending under a run. */
export function countActiveDelegationEvents(runId: string): number {
  const placeholders = ACTIVE_DELEGATION_STATUSES.map(() => "?").join(",");
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM delegation_events
       WHERE run_id = ? AND parent_event_id IS NOT NULL AND status IN (${placeholders})`
    )
    .get(runId, ...ACTIVE_DELEGATION_STATUSES) as { n: number } | undefined;
  return row?.n ?? 0;
}

/** Delegates (depth>=1) currently executing (status = running). Excludes queued (pending). */
export function countRunningDelegationEvents(runId: string): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM delegation_events
       WHERE run_id = ? AND parent_event_id IS NOT NULL AND status = 'running'`
    )
    .get(runId) as { n: number } | undefined;
  return row?.n ?? 0;
}

/**
 * Active "leaf" delegates: running delegates (depth>=1) that currently have no
 * active (pending or running) child. A delegatee that has spawned a child is
 * parked waiting on that child and must not count against maxConcurrentDelegates.
 */
export function countActiveDelegateLeaves(runId: string): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM delegation_events AS d
       WHERE d.run_id = ? AND d.parent_event_id IS NOT NULL AND d.status = 'running'
         AND NOT EXISTS (
           SELECT 1 FROM delegation_events AS c
           WHERE c.run_id = d.run_id AND c.parent_event_id = d.id
             AND c.status IN ('running','pending')
         )`
    )
    .get(runId) as { n: number } | undefined;
  return row?.n ?? 0;
}

/** Cancel all pending/running events under a run. Returns cancelled ids. */
export function cancelActiveDelegationEvents(runId: string, reason: string): string[] {
  const active = listDelegationEvents(runId).filter(
    (e) => e.status === "pending" || e.status === "running"
  );
  const ids: string[] = [];
  for (const ev of active) {
    if (transitionDelegationEvent(ev.id, "cancelled", reason)) ids.push(ev.id);
  }
  return ids;
}

/** Active (non-terminal) child events of a given parent event. */
export function listPendingChildEvents(
  runId: string,
  parentEventId: string
): DelegationEventRow[] {
  const placeholders = ACTIVE_DELEGATION_STATUSES.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT * FROM delegation_events
       WHERE run_id = ? AND parent_event_id = ? AND status IN (${placeholders})
       ORDER BY started_at ASC`
    )
    .all(runId, parentEventId, ...ACTIVE_DELEGATION_STATUSES) as any[];
  return rows.map(rowToEvent);
}
