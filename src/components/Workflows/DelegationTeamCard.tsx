import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { delegationClient } from "@/services/delegation/client";
import { cliClient } from "@/services/cli/client";
import type { DelegationTeam } from "@/services/workflowTeams/types";
import { useConversationStore } from "@/store/conversationStore";
import { AgentAvatar } from "../CLI/AgentAvatar";

const POLL_MS = 1500;

function PauseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="7" y="5" width="3" height="14" rx="1" />
      <rect x="14" y="5" width="3" height="14" rx="1" />
    </svg>
  );
}

function ResumeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="7 4 19 12 7 20 7 4" fill="currentColor" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  );
}

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
  const [runStatus, setRunStatus] = useState<string | undefined>(undefined);
  const [runId, setRunId] = useState<string | undefined>(undefined);
  const [modelsByAgent, setModelsByAgent] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

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
          if (!cancelled) {
            setTeam(undefined);
            setActiveAgentId(undefined);
            setRunStatus(undefined);
            setRunId(undefined);
          }
          return;
        }
        if (!cancelled) {
          setRunStatus(run.status);
          setRunId(run.id);
        }
        if (!team) {
          const loaded = await delegationClient.get(run.teamId);
          if (!cancelled) setTeam(loaded ?? undefined);
        }

        // Determine the active agent from run + events (bus is source of truth):
        // 1. Child event (depth>0) "running" → that child
        // 2. Else if run is running/blocked → entry is active (turning or parked)
        const events = await delegationClient.listEvents(run.id);
        if (cancelled) return;
        const runningChild = events.find(
          (e: any) => e.status === "running" && e.depth > 0
        ) as { agentId?: string } | undefined;
        if (runningChild?.agentId) {
          setActiveAgentId(runningChild.agentId);
        } else {
          const runLive = run.status === "running" || run.status === "blocked";
          const isLive =
            runLive || liveStatus === "running" || liveStatus === "starting";
          const entry = team?.roster.find((r) => r.id === team.entryRoleId) ?? team?.roster[0];
          setActiveAgentId(isLive && entry ? entry.agentId : undefined);
        }
      } catch {
        if (!cancelled) {
          setActiveAgentId(undefined);
          setRunStatus(undefined);
        }
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

  const runBadge =
    runStatus === "running"
      ? t("status.running")
      : runStatus === "paused"
        ? t("workflow.status.paused", { defaultValue: "paused" })
        : runStatus === "blocked"
          ? t("status.blocked", { defaultValue: "blocked" })
          : runStatus === "completed"
            ? t("status.done", { defaultValue: "done" })
            : runStatus === "failed" || runStatus === "killed"
              ? t("status.failed", { defaultValue: runStatus })
              : "";

  const onPause = async () => {
    if (!runId || busy) return;
    setBusy(true);
    try {
      await delegationClient.pauseRun(runId);
      setRunStatus("paused");
    } finally {
      setBusy(false);
    }
  };

  const onResume = async () => {
    if (!runId || busy) return;
    setBusy(true);
    try {
      await delegationClient.resumeRun(runId);
      setRunStatus("running");
    } finally {
      setBusy(false);
    }
  };

  const onStop = async () => {
    if (!runId || busy) return;
    setBusy(true);
    try {
      await delegationClient.stopRun(runId);
      setRunStatus("killed");
    } finally {
      setBusy(false);
    }
  };

  const showRunControls =
    Boolean(runId) &&
    (runStatus === "running" || runStatus === "blocked" || runStatus === "paused");

  return (
    <div className="delegation-roster-stack">
      {showRunControls ? (
        <div className="delegation-run-toolbar">
          {runBadge ? (
            <span className={`workflow-run-status ${runStatus ?? ""}`}>{runBadge}</span>
          ) : (
            <span />
          )}
          <div className="delegation-run-actions">
            {runStatus === "running" || runStatus === "blocked" ? (
              <button type="button" disabled={busy} onClick={() => void onPause()}>
                <PauseIcon /> {t("workflow.pause")}
              </button>
            ) : null}
            {runStatus === "paused" ? (
              <button type="button" disabled={busy} onClick={() => void onResume()}>
                <ResumeIcon /> {t("workflow.resume")}
              </button>
            ) : null}
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() => void onStop()}
            >
              <StopIcon /> {t("workflow.stop")}
            </button>
          </div>
        </div>
      ) : null}
      {team.roster.map((r) => {
        const isEntry = r.id === team.entryRoleId;
        const isActive = activeAgentId === r.agentId;
        // Entry is parked when the run is live but a child agent owns the active slot.
        const parkedEntry =
          isEntry && runStatus === "running" && Boolean(activeAgentId) && !isActive;
        const badge = isActive
          ? t("status.running")
          : parkedEntry
            ? t("workflow.delegation.parked", { defaultValue: "parked" })
            : isEntry
              ? t("workflow.delegation.entry", { defaultValue: "entry" })
              : "";
        const rwLabel = r.canWrite
          ? t("workflow.delegation.canWrite")
          : t("workflow.delegation.readonly", { defaultValue: "read-only" });

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
