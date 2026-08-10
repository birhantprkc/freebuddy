import { useState } from "react";
import { useTranslation } from "react-i18next";

export interface DelegationEventView {
  id: string;
  parentEventId: string | null;
  agentName: string;
  roleLabel: string;
  taskText: string;
  depth: number;
  status: string;
  resultSummary: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

interface DelegationRunTreeProps {
  events: DelegationEventView[];
}

function statusBadgeClass(status: string): string {
  return `delegation-event-status ${status}`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString();
}

function formatRange(startedAt: string | null, endedAt: string | null): string {
  const start = formatTime(startedAt);
  if (!start) return "";
  const end = endedAt ? formatTime(endedAt) : "";
  return end ? `${start} → ${end}` : start;
}

function durationLabel(startedAt: string | null, endedAt: string | null): string | null {
  if (!startedAt || !endedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 100) / 10;
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec - min * 60);
  return `${min}m${rem}s`;
}

function DelegationEventRow({ event }: { event: DelegationEventView }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const hasDetails = Boolean(event.resultSummary || event.taskText.length > 120);
  const duration = durationLabel(event.startedAt, event.endedAt);
  const timing = formatRange(event.startedAt, event.endedAt);
  const running = event.status === "running";

  return (
    <div
      className={`delegation-event-row${running ? " live" : ""}`}
      style={{ paddingLeft: `${event.depth * 18 + 12}px` }}
    >
      <div className="delegation-event-head">
        <span className="delegation-event-agent">{event.agentName}</span>
        <span className="delegation-event-role">{event.roleLabel}</span>
        <span className={statusBadgeClass(event.status)}>
          {event.status}
        </span>
        {duration && <span className="delegation-event-duration">{duration}</span>}
        {hasDetails && (
          <button
            type="button"
            className="delegation-event-toggle"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? t("workflow.delegation.hide") : t("workflow.delegation.details")}
          </button>
        )}
      </div>
      <div className="delegation-event-task">{event.taskText}</div>
      {expanded && event.resultSummary && (
        <div className="delegation-event-result">{event.resultSummary}</div>
      )}
      {timing && <div className="delegation-event-timing">{timing}</div>}
    </div>
  );
}

export function DelegationRunTree({ events }: DelegationRunTreeProps) {
  const { t } = useTranslation();
  if (events.length === 0) {
    return <div className="delegation-run-tree-empty">{t("workflow.delegation.noActivity")}</div>;
  }
  // Events arrive ordered by started_at ASC (parent before children). Indent by
  // the row's own depth field, which the runtime sets when inserting each event.
  const ordered = [...events].sort((a, b) => {
    const ta = a.startedAt ?? "";
    const tb = b.startedAt ?? "";
    return ta.localeCompare(tb);
  });
  return (
    <div className="delegation-run-tree" role="tree">
      {ordered.map((event) => (
        <DelegationEventRow key={event.id} event={event} />
      ))}
    </div>
  );
}
