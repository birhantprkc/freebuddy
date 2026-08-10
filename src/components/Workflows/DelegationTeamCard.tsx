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
    <div className="delegation-roster-stack">
      {team.roster.map((r) => {
        const isEntry = r.id === team.entryRoleId;
        const badge = [
          r.canWrite ? t("workflow.delegation.canWrite") : t("workflow.delegation.readonly", { defaultValue: "只读" }),
          isEntry ? t("workflow.delegation.entry", { defaultValue: "入口" }) : ""
        ].filter(Boolean).join(" · ");
        return (
          <section key={r.id} className="side-card">
            <div className="side-card-header">
              <span>{r.label}</span>
              <strong>{badge}</strong>
            </div>
            <div className="agent-lockup">
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
                <strong>{memberName(r.agentId)}</strong>
                <small className="muted">
                  {r.model ? `${r.model} · ` : ""}
                  {r.capability}
                </small>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
