import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { delegationClient } from "@/services/delegation/client";
import type { DelegationTeam } from "@/services/workflowTeams/types";
import { useConversationStore } from "@/store/conversationStore";
import { AgentAvatar } from "../CLI/AgentAvatar";

const POLL_MS = 1500;

export function DelegationTeamCard({
  conversationId
}: {
  conversationId: string;
}) {
  const { t } = useTranslation();
  const members = useConversationStore((s) => s.members);
  const [team, setTeam] = useState<DelegationTeam | undefined>(undefined);
  const [activeAgentId, setActiveAgentId] = useState<string | undefined>(undefined);
  const [runStatus, setRunStatus] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const run = await delegationClient.getRunByConversation(conversationId);
        if (!run || !run.teamId) {
          if (!cancelled) { setTeam(undefined); setActiveAgentId(undefined); }
          return;
        }
        if (!cancelled) setRunStatus(run.status);
        if (!team) {
          const loaded = await delegationClient.get(run.teamId);
          if (!cancelled) setTeam(loaded ?? undefined);
        }
        const events = await delegationClient.listEvents(run.id);
        if (cancelled) return;
        const running = events.find((e: any) => e.status === "running") as { agentId?: string } | undefined;
        setActiveAgentId(running?.agentId);
      } catch {
        if (!cancelled) setActiveAgentId(undefined);
      }
    };

    const schedule = () => {
      timer = setTimeout(async () => {
        if (cancelled) return;
        await poll();
        schedule();
      }, POLL_MS);
    };

    void poll();
    schedule();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        const isActive = activeAgentId === r.agentId;
        const isDone = runStatus === "completed" || runStatus === "failed" || runStatus === "killed";
        const badge = isActive
          ? t("status.running")
          : isEntry
            ? t("workflow.delegation.entry", { defaultValue: "入口" })
            : "";
        const rwLabel = r.canWrite
          ? t("workflow.delegation.canWrite")
          : t("workflow.delegation.readonly", { defaultValue: "只读" });

        return (
          <section
            key={r.id}
            className={`side-card${isActive ? " delegation-roster-active" : ""}${isDone && !isActive ? " delegation-roster-done" : ""}`}
          >
            <div className="side-card-header">
              <span>{r.label}</span>
              <strong className={isActive ? "delegation-roster-status-running" : ""}>
                {badge ? `${badge} · ` : ""}{rwLabel}
              </strong>
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
