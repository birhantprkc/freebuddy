import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { delegationClient } from "@/services/delegation/client";
import type { DelegationTeam } from "@/services/workflowTeams/types";
import { useConversationStore } from "@/store/conversationStore";

/**
 * Shown in the third column (DetailColumn) for a delegation conversation.
 * Loads the team linked to the conversation's delegation run and renders a
 * compact roster card (role / agent / read-write / capability / entry marker).
 * Renders nothing for non-delegation conversations.
 */
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
    <div className="delegation-team-card">
      <div className="delegation-team-card-title">
        {t("workflow.delegation.teamTitle", { defaultValue: "团队" })}：{team.name}
      </div>
      <div className="delegation-team-roster">
        {team.roster.map((r) => (
          <div key={r.id} className="delegation-team-member">
            <div className="delegation-team-member-head">
              <span className="delegation-team-member-label">{r.label}</span>
              {r.id === team.entryRoleId && (
                <span className="delegation-team-member-entry">
                  {t("workflow.delegation.entry", { defaultValue: "入口" })}
                </span>
              )}
              <span
                className={`delegation-team-member-flag${r.canWrite ? " w" : " ro"}`}
              >
                {r.canWrite
                  ? t("workflow.delegation.canWrite")
                  : t("workflow.delegation.readonly", { defaultValue: "只读" })}
              </span>
            </div>
            <div className="delegation-team-member-agent">{memberName(r.agentId)}</div>
            <div className="delegation-team-member-cap">{r.capability}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
