import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

async function loadScreenBallModule() {
  const source = fs.readFileSync(
    new URL(
      "../src/components/ButlerBuddy/screenBallArcade.ts",
      import.meta.url
    ),
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

function stateAt(create, at = 1_000) {
  return create({
    at,
    bounds: { left: 0, right: 100, top: 0, bottom: 100 },
    origin: { x: 50, y: 80 }
  });
}

test("screen-ball spawning is deterministic and capped at six active balls", async () => {
  const {
    SCREEN_BALL_MAX_BALLS,
    createScreenBallArcadeState,
    spawnScreenBall
  } = await loadScreenBallModule();
  let state = stateAt(createScreenBallArcadeState);
  for (let index = 0; index < SCREEN_BALL_MAX_BALLS + 2; index += 1) {
    state = spawnScreenBall(state, { at: 1_000 + index, random: () => 0.5 });
  }
  assert.equal(state.balls.length, SCREEN_BALL_MAX_BALLS);
  assert.equal(state.balls[0].id, "screen-ball-1");
  assert.deepEqual(
    { x: state.balls[0].x, y: state.balls[0].y, createdAt: state.balls[0].createdAt },
    { x: 50, y: 80, createdAt: 1_000 }
  );
});

test("spawned balls launch into a readable full-screen arc", async () => {
  const {
    advanceScreenBallState,
    createScreenBallArcadeState,
    spawnScreenBall
  } = await loadScreenBallModule();
  const startedAt = 1_000;
  let state = createScreenBallArcadeState({
    at: startedAt,
    bounds: { left: 0, top: 0, right: 1_440, bottom: 900 },
    origin: { x: 720, y: 720 }
  });
  state = spawnScreenBall(state, { at: startedAt, random: () => 0.25 });
  const [spawned] = state.balls;
  const lifted = advanceScreenBallState(state, 350, startedAt + 350).balls[0];

  assert.ok(spawned.vy < -450, "the launch should have enough upward velocity");
  assert.ok(Math.abs(spawned.vx) > 60, "the launch should travel across the display");
  assert.ok(lifted.y < spawned.y - 120, "the ball should visibly rise before falling");
});

test("screen-ball swipes support a larger swarm and segment hits", async () => {
  const {
    SCREEN_BALL_DEFAULT_RADIUS,
    SCREEN_BALL_MAX_BALLS,
    screenBallIntersectsSegment
  } = await loadScreenBallModule();
  assert.equal(SCREEN_BALL_MAX_BALLS, 6);
  assert.equal(SCREEN_BALL_DEFAULT_RADIUS, 14);
  const ball = {
    id: "swipe-target",
    x: 120,
    y: 100,
    vx: 0,
    vy: 0,
    radius: 9,
    createdAt: 1_000
  };
  assert.equal(
    screenBallIntersectsSegment(ball, { x: 40, y: 100 }, { x: 200, y: 100 }),
    true
  );
  assert.equal(
    screenBallIntersectsSegment(ball, { x: 40, y: 40 }, { x: 200, y: 40 }),
    false
  );
});

test("difficulty levels increase pace, active targets, and ball colors", async () => {
  const {
    createScreenBallArcadeState,
    maxScreenBallCount,
    screenBallColorForLevel,
    screenBallLevelForScore,
    screenBallSpawnIntervalMs,
    spawnScreenBall
  } = await loadScreenBallModule();
  assert.equal(screenBallLevelForScore(0), 1);
  assert.equal(screenBallLevelForScore(400), 2);
  assert.equal(screenBallLevelForScore(3_000), 5);
  assert.equal(maxScreenBallCount(1), 6);
  assert.equal(maxScreenBallCount(5), 10);
  assert.ok(screenBallSpawnIntervalMs(5) < screenBallSpawnIntervalMs(1));
  assert.equal(screenBallColorForLevel(1), "mint");
  assert.equal(screenBallColorForLevel(3), "violet");
  assert.equal(screenBallColorForLevel(5), "coral");

  const base = createScreenBallArcadeState({
    at: 1_000,
    bounds: { left: 0, top: 0, right: 1_440, bottom: 900 },
    origin: { x: 720, y: 720 }
  });
  const levelOne = spawnScreenBall(base, { at: 1_000, random: () => 0.25 });
  const levelTwo = spawnScreenBall(
    { ...base, score: 400, level: 2 },
    { at: 1_000, random: () => 0.25 }
  );
  assert.equal(levelTwo.balls[0].color, "sky");
  assert.ok(Math.abs(levelTwo.balls[0].vx) > Math.abs(levelOne.balls[0].vx));

  const bomb = spawnScreenBall(
    { ...base, score: 400, level: 2, nextBallId: 7 },
    { at: 1_000, random: () => 0.5 }
  );
  assert.equal(bomb.balls[0].kind, "bomb");
});

test("slicing a black bomb immediately ends the round", async () => {
  const { createScreenBallArcadeState, hitScreenBall } =
    await loadScreenBallModule();
  const state = {
    ...createScreenBallArcadeState({
      at: 1_000,
      bounds: { left: 0, top: 0, right: 600, bottom: 500 },
      origin: { x: 300, y: 400 }
    }),
    balls: [
      {
        id: "black-bomb",
        kind: "bomb",
        color: "bomb",
        x: 200,
        y: 180,
        vx: 0,
        vy: 0,
        radius: 14,
        createdAt: 1_000
      }
    ]
  };
  const ended = hitScreenBall(state, "black-bomb", 1_200);
  assert.equal(ended.phase, "settled");
  assert.equal(ended.terminalReason, "bomb-hit");
  assert.deepEqual(ended.balls, []);
});

test("balls reflect from left, right, and top edges", async () => {
  const { advanceScreenBallState, createScreenBallArcadeState } =
    await loadScreenBallModule();
  const base = stateAt(createScreenBallArcadeState);
  const edgeBall = (id, x, y, vx, vy) => ({
    id,
    x,
    y,
    vx,
    vy,
    radius: 1,
    createdAt: 1_000
  });
  const left = advanceScreenBallState(
    { ...base, balls: [edgeBall("left", 1, 50, -20, 0)] },
    100,
    1_100
  );
  assert.ok(left.balls[0].x >= 1);
  assert.ok(left.balls[0].vx > 0);

  const right = advanceScreenBallState(
    { ...base, balls: [edgeBall("right", 99, 50, 20, 0)] },
    100,
    1_100
  );
  assert.ok(right.balls[0].x <= 99);
  assert.ok(right.balls[0].vx < 0);

  const top = advanceScreenBallState(
    { ...base, balls: [edgeBall("top", 50, 1, 0, -20)] },
    100,
    1_100
  );
  assert.ok(top.balls[0].y >= 1);
  assert.ok(top.balls[0].vy > 0);
});

test("a ball crossing the bottom is removed and counts as a miss", async () => {
  const { advanceScreenBallState, createScreenBallArcadeState } =
    await loadScreenBallModule();
  const state = stateAt(createScreenBallArcadeState);
  const advanced = advanceScreenBallState(
    {
      ...state,
      balls: [
        {
          id: "falling",
          x: 50,
          y: 98,
          vx: 0,
          vy: 20,
          radius: 1,
          createdAt: 1_000
        }
      ]
    },
    200,
    1_200
  );
  assert.equal(advanced.balls.length, 0);
  assert.equal(advanced.missed, 1);
  assert.equal(advanced.misses, 1);
  assert.equal(advanced.phase, "playing");

  // The bottom is not a bounce edge: while the ball is only partly below the
  // work area it keeps falling, rather than being reflected upward.
  const partlyBelow = advanceScreenBallState(
    {
      ...state,
      balls: [
        {
          id: "partly-below",
          x: 50,
          y: 98,
          vx: 0,
          vy: 5,
          radius: 6,
          createdAt: 1_000
        }
      ]
    },
    200,
    1_200
  );
  assert.equal(partlyBelow.balls.length, 1);
  assert.ok(partlyBelow.balls[0].y > 98);
});

test("the tenth miss settles exactly once and clears remaining balls", async () => {
  const {
    advanceScreenBallState,
    createScreenBallArcadeState,
    hitScreenBall,
    spawnScreenBall,
    stopScreenBall
  } = await loadScreenBallModule();
  const state = {
    ...stateAt(createScreenBallArcadeState),
    missed: 9,
    misses: 9,
    balls: [
      {
        id: "last-miss",
        x: 50,
        y: 98,
        vx: 0,
        vy: 20,
        radius: 1,
        createdAt: 1_000
      },
      {
        id: "cleared-with-round",
        x: 20,
        y: 40,
        vx: 0,
        vy: 0,
        radius: 1,
        createdAt: 1_000
      }
    ]
  };
  const settled = advanceScreenBallState(state, 200, 1_200);
  assert.equal(settled.missed, 10);
  assert.equal(settled.terminalReason, "miss-limit");
  assert.deepEqual(settled.balls, []);
  assert.strictEqual(advanceScreenBallState(settled, 16, 1_216), settled);
  assert.strictEqual(spawnScreenBall(settled, 1_300), settled);
  assert.strictEqual(hitScreenBall(settled, "cleared-with-round", 1_300), settled);
  assert.strictEqual(stopScreenBall(settled, 1_300), settled);
});

test("the exact 180-second deadline settles as a perfect finish", async () => {
  const {
    SCREEN_BALL_ROUND_DURATION_MS,
    advanceScreenBallState,
    createScreenBallArcadeState,
    spawnScreenBall
  } = await loadScreenBallModule();
  const startedAt = 1_000;
  let state = stateAt(createScreenBallArcadeState, startedAt);
  state = spawnScreenBall(state, { at: startedAt, random: () => 0.5 });
  const finished = advanceScreenBallState(
    state,
    16,
    startedAt + SCREEN_BALL_ROUND_DURATION_MS
  );
  assert.equal(finished.phase, "settled");
  assert.equal(finished.terminalReason, "perfect-finish");
  assert.deepEqual(finished.balls, []);
  assert.equal(finished.missed, 0);
});

test("faster reaction times score more and hits remove balls immediately", async () => {
  const {
    createScreenBallArcadeState,
    hitScreenBall,
    scoreForScreenBallReaction
  } = await loadScreenBallModule();
  const state = {
    ...stateAt(createScreenBallArcadeState),
    balls: [
      {
        id: "fast",
        x: 20,
        y: 20,
        vx: 0,
        vy: 0,
        radius: 1,
        createdAt: 1_000
      },
      {
        id: "slow",
        x: 40,
        y: 20,
        vx: 0,
        vy: 0,
        radius: 1,
        createdAt: 1_000
      }
    ]
  };
  const fast = hitScreenBall(state, "fast", 1_100);
  const slow = hitScreenBall(state, "slow", 4_000);
  assert.equal(fast.balls.length, 1);
  assert.equal(fast.reactionTimes[0], 100);
  assert.ok(fast.score > slow.score);
  assert.ok(scoreForScreenBallReaction(100) > scoreForScreenBallReaction(4_000));
  assert.equal(fast.averageReactionTime, 100);
});

test("combo increases inside its window, resets afterwards, and tracks max combo", async () => {
  const {
    SCREEN_BALL_COMBO_WINDOW_MS,
    createScreenBallArcadeState,
    hitScreenBall
  } = await loadScreenBallModule();
  const state = {
    ...stateAt(createScreenBallArcadeState),
    balls: [
      { id: "one", x: 10, y: 20, vx: 0, vy: 0, radius: 1, createdAt: 1_000 },
      { id: "two", x: 20, y: 20, vx: 0, vy: 0, radius: 1, createdAt: 1_000 },
      { id: "three", x: 30, y: 20, vx: 0, vy: 0, radius: 1, createdAt: 1_000 }
    ]
  };
  const first = hitScreenBall(state, "one", 1_100);
  const second = hitScreenBall(
    first,
    "two",
    1_100 + SCREEN_BALL_COMBO_WINDOW_MS
  );
  const third = hitScreenBall(
    second,
    "three",
    1_100 + SCREEN_BALL_COMBO_WINDOW_MS * 2 + 1
  );
  assert.equal(first.combo, 1);
  assert.equal(second.combo, 2);
  assert.equal(second.maxCombo, 2);
  assert.equal(third.combo, 1);
  assert.equal(third.maxCombo, 2);
});

test("average reaction time ignores misses and is empty before the first hit", async () => {
  const {
    advanceScreenBallState,
    averageScreenBallReactionTime,
    createScreenBallArcadeState,
    hitScreenBall
  } = await loadScreenBallModule();
  const state = stateAt(createScreenBallArcadeState);
  assert.equal(averageScreenBallReactionTime(state), null);
  const hit = hitScreenBall(
    {
      ...state,
      balls: [
        { id: "hit", x: 20, y: 20, vx: 0, vy: 0, radius: 1, createdAt: 1_000 },
        { id: "miss", x: 50, y: 98, vx: 0, vy: 20, radius: 1, createdAt: 1_000 }
      ]
    },
    "hit",
    1_200
  );
  const afterMiss = advanceScreenBallState(hit, 200, 1_400);
  assert.equal(afterMiss.missed, 1);
  assert.equal(afterMiss.averageReactionTime, 200);
  assert.equal(averageScreenBallReactionTime(afterMiss), 200);
});

test("stop is idempotent and an empty frame/unknown hit preserve the same reference", async () => {
  const {
    advanceScreenBallState,
    createScreenBallArcadeState,
    hitScreenBall,
    stopScreenBall
  } = await loadScreenBallModule();
  const state = stateAt(createScreenBallArcadeState);
  assert.strictEqual(advanceScreenBallState(state, 16, 1_016), state);
  assert.strictEqual(hitScreenBall(state, "missing", 1_016), state);
  const stopped = stopScreenBall(state, 1_016);
  assert.equal(stopped.terminalReason, "stopped");
  assert.deepEqual(stopped.balls, []);
  assert.strictEqual(stopScreenBall(stopped, 2_000), stopped);
  assert.strictEqual(advanceScreenBallState(stopped, 16, 2_000), stopped);
});
