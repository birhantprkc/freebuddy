export interface TimestampRange {
  startMs: number;
  endMs: number;
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
