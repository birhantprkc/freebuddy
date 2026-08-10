import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { delegationClient } from "@/services/delegation/client";
import type { DelegationTeam } from "@/services/workflowTeams/types";
import { useConversationStore } from "@/store/conversationStore";

export function DelegationTeamCard({
  conversationId
}: {
  conversationId: string;
}) {
  const { t } = useTranslation();
  const members = useConversationStore((s) => s.members);
  const [team, setTeam] = useState<DelegationTeam | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const run = await delegationClient.getRunByConversation(conversationId);
        if (!run || !run.teamId) {
          if (!cancelled) setTeam(undefined);
          return;
        }
        const loaded = await delegationClient.get(run.teamId);
        if (!cancelled) setTeam(loaded ?? undefined);
      } catch {
        if (!cancelled) setTeam(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  if (!team) return null;

  const memberName = (agentId: string): string =>
    members.find((m) => m.id === agentId)?.name ?? agentId;

  return (
    <section className="side-card delegation-roster-card">
      <div className="side-card-header">
        <span>{t("workflow.delegation.teamTitle", { defaultValue: "团队" })}：{team.name}</span>
        <strong>{team.roster.length}</strong>
      </div>
      <div className="delegation-roster-body">
        {team.roster.map((r) => (
          <div key={r.id} className="delegation-roster-member">
            <div className="delegation-roster-member-head">
              <span className="delegation-roster-member-label">{r.label}</span>
              {r.id === team.entryRoleId && (
                <span className="delegation-roster-member-tag entry">
                  {t("workflow.delegation.entry", { defaultValue: "入口" })}
                </span>
              )}
              <span className={`delegation-roster-member-tag${r.canWrite ? " w" : " ro"}`}>
                {r.canWrite
                  ? t("workflow.delegation.canWrite")
                  : t("workflow.delegation.readonly", { defaultValue: "只读" })}
              </span>
            </div>
            <div className="delegation-roster-member-agent">{memberName(r.agentId)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
