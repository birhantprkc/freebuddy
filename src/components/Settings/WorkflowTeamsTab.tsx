import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useWorkflowTeamStore } from "@/store/workflowTeamStore";
import { workflowTeamsClient } from "@/services/workflowTeams/client";
import type { WorkflowTeam } from "@/services/workflowTeams/types";
import { WorkflowTeamList } from "./WorkflowTeamList";
import { WorkflowTeamEditor } from "./WorkflowTeamEditor";

export function WorkflowTeamsTab({
  initialTeamId,
  startCreating = false
}: {
  initialTeamId?: string;
  startCreating?: boolean;
}) {
  const { t } = useTranslation();
  const loaded = useWorkflowTeamStore((s) => s.loaded);
  const load = useWorkflowTeamStore((s) => s.load);
  const refresh = useWorkflowTeamStore((s) => s.refresh);
  const teams = useWorkflowTeamStore((s) => s.teams);
  const [editing, setEditing] = useState<WorkflowTeam | null>(null);
  const [creating, setCreating] = useState(startCreating);

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  useEffect(() => {
    const off = workflowTeamsClient.onChanged(() => {
      void refresh();
    });
    return () => {
      off?.();
    };
  }, [refresh]);

  useEffect(() => {
    if (startCreating || !initialTeamId) return;
    const team = teams.find((entry) => entry.id === initialTeamId);
    if (team) {
      setCreating(false);
      setEditing(team);
    }
  }, [initialTeamId, startCreating, teams]);

  return (
    <div className="settings-tab">
      <div className="settings-section-heading">
        <h3 className="settings-section-title">{t("workflow.teamList")}</h3>
        <span className="settings-section-desc">
          {t("workflow.teamExecutionHint")}
        </span>
      </div>

      {editing || creating ? (
        <WorkflowTeamEditor
          team={editing ?? undefined}
          onSaved={() => {
            setEditing(null);
            setCreating(false);
          }}
          onCancel={() => {
            setEditing(null);
            setCreating(false);
          }}
        />
      ) : (
        <WorkflowTeamList
          teams={teams}
          onNew={() => setCreating(true)}
          onEdit={(t) => setEditing(t)}
        />
      )}
    </div>
  );
}
