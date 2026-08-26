import type { TFunction } from "i18next";
import type {
  WorkflowTeam,
  WorkflowTeamPreview,
  WorkflowTeamRole,
  WorkflowTeamRoleKind,
  WorkflowTemplateNode,
  WorkflowTemplateNodeMode
} from "@freebuddy/protocol/workflow";
import type { DelegationTeam } from "@freebuddy/protocol/delegation";

export type {
  WorkflowEdgeCondition,
  WorkflowNodeContract,
  WorkflowTeam,
  WorkflowTeamPolicy,
  WorkflowTeamPreview,
  WorkflowTeamRole,
  WorkflowTeamRoleKind,
  WorkflowTemplate2,
  WorkflowTemplateEdge,
  WorkflowTemplateNode,
  WorkflowTemplateNodeGate,
  WorkflowTemplateNodeMode
} from "@freebuddy/protocol/workflow";

export type {
  DelegationPolicy,
  DelegationRosterEntry,
  DelegationTeam
} from "@freebuddy/protocol/delegation";

export type AnyTeam = WorkflowTeam | DelegationTeam;

export function isDelegationTeam(t: AnyTeam): t is DelegationTeam {
  return (t as DelegationTeam).kind === "delegation";
}

export function workflowTeamName(team: WorkflowTeam, t: TFunction): string {
  return team.source === "builtin"
    ? t(`workflow.builtinTeams.${team.id}.name`, { defaultValue: team.name })
    : team.name;
}

export function workflowTeamDescription(
  team: WorkflowTeam,
  t: TFunction
): string | undefined {
  if (team.source !== "builtin") return team.description;
  return t(`workflow.builtinTeams.${team.id}.description`, {
    defaultValue: team.description ?? ""
  });
}

export function workflowTeamRoleLabel(
  team: WorkflowTeam,
  role: WorkflowTeamRole,
  t: TFunction
): string {
  if (team.source !== "builtin") return role.label;
  return t(`workflow.builtinTeams.${team.id}.roles.${role.id}`, {
    defaultValue: t(`workflow.roleKinds.${role.kind}`, {
      defaultValue: role.label
    })
  });
}

export function workflowTeamNodeTitle(
  team: WorkflowTeam,
  node: WorkflowTemplateNode,
  t: TFunction
): string {
  if (team.source !== "builtin") return node.title;
  return t(`workflow.builtinTeams.${team.id}.nodes.${node.id}`, {
    defaultValue: node.title
  });
}

export function workflowTeamNodeMode(
  mode: WorkflowTemplateNodeMode,
  t: TFunction
): string {
  return t(`workflow.nodeModes.${mode}`, { defaultValue: mode });
}

export function workflowTeamRoleKind(
  kind: WorkflowTeamRoleKind,
  t: TFunction
): string {
  return t(`workflow.roleKinds.${kind}`, { defaultValue: kind });
}

export function workflowTeamPreviewName(
  preview: WorkflowTeamPreview,
  t: TFunction
): string {
  return t(`workflow.builtinTeams.${preview.teamId}.name`, {
    defaultValue: preview.teamName
  });
}
