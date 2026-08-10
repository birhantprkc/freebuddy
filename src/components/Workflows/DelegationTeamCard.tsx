import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { delegationClient } from "@/services/delegation/client";
import type { DelegationTeam } from "@/services/workflowTeams/types";
import { useConversationStore } from "@/store/conversationStore";
import { AgentAvatar } from "../CLI/AgentAvatar";

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
  const memberAdapter = (agentId: string): string | undefined =>
    members.find((m) => m.id === agentId)?.cli.adapter;

  return (
    <section className="side-card delegation-roster-card">
      <div className="side-card-header">
        <span>{team.name}</span>
        <strong>{team.roster.length}</strong>
      </div>
      <div className="delegation-roster-body">
        {team.roster.map((r) => {
          const isEntry = r.id === team.entryRoleId;
          return (
            <div key={r.id} className="agent-lockup delegation-roster-member">
              <AgentAvatar
                adapter={memberAdapter(r.agentId)}
                agentId={r.agentId}
                className="agent-avatar"
                fallback={
                  <div className="agent-avatar" style={{ background: "rgba(128,128,128,0.2)" }}>
                    <span>{r.label.slice(0, 2).toUpperCase()}</span>
                  </div>
                }
              />
              <div>
                <strong>
                  {r.label}
                  {isEntry && (
                    <span className="delegation-roster-tag entry" style={{ marginLeft: 6 }}>
                      {t("workflow.delegation.entry", { defaultValue: "入口" })}
                    </span>
                  )}
                </strong>
                <small className="muted">
                  {memberName(r.agentId)}
                  <span
                    className={`delegation-roster-tag${r.canWrite ? " w" : " ro"}`}
                    style={{ marginLeft: 6 }}
                  >
                    {r.canWrite
                      ? t("workflow.delegation.canWrite")
                      : t("workflow.delegation.readonly", { defaultValue: "只读" })}
                  </span>
                </small>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
