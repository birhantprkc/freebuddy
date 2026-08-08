import { BrowserWindow } from "electron";
import { getDb } from "./db.js";
import { logMain } from "../debugLog.js";
import { safeSendToWebContents } from "./ipcSend.js";
import type {
  WorkflowTeam,
  WorkflowTeamPolicy,
  WorkflowTeamRole,
  WorkflowTemplate2
} from "./workflowTeamTypes.js";
import { builtinWorkflowTeams } from "./workflowTeamBuiltins.js";

function notifyWorkflowTeamsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    safeSendToWebContents(win.webContents, "workflowTeams://changed", undefined);
  }
}

/**
 * Audit every workflow_teams write so exported debug logs can pinpoint which
 * process / caller mutated a team's roles (esp. skillIds). The pid field is the
 * key signal for the multi-process clobber scenario; skillCounts reveals whether
 * the write cleared or preserved per-role skills.
 */
export function auditTeamWrite(
  action: string,
  teamId: string,
  roles: WorkflowTeamRole[] | undefined,
  extra?: Record<string, unknown>
): void {
  try {
    logMain().info("workflowTeams", "audit write", {
      action,
      teamId,
      pid: process.pid,
      ppid: process.ppid,
      roleCount: roles?.length ?? 0,
      skillCounts: roles?.map((r) => ({ id: r.id, n: r.skillIds?.length ?? 0 })),
      ...extra
    });
  } catch {
    /* audit logging must never disrupt the write path */
  }
}

function rowToTeam(r: any): WorkflowTeam {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    icon: r.icon ?? undefined,
    enabled: r.enabled === 1 || r.enabled === true,
    source: (r.source as "builtin" | "user") ?? "user",
    roles: JSON.parse(r.roles_json) as WorkflowTeamRole[],
    template: JSON.parse(r.template_json) as WorkflowTemplate2,
    policy: JSON.parse(r.policy_json) as WorkflowTeamPolicy,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

export function listWorkflowTeams(): WorkflowTeam[] {
  const rows = getDb()
    .prepare("SELECT * FROM workflow_teams WHERE kind = 'workflow' OR kind IS NULL ORDER BY source DESC, created_at ASC")
    .all() as any[];
  return rows.map(rowToTeam);
}

export function getWorkflowTeam(id: string): WorkflowTeam | undefined {
  const row = getDb()
    .prepare("SELECT * FROM workflow_teams WHERE id = ?")
    .get(id) as any;
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

export function insertWorkflowTeam(input: UpsertWorkflowTeamInput): WorkflowTeam {
  const now = new Date().toISOString();
  auditTeamWrite("insert", input.id, input.roles, { source: input.source });
  getDb()
    .prepare(
      `INSERT INTO workflow_teams
         (id, name, description, icon, enabled, source,
          roles_json, template_json, policy_json,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
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
  const created = getWorkflowTeam(input.id) as WorkflowTeam;
  notifyWorkflowTeamsChanged();
  return created;
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
  id: string,
  patch: UpdateWorkflowTeamPatch
): WorkflowTeam | undefined {
  const existing = getWorkflowTeam(id);
  if (!existing) return undefined;

  auditTeamWrite(
    "update",
    id,
    patch.roles ?? existing.roles,
    patch.roles !== undefined ? { changedRoles: true } : { changedRoles: false }
  );

  const fields: string[] = ["updated_at = ?"];
  const params: any[] = [new Date().toISOString()];
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
  getDb()
    .prepare(`UPDATE workflow_teams SET ${fields.join(", ")} WHERE id = ?`)
    .run(...params);
  const updated = getWorkflowTeam(id);
  notifyWorkflowTeamsChanged();
  return updated;
}

export function deleteWorkflowTeam(id: string): boolean {
  const team = getWorkflowTeam(id);
  if (!team) return false;
  if (team.source === "builtin") return false;
  auditTeamWrite("delete", id, team.roles, { source: team.source });
  getDb().prepare("DELETE FROM workflow_teams WHERE id = ?").run(id);
  notifyWorkflowTeamsChanged();
  return true;
}

export { builtinWorkflowTeams };

const removedBuiltinWorkflowTeamIds = [
  "team-code-review",
  "team-readonly-analysis",
  "team-quick-implement",
  "team-implement-review-loop"
];

function mergeBuiltinRoles(
  existing: WorkflowTeam,
  builtin: WorkflowTeam
): WorkflowTeamRole[] {
  const existingRoleById = new Map(
    existing.roles.map((role) => [role.id, role])
  );
  return builtin.roles.map((role) => {
    const savedRole = existingRoleById.get(role.id);
    return {
      ...role,
      agentId: savedRole?.agentId ?? role.agentId,
      ...(savedRole?.model ? { model: savedRole.model } : {}),
      ...(savedRole?.modelOptionId
        ? { modelOptionId: savedRole.modelOptionId }
        : {}),
      skillIds: savedRole?.skillIds ?? role.skillIds
    };
  });
}

function mergeBuiltinPolicy(
  existing: WorkflowTeam,
  builtin: WorkflowTeam
): WorkflowTeamPolicy {
  return {
    ...builtin.policy,
    ...existing.policy,
    maxParallelWriteSteps: 1
  };
}

export function seedBuiltinWorkflowTeams(): void {
  logMain().info("workflowTeams", "seed builtins start", { pid: process.pid });
  const db = getDb();
  for (const id of removedBuiltinWorkflowTeamIds) {
    const row = db
      .prepare("SELECT id, source, roles_json FROM workflow_teams WHERE id = ?")
      .get(id) as any;
    db.prepare("DELETE FROM workflow_teams WHERE id = ? AND source = 'builtin'").run(id);
    if (row) {
      auditTeamWrite("seed-retire", id, row.roles_json ? JSON.parse(row.roles_json) : undefined, {
        source: row.source
      });
    }
  }

  const existing = listWorkflowTeams();
  const existingById = new Map(existing.map((t) => [t.id, t]));
  for (const team of builtinWorkflowTeams()) {
    const saved = existingById.get(team.id);
    if (!saved) {
      auditTeamWrite("seed-insert", team.id, team.roles, { reason: "missing" });
      insertWorkflowTeam(team);
      continue;
    }
    if (saved.source !== "builtin") continue;
    const mergedRoles = mergeBuiltinRoles(saved, team);
    auditTeamWrite("seed-merge", team.id, mergedRoles, {
      savedSkillCounts: saved.roles.map((r) => ({ id: r.id, n: r.skillIds?.length ?? 0 }))
    });
    updateWorkflowTeam(team.id, {
      name: team.name,
      description: team.description,
      icon: team.icon,
      enabled: saved.enabled,
      roles: mergeBuiltinRoles(saved, team),
      template: team.template,
      policy: mergeBuiltinPolicy(saved, team)
    });
  }
  logMain().info("workflowTeams", "seed builtins done", { pid: process.pid });
}
