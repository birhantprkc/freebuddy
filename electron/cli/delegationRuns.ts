import { getDb } from "./db.js";

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
  status: string;
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

export function setDelegationRunStatus(id: string, status: string): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE workflow_runs SET status = ?, updated_at = ?, ended_at = ? WHERE id = ? AND kind = 'delegation'`
    )
    .run(status, now, ["completed", "failed", "killed"].includes(status) ? now : null, id);
}
