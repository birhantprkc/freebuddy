import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

async function loadStateModule() {
  const source = fs.readFileSync(
    new URL("../electron/butlerBuddyState.ts", import.meta.url),
    "utf8"
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
  );
}

function localTime(hour, minute = 0) {
  return new Date(2026, 7, 9, hour, minute, 0, 0).getTime();
}

function createFakeClock(startAt) {
  let current = startAt;
  let nextHandle = 1;
  let scheduleCalls = 0;
  const timers = new Map();

  const api = {
    now: () => current,
    schedule(callback, delayMs) {
      const handle = nextHandle;
      nextHandle += 1;
      scheduleCalls += 1;
      timers.set(handle, { at: current + delayMs, callback });
      return handle;
    },
    cancel(handle) {
      timers.delete(handle);
    },
    advanceBy(ms) {
      const target = current + ms;
      while (true) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [handle, timer] = next;
        timers.delete(handle);
        current = timer.at;
        timer.callback();
      }
      current = target;
    },
    pendingCount: () => timers.size,
    scheduleCallCount: () => scheduleCalls
  };

  return api;
}

test("pet state priority is transient, working, sleeping, then idle", async () => {
  const { resolveButlerBuddyVisualState } = await loadStateModule();
  const noon = localTime(12);
  const night = localTime(1);

  const cases = [
    {
      name: "defaults to idle during the day",
      context: { streaming: false, transient: null },
      at: noon,
      expected: "idle"
    },
    {
      name: "sleeps from midnight until seven",
      context: { streaming: false, transient: null },
      at: night,
      expected: "sleeping"
    },
    {
      name: "working overrides sleep",
      context: { streaming: true, transient: null },
      at: night,
      expected: "working"
    },
    {
      name: "celebration overrides working",
      context: {
        streaming: true,
        transient: { visualState: "celebrating", until: night + 4_000 }
      },
      at: night,
      expected: "celebrating"
    },
    {
      name: "comfort overrides sleep",
      context: {
        streaming: false,
        transient: { visualState: "comforting", until: night + 4_000 }
      },
      at: night,
      expected: "comforting"
    }
  ];

  for (const example of cases) {
    assert.equal(
      resolveButlerBuddyVisualState(example.context, example.at),
      example.expected,
      example.name
    );
  }
});

test("sleep boundary scheduling targets seven in the morning or next midnight", async () => {
  const { millisecondsUntilNextButlerBuddySleepBoundary } =
    await loadStateModule();

  assert.equal(
    millisecondsUntilNextButlerBuddySleepBoundary(localTime(6, 59)),
    60_000
  );
  assert.equal(
    millisecondsUntilNextButlerBuddySleepBoundary(localTime(12)),
    12 * 60 * 60 * 1_000
  );
  assert.equal(
    millisecondsUntilNextButlerBuddySleepBoundary(localTime(23, 59)),
    60_000
  );
});

test("task text is normalized and bounded before it reaches the pet", async () => {
  const { normalizeButlerBuddyTaskText } = await loadStateModule();

  assert.equal(
    normalizeButlerBuddyTaskText("  修复登录页\n  的按钮状态  "),
    "修复登录页 的按钮状态"
  );
  assert.equal(normalizeButlerBuddyTaskText(" \n\t "), undefined);
  assert.equal(normalizeButlerBuddyTaskText(42), undefined);
  assert.equal(
    normalizeButlerBuddyTaskText("一".repeat(100))?.length,
    80
  );
});

test("the pure reducer expires transients into the current underlying state", async () => {
  const { reduceButlerBuddyState } = await loadStateModule();
  const now = localTime(12);
  const initial = { streaming: false, transient: null };

  const success = reduceButlerBuddyState(
    initial,
    { type: "task-result", result: "success" },
    now
  );
  assert.equal(success.accepted, true);
  assert.deepEqual(success.context, {
    streaming: false,
    transient: { visualState: "celebrating", until: now + 4_000 }
  });

  const working = reduceButlerBuddyState(
    success.context,
    { type: "streaming-changed", streaming: true },
    now + 1_000
  );
  assert.equal(working.accepted, true);
  assert.equal(working.context.streaming, true);
  assert.deepEqual(working.context.transient, success.context.transient);

  const expired = reduceButlerBuddyState(
    working.context,
    { type: "clock-tick" },
    now + 4_000
  );
  assert.equal(expired.accepted, true);
  assert.deepEqual(expired.context, { streaming: true, transient: null });
});

test("failure comforts at night, then returns to sleeping", async () => {
  const {
    createButlerBuddyStateCoordinator,
    BUTLER_BUDDY_TRANSIENT_DURATION_MS
  } = await loadStateModule();
  const clock = createFakeClock(localTime(1));
  const coordinator = createButlerBuddyStateCoordinator(clock);

  assert.equal(coordinator.getState().visualState, "sleeping");
  coordinator.reportTaskResult("failure");
  assert.equal(coordinator.getState().visualState, "comforting");
  clock.advanceBy(BUTLER_BUDDY_TRANSIENT_DURATION_MS);
  assert.equal(coordinator.getState().visualState, "sleeping");
});

test("coordinator emits only changed snapshots and owns one expiry timer", async () => {
  const {
    createButlerBuddyStateCoordinator,
    BUTLER_BUDDY_TRANSIENT_DURATION_MS
  } = await loadStateModule();
  const clock = createFakeClock(localTime(12));
  const coordinator = createButlerBuddyStateCoordinator(clock);
  const emitted = [];
  coordinator.subscribe((state) => emitted.push(state));

  coordinator.setStreaming(true);
  assert.equal(coordinator.getState().visualState, "working");
  assert.equal(emitted.length, 1);

  coordinator.setStreaming(true);
  coordinator.refresh();
  assert.equal(emitted.length, 1, "identical inputs do not emit");
  assert.equal(clock.pendingCount(), 0);

  coordinator.reportTaskResult("success");
  assert.equal(coordinator.getState().visualState, "celebrating");
  assert.equal(clock.pendingCount(), 1);
  assert.equal(clock.scheduleCallCount(), 1);
  assert.equal(emitted.length, 2);

  coordinator.setStreaming(true);
  coordinator.refresh();
  assert.equal(emitted.length, 2, "underlying changes do not duplicate a transient");
  assert.equal(clock.pendingCount(), 1);
  assert.equal(clock.scheduleCallCount(), 1, "refresh does not restart the timer");

  clock.advanceBy(BUTLER_BUDDY_TRANSIENT_DURATION_MS - 1);
  assert.equal(coordinator.getState().visualState, "celebrating");
  clock.advanceBy(1);
  assert.equal(coordinator.getState().visualState, "working");
  assert.equal(coordinator.getState().transientUntil, undefined);
  assert.equal(emitted.length, 3);
});

test("killed and stopped results are neutral", async () => {
  const { reduceButlerBuddyState } = await loadStateModule();
  const now = localTime(12);
  const context = { streaming: true, transient: null };

  for (const result of ["killed", "stopped"]) {
    const reduced = reduceButlerBuddyState(
      context,
      { type: "task-result", result },
      now
    );
    assert.equal(reduced.accepted, true);
    assert.strictEqual(reduced.context, context);
  }
});

test("malformed events are rejected without replacing the last valid state", async () => {
  const { reduceButlerBuddyState } = await loadStateModule();
  const now = localTime(12);
  const context = {
    streaming: false,
    transient: { visualState: "celebrating", until: now + 4_000 }
  };
  const invalidEvents = [
    null,
    "success",
    { type: "streaming-changed", streaming: "yes" },
    { type: "task-result", result: "timeout" },
    { type: "clock-tick", metadata: "unexpected" },
    { type: "unknown" }
  ];

  for (const event of invalidEvents) {
    const reduced = reduceButlerBuddyState(context, event, now + 5_000);
    assert.equal(reduced.accepted, false);
    assert.strictEqual(reduced.context, context);
  }
});
