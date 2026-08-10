import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

async function loadArcadeModule() {
  const source = fs.readFileSync(
    new URL(
      "../src/components/ButlerBuddy/petArcade.ts",
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

test("arcade balls launch from the pet with bounded randomized motion", async () => {
  const { createPetArcadeState, spawnPetArcadeBall } =
    await loadArcadeModule();
  const randomValues = [0, 0.5, 1, 0.25, 0.5];
  let randomIndex = 0;
  const state = spawnPetArcadeBall(
    createPetArcadeState(),
    1_000,
    () => randomValues[randomIndex++] ?? 0.5
  );

  assert.equal(state.balls.length, 1);
  assert.deepEqual(state.balls[0], {
    id: "ball-1",
    x: 50,
    y: 78,
    vx: -22,
    vy: -52,
    radius: 8,
    color: 0,
    hue: 160,
    kind: "normal",
    createdAt: 1_000
  });
  assert.equal(state.nextBallId, 2);
});

test("arcade ball count is capped and expired balls count as misses", async () => {
  const {
    PET_ARCADE_BALL_LIFETIME_MS,
    PET_ARCADE_MAX_BALLS,
    advancePetArcadeState,
    createPetArcadeState,
    spawnPetArcadeBall
  } = await loadArcadeModule();
  let state = createPetArcadeState();

  for (let index = 0; index < PET_ARCADE_MAX_BALLS + 2; index += 1) {
    state = spawnPetArcadeBall(state, index * 10, () => 0.5);
  }
  assert.equal(state.balls.length, PET_ARCADE_MAX_BALLS);

  state = advancePetArcadeState(
    state,
    16,
    PET_ARCADE_BALL_LIFETIME_MS + 100
  );
  assert.equal(state.balls.length, 0);
  assert.equal(state.missed, PET_ARCADE_MAX_BALLS);
});

test("clicking a ball removes it and rewards quick-hit combos", async () => {
  const {
    PET_ARCADE_COMBO_WINDOW_MS,
    createPetArcadeState,
    hitPetArcadeBall,
    spawnPetArcadeBall
  } = await loadArcadeModule();
  let state = createPetArcadeState();
  state = spawnPetArcadeBall(state, 1_000, () => 0.1);
  state = spawnPetArcadeBall(state, 1_010, () => 0.4);

  state = hitPetArcadeBall(state, "ball-1", 2_000);
  assert.equal(state.score, 20);
  assert.equal(state.combo, 1);
  assert.deepEqual(state.balls.map((ball) => ball.id), ["ball-2"]);

  state = hitPetArcadeBall(
    state,
    "ball-2",
    2_000 + PET_ARCADE_COMBO_WINDOW_MS
  );
  assert.equal(state.score, 42);
  assert.equal(state.combo, 2);
  assert.equal(state.balls.length, 0);

  const unchanged = hitPetArcadeBall(state, "missing", 4_000);
  assert.strictEqual(unchanged, state);
});

test("ball physics bounce inside the play field", async () => {
  const { advancePetArcadeState, createPetArcadeState } =
    await loadArcadeModule();
  const state = {
    ...createPetArcadeState(),
    balls: [
      {
        id: "ball-1",
        x: 94,
        y: 8,
        vx: 20,
        vy: -20,
        radius: 6,
        color: 0,
        hue: 120,
        kind: "normal",
        createdAt: 0
      }
    ]
  };

  const advanced = advancePetArcadeState(state, 1_000, 1_000);
  assert.ok(advanced.balls[0].x <= 94);
  assert.ok(advanced.balls[0].vx < 0);
  assert.ok(advanced.balls[0].y >= 6);
  assert.ok(advanced.balls[0].vy > 0);
});

test("an empty arcade frame preserves the no-change state signal", async () => {
  const { advancePetArcadeState, createPetArcadeState } =
    await loadArcadeModule();
  const state = createPetArcadeState();

  assert.strictEqual(advancePetArcadeState(state, 16, 1_000), state);
});

test("combo expires while the arcade has no active balls", async () => {
  const {
    PET_ARCADE_COMBO_WINDOW_MS,
    advancePetArcadeState,
    createPetArcadeState
  } = await loadArcadeModule();
  const state = {
    ...createPetArcadeState(),
    combo: 3,
    lastHitAt: 1_000
  };

  const advanced = advancePetArcadeState(
    state,
    16,
    1_000 + PET_ARCADE_COMBO_WINDOW_MS + 1
  );
  assert.equal(advanced.combo, 0);
  assert.equal(advanced.lastHitAt, null);
});

test("combo expires while active balls continue advancing", async () => {
  const {
    PET_ARCADE_COMBO_WINDOW_MS,
    advancePetArcadeState,
    createPetArcadeState,
    spawnPetArcadeBall
  } = await loadArcadeModule();
  const state = {
    ...spawnPetArcadeBall(createPetArcadeState(), 1_000, () => 0.5),
    combo: 2,
    lastHitAt: 1_000
  };

  const advanced = advancePetArcadeState(
    state,
    16,
    1_000 + PET_ARCADE_COMBO_WINDOW_MS + 1
  );
  assert.equal(advanced.combo, 0);
  assert.equal(advanced.lastHitAt, null);
  assert.equal(advanced.balls.length, 1);
  assert.notStrictEqual(advanced.balls[0], state.balls[0]);
});

test("a hit just after the combo window starts a fresh combo", async () => {
  const {
    PET_ARCADE_COMBO_WINDOW_MS,
    createPetArcadeState,
    hitPetArcadeBall,
    spawnPetArcadeBall
  } = await loadArcadeModule();
  let state = spawnPetArcadeBall(createPetArcadeState(), 1_000, () => 0.5);
  state = {
    ...state,
    score: 24,
    combo: 3,
    lastHitAt: 1_000
  };

  state = hitPetArcadeBall(
    state,
    "ball-1",
    1_000 + PET_ARCADE_COMBO_WINDOW_MS + 1
  );
  assert.equal(state.score, 44);
  assert.equal(state.combo, 1);
  assert.equal(state.lastHitAt, 1_000 + PET_ARCADE_COMBO_WINDOW_MS + 1);
});

test("nearby matching balls detonate as a scored chain reaction", async () => {
  const { createPetArcadeState, hitPetArcadeBall } =
    await loadArcadeModule();
  const ball = (id, x, y, color) => ({
    id,
    x,
    y,
    vx: 0,
    vy: 0,
    radius: 6,
    color,
    hue: color === 0 ? 160 : 210,
    kind: "normal",
    createdAt: 1_000
  });
  const state = {
    ...createPetArcadeState(1_000),
    balls: [
      ball("ball-1", 30, 40, 0),
      ball("ball-2", 49, 40, 0),
      ball("ball-3", 68, 40, 0),
      ball("ball-4", 49, 66, 1)
    ]
  };

  const hit = hitPetArcadeBall(state, "ball-1", 2_000);
  assert.deepEqual(hit.balls.map((item) => item.id), ["ball-4"]);
  assert.equal(hit.score, 140);
  assert.equal(hit.combo, 3);
  assert.equal(hit.fever, 66);
  assert.equal(hit.lastHit?.chainCount, 3);
  assert.deepEqual(
    hit.lastHit?.balls.map((item) => item.id),
    ["ball-1", "ball-2", "ball-3"]
  );
});

test("fever or the final ten seconds starts the boss climax", async () => {
  const {
    PET_ARCADE_BOSS_PHASE_MS,
    PET_ARCADE_FEVER_MAX,
    PET_ARCADE_ROUND_DURATION_MS,
    advancePetArcadeState,
    createPetArcadeState
  } = await loadArcadeModule();
  const startedAt = 1_000;
  const feverState = {
    ...createPetArcadeState(startedAt),
    fever: PET_ARCADE_FEVER_MAX
  };
  assert.equal(
    advancePetArcadeState(feverState, 16, startedAt + 1_000).phase,
    "boss"
  );

  const timedState = createPetArcadeState(startedAt);
  assert.equal(
    advancePetArcadeState(
      timedState,
      16,
      startedAt + PET_ARCADE_ROUND_DURATION_MS - PET_ARCADE_BOSS_PHASE_MS
    ).phase,
    "boss"
  );
});

test("active weak points charge a finishing move that defeats the boss", async () => {
  const {
    PET_ARCADE_BOSS_MAX_HEALTH,
    PET_ARCADE_ULTIMATE_MAX,
    createPetArcadeState,
    hitPetArcadeWeakPoint,
    spawnPetArcadeBall,
    triggerPetArcadeUltimate
  } = await loadArcadeModule();
  let state = {
    ...createPetArcadeState(1_000),
    phase: "boss",
    bossHealth: PET_ARCADE_BOSS_MAX_HEALTH
  };
  state = spawnPetArcadeBall(state, 1_500, () => 0.5);

  const shielded = hitPetArcadeWeakPoint(state, 1, 2_000);
  assert.strictEqual(shielded, state);

  for (let index = 0; index < 4; index += 1) {
    state = hitPetArcadeWeakPoint(state, state.activeWeakPoint, 2_000 + index);
  }
  assert.equal(state.ultimate, PET_ARCADE_ULTIMATE_MAX);
  assert.equal(state.bossHealth, 320);

  state = triggerPetArcadeUltimate(state, 3_000);
  assert.equal(state.bossHealth, 0);
  assert.equal(state.phase, "victory");
  assert.deepEqual(state.balls, []);
  assert.equal(state.lastBossHit?.ultimate, true);
});

test("an unfinished round times out at thirty seconds", async () => {
  const {
    PET_ARCADE_ROUND_DURATION_MS,
    advancePetArcadeState,
    createPetArcadeState
  } = await loadArcadeModule();
  const startedAt = 1_000;
  const state = createPetArcadeState(startedAt);

  const finished = advancePetArcadeState(
    state,
    16,
    startedAt + PET_ARCADE_ROUND_DURATION_MS
  );
  assert.equal(finished.phase, "timeout");
});
