import { BrowserWindow } from "electron";
import { getDb } from "./db.js";
import { safeSendToWebContents } from "./ipcSend.js";
import type {
  DelegationPolicy,
  DelegationRosterEntry,
  DelegationTeam
} from "./delegationTeamTypes.js";
import { defaultDelegationPolicy } from "./delegationTeamTypes.js";

function notifyDelegationTeamsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    safeSendToWebContents(win.webContents, "delegationTeams://changed", undefined);
  }
}

function rowToDelegationTeam(r: any): DelegationTeam {
  const meta = r.delegation_meta_json ? JSON.parse(r.delegation_meta_json) : {};
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    icon: r.icon ?? undefined,
    enabled: r.enabled === 1 || r.enabled === true,
    source: (r.source as "builtin" | "user") ?? "user",
    kind: "delegation",
    entryRoleId: meta.entryRoleId ?? "",
    roster: JSON.parse(r.roles_json) as DelegationRosterEntry[],
    policy: {
      ...defaultDelegationPolicy(),
      ...(JSON.parse(r.policy_json) as Partial<DelegationPolicy>)
    },
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

export function listDelegationTeams(): DelegationTeam[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM workflow_teams WHERE kind = 'delegation' ORDER BY source DESC, created_at ASC"
    )
    .all() as any[];
  return rows.map(rowToDelegationTeam);
}

export function getDelegationTeam(id: string): DelegationTeam | undefined {
  const row = getDb()
    .prepare("SELECT * FROM workflow_teams WHERE id = ? AND kind = 'delegation'")
    .get(id) as any;
  return row ? rowToDelegationTeam(row) : undefined;
}

export interface UpsertDelegationTeamInput {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  enabled: boolean;
  source: "builtin" | "user";
  entryRoleId: string;
  roster: DelegationRosterEntry[];
  policy: DelegationPolicy;
}

export function insertDelegationTeam(
  input: UpsertDelegationTeamInput
): DelegationTeam {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO workflow_teams
         (id, name, description, icon, enabled, source, kind,
          roles_json, template_json, policy_json, delegation_meta_json,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'delegation', ?, '{}', ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.name,
      input.description ?? null,
      input.icon ?? null,
      input.enabled ? 1 : 0,
      input.source,
      JSON.stringify(input.roster),
      JSON.stringify(input.policy),
      JSON.stringify({ entryRoleId: input.entryRoleId }),
      now,
      now
    );
  const created = getDelegationTeam(input.id) as DelegationTeam;
  notifyDelegationTeamsChanged();
  return created;
}

export interface UpdateDelegationTeamPatch {
  name?: string;
  description?: string | null;
  icon?: string | null;
  enabled?: boolean;
  entryRoleId?: string;
  roster?: DelegationRosterEntry[];
  policy?: DelegationPolicy;
}

export function updateDelegationTeam(
  id: string,
  patch: UpdateDelegationTeamPatch
): DelegationTeam | undefined {
  const existing = getDelegationTeam(id);
  if (!existing) return undefined;

  const fields: string[] = ["updated_at = ?"];
  const params: any[] = [new Date().toISOString()];
  if (patch.name !== undefined) { fields.push("name = ?"); params.push(patch.name); }
  if (patch.description !== undefined) { fields.push("description = ?"); params.push(patch.description); }
  if (patch.icon !== undefined) { fields.push("icon = ?"); params.push(patch.icon); }
  if (patch.enabled !== undefined) { fields.push("enabled = ?"); params.push(patch.enabled ? 1 : 0); }
  if (patch.roster !== undefined) { fields.push("roles_json = ?"); params.push(JSON.stringify(patch.roster)); }
  if (patch.policy !== undefined) { fields.push("policy_json = ?"); params.push(JSON.stringify(patch.policy)); }
  if (patch.entryRoleId !== undefined) {
    fields.push("delegation_meta_json = ?");
    params.push(JSON.stringify({ entryRoleId: patch.entryRoleId }));
  }
  params.push(id);
  getDb()
    .prepare(
      `UPDATE workflow_teams SET ${fields.join(", ")} WHERE id = ? AND kind = 'delegation'`
    )
    .run(...params);
  const updated = getDelegationTeam(id);
  notifyDelegationTeamsChanged();
  return updated;
}

export function deleteDelegationTeam(id: string): boolean {
  const team = getDelegationTeam(id);
  if (!team) return false;
  if (team.source === "builtin") return false;
  getDb().prepare("DELETE FROM workflow_teams WHERE id = ? AND kind = 'delegation'").run(id);
  notifyDelegationTeamsChanged();
  return true;
}
