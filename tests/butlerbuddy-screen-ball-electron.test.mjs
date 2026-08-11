import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

async function loadScreenBallModule() {
  const source = fs.readFileSync(
    new URL("../electron/butlerBuddyScreenBall.ts", import.meta.url),
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

test("screen-ball display snapshots preserve negative work-area coordinates", async () => {
  const { snapshotScreenBallDisplay, clampScreenBallBounds } =
    await loadScreenBallModule();
  const display = snapshotScreenBallDisplay({
    id: "left-monitor",
    workArea: { x: -1_920, y: -40, width: 1_920, height: 1_040 }
  });
  assert.deepEqual(display, {
    id: "left-monitor",
    x: -1_920,
    y: -40,
    width: 1_920,
    height: 1_040
  });
  assert.deepEqual(
    clampScreenBallBounds(
      { x: -3_000, y: -500, width: 2_000, height: 1_200 },
      display
    ),
    { x: -1_920, y: -40, width: 1_920, height: 1_040 }
  );
});

test("screen-ball display changes are explicit and points reproject across metrics changes", async () => {
  const {
    displayChangedForScreenBall,
    projectScreenBallPoint,
    snapshotScreenBallDisplay
  } = await loadScreenBallModule();
  const first = snapshotScreenBallDisplay({
    id: 1,
    workArea: { x: 0, y: 0, width: 1_000, height: 800 }
  });
  const resized = snapshotScreenBallDisplay({
    id: 1,
    workArea: { x: 0, y: 0, width: 2_000, height: 1_600 }
  });
  const second = snapshotScreenBallDisplay({
    id: 2,
    workArea: { x: 1_000, y: 100, width: 1_200, height: 900 }
  });
  assert.equal(displayChangedForScreenBall(first, resized), false);
  assert.equal(displayChangedForScreenBall(first, second), true);
  assert.deepEqual(projectScreenBallPoint({ x: 500, y: 400 }, first, resized), {
    x: 1_000,
    y: 800
  });
});

test("screen-ball hit regions capture only balls or explicit controls", async () => {
  const {
    hitRegionContainsPoint,
    isCurrentScreenBallSession,
    shouldCaptureScreenBallPointer
  } = await loadScreenBallModule();
  const regions = [
    { id: "ball-1", x: 100, y: 200, width: 44, height: 44, kind: "ball" },
    { id: "close", x: 1_000, y: 12, width: 48, height: 48, kind: "control" }
  ];
  assert.equal(shouldCaptureScreenBallPointer(regions, { x: 10, y: 10 }), false);
  assert.equal(shouldCaptureScreenBallPointer(regions, { x: 120, y: 220 }), true);
  assert.equal(hitRegionContainsPoint(regions[0], { x: 144, y: 244 }), true);
  assert.equal(isCurrentScreenBallSession({ id: "run-1", display: {} }, "run-1"), true);
  assert.equal(isCurrentScreenBallSession({ id: "run-1", display: {} }, "run-2"), false);
});

test("disposing an absent or active session is idempotent", async () => {
  const { disposeScreenBallSession } = await loadScreenBallModule();
  assert.equal(disposeScreenBallSession(null), null);
  assert.equal(
    disposeScreenBallSession({ id: "run-1", display: { id: 1 } }),
    null
  );
});
