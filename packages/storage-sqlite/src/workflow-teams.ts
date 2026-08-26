import type {
  WorkflowTeam,
  WorkflowTeamPolicy,
  WorkflowTeamRole,
  WorkflowTemplate2
} from "@freebuddy/protocol/workflow";
import type { SqliteDatabase } from "./types.js";

function rowToTeam(r: Record<string, unknown>): WorkflowTeam {
  return {
    id: String(r.id),
    name: String(r.name),
    description: (r.description as string | null) ?? undefined,
    icon: (r.icon as string | null) ?? undefined,
    enabled: r.enabled === 1 || r.enabled === true,
    source: ((r.source as "builtin" | "user") ?? "user") as WorkflowTeam["source"],
    roles: JSON.parse(String(r.roles_json)) as WorkflowTeamRole[],
    template: JSON.parse(String(r.template_json)) as WorkflowTemplate2,
    policy: JSON.parse(String(r.policy_json)) as WorkflowTeamPolicy,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at)
  };
}

export function listWorkflowTeams(db: SqliteDatabase): WorkflowTeam[] {
  const rows = db
    .prepare(
      "SELECT * FROM workflow_teams WHERE kind = 'workflow' OR kind IS NULL ORDER BY source DESC, created_at ASC"
    )
    .all() as Record<string, unknown>[];
  return rows.map(rowToTeam);
}

export function getWorkflowTeam(db: SqliteDatabase, id: string): WorkflowTeam | undefined {
  const row = db
    .prepare("SELECT * FROM workflow_teams WHERE id = ? AND (kind = 'workflow' OR kind IS NULL)")
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToTeam(row) : undefined;
}

export interface UpsertWorkflowTeamInput {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  enabled: boolean;
  source: "builtin" | "user";
  roles: WorkflowTeamRole[];
  template: WorkflowTemplate2;
  policy: WorkflowTeamPolicy;
}

export function insertWorkflowTeam(
  db: SqliteDatabase,
  input: UpsertWorkflowTeamInput,
  now = new Date().toISOString()
): WorkflowTeam {
  db.prepare(
    `INSERT INTO workflow_teams
       (id, name, description, icon, enabled, source,
        roles_json, template_json, policy_json,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.id,
    input.name,
    input.description ?? null,
    input.icon ?? null,
    input.enabled ? 1 : 0,
    input.source,
    JSON.stringify(input.roles),
    JSON.stringify(input.template),
    JSON.stringify(input.policy),
    now,
    now
  );
  return getWorkflowTeam(db, input.id) as WorkflowTeam;
}

export interface UpdateWorkflowTeamPatch {
  name?: string;
  description?: string | null;
  icon?: string | null;
  enabled?: boolean;
  roles?: WorkflowTeamRole[];
  template?: WorkflowTemplate2;
  policy?: WorkflowTeamPolicy;
}

export function updateWorkflowTeam(
  db: SqliteDatabase,
  id: string,
  patch: UpdateWorkflowTeamPatch
): WorkflowTeam | undefined {
  const existing = getWorkflowTeam(db, id);
  if (!existing) return undefined;
  const fields: string[] = ["updated_at = ?"];
  const params: unknown[] = [new Date().toISOString()];
  if (patch.name !== undefined) {
    fields.push("name = ?");
    params.push(patch.name);
  }
  if (patch.description !== undefined) {
    fields.push("description = ?");
    params.push(patch.description);
  }
  if (patch.icon !== undefined) {
    fields.push("icon = ?");
    params.push(patch.icon);
  }
  if (patch.enabled !== undefined) {
    fields.push("enabled = ?");
    params.push(patch.enabled ? 1 : 0);
  }
  if (patch.roles !== undefined) {
    fields.push("roles_json = ?");
    params.push(JSON.stringify(patch.roles));
  }
  if (patch.template !== undefined) {
    fields.push("template_json = ?");
    params.push(JSON.stringify(patch.template));
  }
  if (patch.policy !== undefined) {
    fields.push("policy_json = ?");
    params.push(JSON.stringify(patch.policy));
  }
  params.push(id);
  db.prepare(`UPDATE workflow_teams SET ${fields.join(", ")} WHERE id = ?`).run(...params);
  return getWorkflowTeam(db, id);
}

export function deleteWorkflowTeam(db: SqliteDatabase, id: string): boolean {
  const team = getWorkflowTeam(db, id);
  if (!team || team.source === "builtin") return false;
  db.prepare("DELETE FROM workflow_teams WHERE id = ?").run(id);
  return true;
}

export function deleteBuiltinWorkflowTeam(db: SqliteDatabase, id: string): Record<string, unknown> | undefined {
  const row = db
    .prepare("SELECT id, source, roles_json FROM workflow_teams WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  db.prepare("DELETE FROM workflow_teams WHERE id = ? AND source = 'builtin'").run(id);
  return row;
}
