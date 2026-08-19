import test from "node:test";
import assert from "node:assert/strict";

import {
  filterJsonlLinesByTimestamp,
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
