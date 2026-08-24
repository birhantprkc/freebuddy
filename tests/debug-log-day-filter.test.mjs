import test from "node:test";
import assert from "node:assert/strict";

import {
  collapseAcpHistoryReplayLines,
  filterJsonlLinesByTimestamp,
  groupSessionLogEntries,
  localDayRange
} from "../dist-electron/shared/debugLogExportCore.js";

test("debug log export keeps only app-log lines inside the local-day range", () => {
  const range = {
    startMs: Date.parse("2026-08-18T16:00:00.000Z"),
    endMs: Date.parse("2026-08-19T16:00:00.000Z")
  };
  const previousDay = JSON.stringify({ ts: "2026-08-18T23:59:59.999+08:00", msg: "old" });
  const morning = JSON.stringify({ ts: "2026-08-19T00:00:00.000+08:00", msg: "morning" });
  const rendererUtc = JSON.stringify({ ts: "2026-08-19T11:30:00.000Z", msg: "renderer" });
  const nextDay = JSON.stringify({ ts: "2026-08-20T00:00:00.000+08:00", msg: "next" });

  assert.deepEqual(
    filterJsonlLinesByTimestamp(
      [previousDay, morning, rendererUtc, nextDay, "not-json", JSON.stringify({ msg: "no ts" })],
      range
    ),
    [morning, rendererUtc]
  );
});

test("localDayRange spans from local midnight to the next local midnight", () => {
  const now = new Date(2026, 7, 19, 15, 30, 45);
  const range = localDayRange(now);
  const start = new Date(range.startMs);
  const end = new Date(range.endMs);

  assert.deepEqual(
    [start.getFullYear(), start.getMonth(), start.getDate(), start.getHours()],
    [2026, 7, 19, 0]
  );
  assert.deepEqual(
    [end.getFullYear(), end.getMonth(), end.getDate(), end.getHours()],
    [2026, 7, 20, 0]
  );
});

test("session logs are grouped by resumable ACP session and kept chronological", () => {
  const entries = [
    { taskId: "turn-1", name: "turn-1.jsonl", mtimeMs: 10 },
    { taskId: "turn-2", name: "turn-2.jsonl", mtimeMs: 30 },
    { taskId: "standalone", name: "standalone.jsonl", mtimeMs: 20 },
    { taskId: "old", name: "old.jsonl", mtimeMs: 5 }
  ];
  const groups = groupSessionLogEntries(
    entries,
    new Map([
      ["turn-1", "game-session"],
      ["turn-2", "game-session"]
    ]),
    2
  );

  assert.deepEqual(
    groups.map((group) => ({
      id: group.logicalSessionId,
      tasks: group.entries.map((entry) => entry.taskId)
    })),
    [
      { id: "game-session", tasks: ["turn-1", "turn-2"] },
      { id: "standalone", tasks: ["standalone"] }
    ]
  );
});

test("ACP history replay is collapsed without dropping live or malformed lines", () => {
  const acpLine = (meta, ts) => JSON.stringify({
    ts,
    type: "stdout",
    content: JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: { update: { _meta: meta } }
    })
  });
  const start = acpLine({
    "codebuddy.ai/historyReplay": "start",
    "codebuddy.ai/historyReplayTotalItems": 12
  }, "2026-08-24T01:00:00.000Z");
  const history = acpLine({ "codebuddy.ai": { mode: "history" } }, "2026-08-24T01:00:00.001Z");
  const end = acpLine({ "codebuddy.ai/historyReplay": "end" }, "2026-08-24T01:00:00.002Z");
  const live = acpLine({ "codebuddy.ai": { mode: "live" } }, "2026-08-24T01:00:01.000Z");

  const result = collapseAcpHistoryReplayLines(["not-json", start, history, end, live]);

  assert.equal(result.length, 3);
  assert.equal(result[0], "not-json");
  assert.match(result[1], /omitted 3 ACP history replay log lines/);
  assert.match(result[1], /adapter reported 12 replay items/);
  assert.equal(result[2], live);
});
