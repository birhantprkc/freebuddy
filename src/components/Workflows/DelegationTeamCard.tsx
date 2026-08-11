import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { delegationClient } from "@/services/delegation/client";
import { cliClient } from "@/services/cli/client";
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
  const liveStatus = useConversationStore((s) => s.live[conversationId]?.status);
  const [team, setTeam] = useState<DelegationTeam | undefined>(undefined);
  const [activeAgentId, setActiveAgentId] = useState<string | undefined>(undefined);
  const [modelsByAgent, setModelsByAgent] = useState<Record<string, string>>({});

  // Extract model per agent from the conversation's streamed config-options
  // items — same mechanism as WorkspacePanel's sessionConfigSummary.
  useEffect(() => {
    if (!team) return;
    let cancelled = false;
    (async () => {
      try {
        const messages = await cliClient.listMessages(conversationId);
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const msg of messages) {
          if (msg.role !== "assistant" || !msg.agentId) continue;
          try {
            const items = JSON.parse(msg.content);
            if (!Array.isArray(items)) continue;
            for (const item of items) {
              if (item.kind === "config-options" && Array.isArray(item.options)) {
                const modelOpt = item.options.find((o: any) => o.id === "model");
                if (modelOpt?.currentLabel || modelOpt?.currentValue) {
                  map[msg.agentId] = modelOpt.currentLabel ?? modelOpt.currentValue;
                }
              }
            }
          } catch {}
        }
        for (const r of team.roster) {
          if (r.model && !map[r.agentId]) map[r.agentId] = r.model;
        }
        if (!cancelled) setModelsByAgent(map);
      } catch {
        if (!cancelled) setModelsByAgent({});
      }
    })();
    return () => { cancelled = true; };
  }, [team, conversationId]);

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
        if (!team) {
          const loaded = await delegationClient.get(run.teamId);
          if (!cancelled) setTeam(loaded ?? undefined);
        }

        // Determine the active agent:
        // 1. If a child event (depth>0) is "running" → that child is active
        // 2. Else if the conversation is live → the entry agent is active
        const events = await delegationClient.listEvents(run.id);
        if (cancelled) return;
        const runningChild = events.find(
          (e: any) => e.status === "running" && e.depth > 0
        ) as { agentId?: string } | undefined;
        if (runningChild?.agentId) {
          setActiveAgentId(runningChild.agentId);
        } else {
          const isLive = liveStatus === "running" || liveStatus === "starting";
          const entry = team?.roster.find((r) => r.id === team.entryRoleId) ?? team?.roster[0];
          setActiveAgentId(isLive && entry ? entry.agentId : undefined);
        }
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
  }, [conversationId, liveStatus, team]);

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
            className={`side-card${isActive ? " delegation-roster-active" : ""}`}
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
                  {modelsByAgent[r.agentId] ? `${modelsByAgent[r.agentId]} · ` : ""}
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
