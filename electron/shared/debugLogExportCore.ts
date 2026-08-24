export interface TimestampRange {
  startMs: number;
  endMs: number;
}

export interface SessionLogEntry {
  taskId: string;
  name: string;
  mtimeMs: number;
}

export interface SessionLogGroup<T extends SessionLogEntry = SessionLogEntry> {
  logicalSessionId: string;
  entries: T[];
}

/** Local calendar-day range. Constructing the next midnight also handles DST days. */
export function localDayRange(date: Date): TimestampRange {
  return {
    startMs: new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(),
    endMs: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
  };
}

/**
 * Keep only JSONL entries whose `ts` falls in the requested time range.
 * Malformed or timestamp-less lines fail closed so an export cannot leak an
 * older entry merely because its date cannot be established.
 */
export function filterJsonlLinesByTimestamp(
  lines: readonly string[],
  range: TimestampRange
): string[] {
  return lines.filter((line) => {
    if (!line.trim()) return false;
    try {
      const value = JSON.parse(line) as { ts?: unknown };
      if (typeof value.ts !== "string") return false;
      const timestampMs = Date.parse(value.ts);
      return (
        Number.isFinite(timestampMs) &&
        timestampMs >= range.startMs &&
        timestampMs < range.endMs
      );
    } catch {
      return false;
    }
  });
}

/**
 * Group per-turn task logs by the underlying resumable ACP session. Entries
 * inside a logical session are returned oldest-first so they can be merged
 * into one chronological transcript. The group limit preserves the exporter's
 * existing cap while no longer counting every turn as a separate session.
 */
export function groupSessionLogEntries<T extends SessionLogEntry>(
  entries: readonly T[],
  toolSessionIdByTask: ReadonlyMap<string, string>,
  maxGroups: number
): SessionLogGroup<T>[] {
  const groups = new Map<string, T[]>();
  const newestFirst = [...entries].sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const entry of newestFirst) {
    const logicalSessionId = toolSessionIdByTask.get(entry.taskId) || entry.taskId;
    const existing = groups.get(logicalSessionId);
    if (existing) {
      existing.push(entry);
      continue;
    }
    if (groups.size >= maxGroups) continue;
    groups.set(logicalSessionId, [entry]);
  }

  return [...groups.entries()].map(([logicalSessionId, groupedEntries]) => ({
    logicalSessionId,
    entries: groupedEntries.sort((a, b) => a.mtimeMs - b.mtimeMs)
  }));
}

interface HistoryReplayLine {
  replay: boolean;
  timestamp?: string;
  reportedItems?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function historyReplayLine(line: string): HistoryReplayLine {
  try {
    const outer = JSON.parse(line) as { ts?: unknown; type?: unknown; content?: unknown };
    if (outer.type !== "stdout" || typeof outer.content !== "string") {
      return { replay: false };
    }
    const payload = JSON.parse(outer.content) as unknown;
    if (!isRecord(payload)) return { replay: false };
    const params = isRecord(payload.params) ? payload.params : undefined;
    const update = isRecord(params?.update) ? params.update : undefined;
    const metas = [update?._meta, params?._meta, payload._meta].filter(isRecord);
    const replayMarker = metas
      .map((meta) => meta["codebuddy.ai/historyReplay"])
      .find((value) => value === "start" || value === "end");
    const historyMode = metas.some((meta) => {
      const codebuddyMeta = meta["codebuddy.ai"];
      return isRecord(codebuddyMeta) && codebuddyMeta.mode === "history";
    });
    const reportedItems = metas
      .map((meta) => meta["codebuddy.ai/historyReplayTotalItems"])
      .find((value) => typeof value === "number");
    return {
      replay: Boolean(replayMarker || historyMode),
      timestamp: typeof outer.ts === "string" ? outer.ts : undefined,
      reportedItems
    };
  } catch {
    return { replay: false };
  }
}

/**
 * ACP adapters may replay the complete prior transcript after every
 * session/load. Those events are useful to the live renderer but make an
 * exported conversation contain the same history once per turn. Collapse the
 * explicitly tagged replay protocol lines into one diagnostic marker while
 * preserving all live events and malformed/unrecognised lines verbatim.
 */
export function collapseAcpHistoryReplayLines(lines: readonly string[]): string[] {
  const out: string[] = [];
  let markerIndex = -1;
  let firstTimestamp: string | undefined;
  let reportedItems: number | undefined;
  let omitted = 0;

  for (const line of lines) {
    const info = historyReplayLine(line);
    if (!info.replay) {
      out.push(line);
      continue;
    }
    if (markerIndex < 0) markerIndex = out.length;
    firstTimestamp ??= info.timestamp;
    reportedItems ??= info.reportedItems;
    omitted += 1;
  }

  if (omitted === 0) return out;
  const reported = reportedItems === undefined
    ? ""
    : `; adapter reported ${reportedItems} replay items`;
  out.splice(
    markerIndex,
    0,
    JSON.stringify({
      ts: firstTimestamp ?? null,
      type: "system",
      content: `[export] omitted ${omitted} ACP history replay log lines${reported}`
    })
  );
  return out;
}
