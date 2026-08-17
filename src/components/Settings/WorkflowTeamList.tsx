import { useTranslation } from "react-i18next";
import { Dropdown } from "antd";

import type { AnyTeam } from "@/services/workflowTeams/types";
import {
  isDelegationTeam,
  workflowTeamDescription,
  workflowTeamName
} from "@/services/workflowTeams/types";
import { useWorkflowTeamStore } from "@/store/workflowTeamStore";
import { useDelegationTeamStore } from "@/store/delegationStore";

export function WorkflowTeamList({
  teams,
  onNew,
  onNewDelegation,
  onEdit
}: {
  teams: AnyTeam[];
  onNew: () => void;
  onNewDelegation: () => void;
  onEdit: (team: AnyTeam) => void;
}) {
  const { t } = useTranslation();
  const wfUpdate = useWorkflowTeamStore((s) => s.update);
  const wfRemove = useWorkflowTeamStore((s) => s.remove);
  const delUpdate = useDelegationTeamStore((s) => s.update);
  const delRemove = useDelegationTeamStore((s) => s.remove);

  const toggleEnabled = (team: AnyTeam) => {
    if (isDelegationTeam(team)) {
      void delUpdate(team.id, { enabled: !team.enabled });
    } else {
      void wfUpdate(team.id, { enabled: !team.enabled });
    }
  };

  const removeTeam = (team: AnyTeam) => {
    if (isDelegationTeam(team)) {
      void delRemove(team.id);
    } else {
      void wfRemove(team.id);
    }
  };

  return (
    <div className="workflow-team-list">
      <div className="workflow-team-list-actions">
        <Dropdown
          menu={{
            items: [
              { key: "workflow", label: t("workflow.teamKindWorkflow", { defaultValue: "Workflow team" }) },
              { key: "delegation", label: t("workflow.delegation.teamKindDelegation", { defaultValue: "Self-organizing team" }) }
            ],
            onClick: ({ key }) =>
              key === "delegation" ? onNewDelegation() : onNew()
          }}
          trigger={["click"]}
        >
          <button type="button" className="primary">
            + {t("workflow.newTeam")} ▾
          </button>
        </Dropdown>
      </div>
      {teams.length === 0 ? (
        <p className="muted">{t("workflow.noTeams")}</p>
      ) : (
        <ul className="workflow-team-list-items">
          {teams.map((team) => {
            const name = isDelegationTeam(team)
              ? team.name
              : workflowTeamName(team, t);
            const description = isDelegationTeam(team)
              ? team.description
              : workflowTeamDescription(team, t);
            const memberCount = isDelegationTeam(team)
              ? team.roster.length
              : team.roles.length;
            return (
              <li key={team.id} className="workflow-team-card">
                <div className="workflow-team-card-main">
                  <div className="workflow-team-card-title">
                    <strong>{name}</strong>
                    {isDelegationTeam(team) && (
                      <span className="workflow-team-badge user">
                        {t("workflow.delegation.kindBadge")}
                      </span>
                    )}
                    <span
                      className={
                        team.source === "builtin"
                          ? "workflow-team-badge builtin"
                          : "workflow-team-badge user"
                      }
                    >
                      {team.source === "builtin"
                        ? t("workflow.builtinTeam")
                        : t("workflow.userTeam")}
                    </span>
                    {!team.enabled && (
                      <span className="workflow-team-badge muted">
                        {t("workflow.disableTeam")}
                      </span>
                    )}
                  </div>
                  {description && (
                    <p className="workflow-team-card-desc">{description}</p>
                  )}
                  <div className="workflow-team-card-meta">
                    <span>
                      {memberCount} {t("workflow.teamRoles").toLowerCase()}
                    </span>
                    <span>·</span>
                    {isDelegationTeam(team) ? (
                      <>
                        <span>
                          {t("workflow.delegation.maxDepth")}{" "}
                          {team.policy.maxDepth}
                        </span>
                        <span>·</span>
                        <span>
                          {team.policy.allowWrites
                            ? t("workflow.allowWrites")
                            : t("workflow.allowWrites") +
                              ": " +
                              t("workflow.denied")}
                        </span>
                      </>
                    ) : (
                      <>
                        <span>
                          {team.policy.allowWrites
                            ? t("workflow.allowWrites")
                            : t("workflow.allowWrites") +
                              ": " +
                              t("workflow.denied")}
                        </span>
                        <span>·</span>
                        <span>
                          {t("workflow.maxLoops")} {team.policy.maxLoops}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="workflow-team-card-actions">
                  <button type="button" onClick={() => onEdit(team)}>
                    {t("common.edit")}
                  </button>
                  <button type="button" onClick={() => toggleEnabled(team)}>
                    {team.enabled
                      ? t("workflow.disableTeam")
                      : t("workflow.enableTeam")}
                  </button>
                  {team.source === "user" && (
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        if (window.confirm(t("workflow.confirmDeleteTeam"))) {
                          removeTeam(team);
                        }
                      }}
                    >
                      {t("workflow.deleteTeam")}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
