import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { delegationClient } from "@/services/delegation/client";
import { DelegationRunTree, type DelegationEventView } from "./DelegationRunTree";

interface DelegationRunView {
  id: string;
  goal: string;
  status: string;
  cwd: string | null;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
}

interface PendingApproval {
  approvalId: string;
  runId: string;
}

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "killed", "partial"]);
const POLL_INTERVAL_MS = 1500;

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

function asRun(row: unknown): DelegationRunView | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== "string") return null;
  return {
    id: r.id,
    goal: typeof r.goal === "string" ? r.goal : "",
    status: typeof r.status === "string" ? r.status : "running",
    cwd: typeof r.cwd === "string" ? r.cwd : null,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "",
    endedAt: typeof r.endedAt === "string" ? r.endedAt : null
  };
}

function asEvent(row: unknown): DelegationEventView | null {
  if (!row || typeof row !== "object") return null;
  const e = row as Record<string, unknown>;
  if (typeof e.id !== "string") return null;
  return {
    id: e.id,
    parentEventId: typeof e.parentEventId === "string" ? e.parentEventId : null,
    agentName: typeof e.agentName === "string" ? e.agentName : "",
    roleLabel: typeof e.roleLabel === "string" ? e.roleLabel : "",
    taskText: typeof e.taskText === "string" ? e.taskText : "",
    depth: typeof e.depth === "number" ? e.depth : 0,
    status: typeof e.status === "string" ? e.status : "pending",
    resultSummary: typeof e.resultSummary === "string" ? e.resultSummary : null,
    startedAt: typeof e.startedAt === "string" ? e.startedAt : null,
    endedAt: typeof e.endedAt === "string" ? e.endedAt : null
  };
}

interface DelegationRunPanelProps {
  runId: string;
}

export function DelegationRunPanel({ runId }: DelegationRunPanelProps) {
  const { t } = useTranslation();
  const [run, setRun] = useState<DelegationRunView | null>(null);
  const [events, setEvents] = useState<DelegationEventView[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [stopping, setStopping] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      try {
        const runRow = await delegationClient.getRun(runId);
        if (cancelled) return;
        const nextRun = asRun(runRow);
        const eventRows = await delegationClient.listEvents(runId);
        if (cancelled) return;
        setRun(nextRun);
        setEvents(eventRows.map(asEvent).filter((x): x is DelegationEventView => x !== null));
        setError(null);
        if (nextRun && nextRun.status === "blocked") {
          const pending = await delegationClient.listPendingApprovals(runId);
          if (cancelled) return;
          setPendingApprovals(pending);
        } else {
          setPendingApprovals([]);
        }
        if (nextRun && TERMINAL_RUN_STATUSES.has(nextRun.status)) {
          if (timer !== null) {
            window.clearInterval(timer);
            timer = null;
          }
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    void tick();
    timer = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
    };
  }, [runId]);

  const progress = useMemo(() => {
    const total = events.length;
    if (total === 0) return { done: 0, total: 0, percent: 0 };
    const done = events.filter((e) => e.status === "done").length;
    return { done, total, percent: Math.round((done / total) * 100) };
  }, [events]);

  const isLive = run ? !TERMINAL_RUN_STATUSES.has(run.status) : false;
  const blocked = run?.status === "blocked";
  const activeApproval = pendingApprovals[0];

  const onStop = async () => {
    if (!runId || stopping) return;
    setStopping(true);
    try {
      await delegationClient.stopRun(runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStopping(false);
    }
  };

  const onResolveApproval = async (approved: boolean) => {
    if (!activeApproval || resolving) return;
    setResolving(true);
    try {
      await delegationClient.approveWrite({
        runId,
        approvalId: activeApproval.approvalId,
        approved
      });
      setPendingApprovals([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResolving(false);
    }
  };

  if (!run) {
    return (
      <section className="side-card workflow-run-panel delegation-run-panel">
        <div className="workflow-run-header">
          <div className="workflow-run-title">
            <strong>Delegation run</strong>
          </div>
        </div>
        <div className="delegation-run-loading">
          {error ?? "Loading…"}
        </div>
      </section>
    );
  }

  const statusKey = `workflow.status.${run.status}`;

  return (
    <section className="side-card workflow-run-panel delegation-run-panel">
      <div className="workflow-run-header">
        <div className="workflow-run-title">
          <strong>{run.goal}</strong>
          <span className={`workflow-run-status ${run.status}`}>
            {t(statusKey)}
          </span>
        </div>
        {progress.total > 0 && (
          <div className="workflow-run-progress">
            <div className="workflow-progress-bar" aria-hidden="true">
              <div
                className="workflow-progress-fill"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <span className="workflow-progress-label">
              {progress.done}/{progress.total}
            </span>
          </div>
        )}
      </div>

      {error && <div className="delegation-run-error">{error}</div>}

      {isLive && (
        <div className="workflow-run-actions">
          <button
            type="button"
            className="danger"
            disabled={stopping}
            onClick={() => void onStop()}
          >
            <StopIcon /> {t("workflow.stop")}
          </button>
        </div>
      )}

      {blocked && (
        <div className="workflow-run-actions delegation-run-approval">
          <span className="delegation-run-approval-label">
            A teammate is requesting write access.
          </span>
          <button
            type="button"
            className="primary"
            disabled={!activeApproval || resolving}
            onClick={() => void onResolveApproval(true)}
          >
            Approve
          </button>
          <button
            type="button"
            className="danger"
            disabled={!activeApproval || resolving}
            onClick={() => void onResolveApproval(false)}
          >
            {t("permission.reject")}
          </button>
        </div>
      )}

      <DelegationRunTree events={events} />
    </section>
  );
}
