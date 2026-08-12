import { getDb } from "./db.js";
import type { WorkflowRunStatus } from "./workflowTypes.js";
import type { DelegationEvent, DelegationEventStatus, DelegationVerdict } from "./delegationTeamTypes.js";

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
  goal: string;
  status: WorkflowRunStatus;
  cwd: string | null;
  teamId: string | null;
  teamSnapshotJson: string | null;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
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
  return {
    id: r.id,
    kind: "delegation",
    conversationId: r.conversation_id,
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

export function getDelegationRunByConversation(
  conversationId: string
): DelegationRunRow | undefined {
  const r = getDb()
    .prepare(
      "SELECT * FROM workflow_runs WHERE kind = 'delegation' AND conversation_id = ? ORDER BY created_at DESC LIMIT 1"
    )
    .get(conversationId) as any;
  if (!r) return undefined;
  return {
    id: r.id,
    kind: "delegation",
    conversationId: r.conversation_id,
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

export function setDelegationRunStatus(id: string, status: WorkflowRunStatus): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE workflow_runs SET status = ?, updated_at = ?, ended_at = ? WHERE id = ? AND kind = 'delegation'`
    )
    .run(status, now, ["completed", "failed", "killed", "partial"].includes(status) ? now : null, id);
}

export type DelegationEventRow = DelegationEvent;

function rowToEvent(r: any): DelegationEventRow {
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
    canWrite: r.can_write === 1 || r.can_write === true,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    verdict: (r.verdict as DelegationVerdict | null) ?? null,
    verdictSummary: r.verdict_summary ?? null,
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

export function insertDelegationEvent(input: InsertDelegationEventInput): string {
  const id = `delevent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO delegation_events
         (id, run_id, parent_event_id, agent_id, agent_name, role_label,
          task_text, depth, status, result_summary, can_write, started_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`
    )
    .run(
      id, input.runId, input.parentEventId, input.agentId, input.agentName,
      input.roleLabel, input.taskText, input.depth, input.status,
      input.canWrite ? 1 : 0, now
    );
  return id;
}

export interface UpdateDelegationEventPatch {
  status?: DelegationEventStatus;
  resultSummary?: string | null;
  verdict?: DelegationVerdict | null;
  verdictSummary?: string | null;
}

export function updateDelegationEvent(
  id: string,
  patch: UpdateDelegationEventPatch
): void {
  const fields: string[] = [];
  const params: any[] = [];
  if (patch.status !== undefined) {
    fields.push("status = ?");
    params.push(patch.status);
    if (["done", "failed", "timeout", "cancelled"].includes(patch.status)) {
      fields.push("ended_at = ?");
      params.push(new Date().toISOString());
    }
  }
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
}

export function listDelegationEvents(runId: string): DelegationEventRow[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM delegation_events WHERE run_id = ? ORDER BY started_at ASC"
    )
    .all(runId) as any[];
  return rows.map(rowToEvent);
}

export function getDelegationEvent(id: string): DelegationEventRow | undefined {
  const row = getDb().prepare("SELECT * FROM delegation_events WHERE id = ?").get(id) as any;
  return row ? rowToEvent(row) : undefined;
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
