import { useTranslation } from "react-i18next";

import type { DelegationTeam } from "@/services/workflowTeams/types";

function timeoutMinutes(ms: number): number {
  return Math.max(1, Math.round(ms / 60000));
}

export function DelegationTeamPreviewCard({
  team,
  goal,
  onRun,
  onCancel
}: {
  team: DelegationTeam;
  goal: string;
  onRun: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const entry = team.roster.find((r) => r.id === team.entryRoleId);

  return (
    <section className="workflow-team-preview-card">
      <header className="workflow-team-preview-header">
        <strong>{team.name}</strong>
        <span className="muted small">
          {t("workflow.delegation.kindBadge")}
        </span>
      </header>
      <p className="workflow-plan-goal">{goal}</p>

      <div className="workflow-team-preview-roles">
        <strong>{t("workflow.delegation.entryAgent")}</strong>
        <p className="muted small">
          {entry ? `${entry.label} → ${entry.capability}` : "—"}
        </p>
      </div>

      <div className="workflow-team-preview-roles">
        <strong>{t("workflow.delegation.roster")}</strong>
        <ul className="muted small">
          {team.roster.map((r) => (
            <li key={r.id}>
              {r.label} → {r.capability}
              {r.canWrite ? ` · ${t("workflow.delegation.canWrite")}` : ""}
            </li>
          ))}
        </ul>
      </div>

      <dl className="workflow-team-preview-stats">
        <div>
          <dt>{t("workflow.delegation.maxDepth")}</dt>
          <dd>{team.policy.maxDepth}</dd>
        </div>
        <div>
          <dt>{t("workflow.delegation.timeoutMin")}</dt>
          <dd>{timeoutMinutes(team.policy.delegateTimeoutMs)}</dd>
        </div>
        <div>
          <dt>{t("workflow.delegation.writeApproval")}</dt>
          <dd>
            {team.policy.requireApprovalBeforeDelegateWrite
              ? t("workflow.allowed")
              : t("workflow.denied")}
          </dd>
        </div>
      </dl>

      <div className="workflow-team-preview-actions">
        <button type="button" className="primary" onClick={onRun}>
          {t("workflow.run")}
        </button>
        <button type="button" onClick={onCancel}>
          {t("workflow.cancel")}
        </button>
      </div>
    </section>
  );
}
