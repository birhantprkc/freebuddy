import { getDb } from "./db.js";
import type { WorkflowRunStatus } from "./workflowTypes.js";
import type { DelegationEvent, DelegationEventStatus } from "./delegationTeamTypes.js";

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
    endedAt: r.ended_at
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
