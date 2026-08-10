export const PET_ARCADE_MAX_BALLS = 7;
export const PET_ARCADE_BALL_LIFETIME_MS = 8_000;
export const PET_ARCADE_COMBO_WINDOW_MS = 1_200;
export const PET_ARCADE_ROUND_DURATION_MS = 30_000;
export const PET_ARCADE_BOSS_PHASE_MS = 10_000;
export const PET_ARCADE_FEVER_MAX = 100;
export const PET_ARCADE_BOSS_MAX_HEALTH = 800;
export const PET_ARCADE_ULTIMATE_MAX = 100;
export const PET_ARCADE_WEAK_POINT_COUNT = 3;

const PET_ARCADE_GRAVITY = 38;
const PET_ARCADE_FLOOR_Y = 80;
const PET_ARCADE_BOUNCE_DAMPING = 0.82;
const PET_ARCADE_CHAIN_DISTANCE = 24;
const PET_ARCADE_WEAK_POINT_INTERVAL_MS = 1_400;
const PET_ARCADE_WEAK_POINT_DAMAGE = 120;
const PET_ARCADE_ULTIMATE_DAMAGE = 320;
const PET_ARCADE_BALL_HUES = [160, 210, 275, 45] as const;

export type PetArcadePhase = "hunt" | "boss" | "victory" | "timeout";
export type PetArcadeBallKind = "normal" | "gold";

export interface PetArcadeBall {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: number;
  hue: number;
  kind: PetArcadeBallKind;
  createdAt: number;
}

export interface PetArcadeHitBall {
  id: string;
  x: number;
  y: number;
  hue: number;
  points: number;
}

export interface PetArcadeHitFeedback {
  id: number;
  balls: PetArcadeHitBall[];
  points: number;
  chainCount: number;
  bossDamage: number;
}

export interface PetArcadeBossHitFeedback {
  id: number;
  damage: number;
  weakPoint: number | null;
  ultimate: boolean;
}

export interface PetArcadeState {
  balls: PetArcadeBall[];
  score: number;
  combo: number;
  missed: number;
  lastHitAt: number | null;
  nextBallId: number;
  feedbackSequence: number;
  roundStartedAt: number;
  roundEndsAt: number;
  phase: PetArcadePhase;
  fever: number;
  bossHealth: number;
  ultimate: number;
  activeWeakPoint: number;
  weakPointChangedAt: number;
  lastHit: PetArcadeHitFeedback | null;
  lastBossHit: PetArcadeBossHitFeedback | null;
}

export function createPetArcadeState(at = Date.now()): PetArcadeState {
  return {
    balls: [],
    score: 0,
    combo: 0,
    missed: 0,
    lastHitAt: null,
    nextBallId: 1,
    feedbackSequence: 0,
    roundStartedAt: at,
    roundEndsAt: at + PET_ARCADE_ROUND_DURATION_MS,
    phase: "hunt",
    fever: 0,
    bossHealth: PET_ARCADE_BOSS_MAX_HEALTH,
    ultimate: 0,
    activeWeakPoint: 0,
    weakPointChangedAt: at,
    lastHit: null,
    lastBossHit: null
  };
}

function isTerminalPhase(phase: PetArcadePhase): boolean {
  return phase === "victory" || phase === "timeout";
}

export function spawnPetArcadeBall(
  state: PetArcadeState,
  at = Date.now(),
  random: () => number = Math.random
): PetArcadeState {
  if (
    isTerminalPhase(state.phase) ||
    state.balls.length >= PET_ARCADE_MAX_BALLS
  ) {
    return state;
  }

  const vx = -22 + random() * 44;
  const vy = -46 - random() * 12;
  const radius = 6 + random() * 2;
  const colorRoll = Math.max(0, Math.min(0.999, random()));
  const kind: PetArcadeBallKind = random() < 0.08 ? "gold" : "normal";
  const color = kind === "gold" ? 3 : Math.floor(colorRoll * 3);
  const ball: PetArcadeBall = {
    id: `ball-${state.nextBallId}`,
    x: 50,
    y: 78,
    vx,
    vy,
    radius,
    color,
    hue: PET_ARCADE_BALL_HUES[color],
    kind,
    createdAt: at
  };

  return {
    ...state,
    balls: [...state.balls, ball],
    nextBallId: state.nextBallId + 1
  };
}

function bounceAxis(
  position: number,
  velocity: number,
  min: number,
  max: number,
  damping = 1
): [number, number] {
  if (position < min) return [min, Math.abs(velocity) * damping];
  if (position > max) return [max, -Math.abs(velocity) * damping];
  return [position, velocity];
}

function ballsAreClose(first: PetArcadeBall, second: PetArcadeBall): boolean {
  return Math.hypot(first.x - second.x, first.y - second.y) <= PET_ARCADE_CHAIN_DISTANCE;
}

function findPetArcadeChain(
  balls: PetArcadeBall[],
  target: PetArcadeBall
): PetArcadeBall[] {
  if (target.kind === "gold") return [target];
  const chain: PetArcadeBall[] = [target];
  const selected = new Set([target.id]);

  for (let index = 0; index < chain.length; index += 1) {
    const current = chain[index];
    for (const candidate of balls) {
      if (
        selected.has(candidate.id) ||
        candidate.kind !== "normal" ||
        candidate.color !== target.color ||
        !ballsAreClose(current, candidate)
      ) {
        continue;
      }
      selected.add(candidate.id);
      chain.push(candidate);
    }
  }
  return chain;
}

function scoreForChainBall(ball: PetArcadeBall, index: number): number {
  if (ball.kind === "gold") return 120;
  return Math.min(20 * 2 ** index, 80);
}

function startBossPhase(state: PetArcadeState, at: number): PetArcadeState {
  return {
    ...state,
    phase: "boss",
    activeWeakPoint: 0,
    weakPointChangedAt: at
  };
}

export function advancePetArcadeState(
  state: PetArcadeState,
  elapsedMs: number,
  at = Date.now()
): PetArcadeState {
  if (isTerminalPhase(state.phase)) return state;
  if (at >= state.roundEndsAt) {
    return {
      ...state,
      balls: [],
      combo: 0,
      lastHitAt: null,
      phase: state.bossHealth <= 0 ? "victory" : "timeout"
    };
  }

  let nextState = state;
  const shouldStartBoss =
    state.phase === "hunt" &&
    (state.fever >= PET_ARCADE_FEVER_MAX ||
      at >= state.roundEndsAt - PET_ARCADE_BOSS_PHASE_MS);
  if (shouldStartBoss) nextState = startBossPhase(state, at);

  let activeWeakPoint = nextState.activeWeakPoint;
  let weakPointChangedAt = nextState.weakPointChangedAt;
  if (
    nextState.phase === "boss" &&
    at - weakPointChangedAt >= PET_ARCADE_WEAK_POINT_INTERVAL_MS
  ) {
    const steps = Math.floor(
      (at - weakPointChangedAt) / PET_ARCADE_WEAK_POINT_INTERVAL_MS
    );
    activeWeakPoint =
      (activeWeakPoint + steps) % PET_ARCADE_WEAK_POINT_COUNT;
    weakPointChangedAt += steps * PET_ARCADE_WEAK_POINT_INTERVAL_MS;
  }

  const comboExpired =
    nextState.lastHitAt !== null &&
    at - nextState.lastHitAt > PET_ARCADE_COMBO_WINDOW_MS;
  const activeBalls = nextState.balls.filter(
    (ball) => at - ball.createdAt < PET_ARCADE_BALL_LIFETIME_MS
  );
  const ballsExpired = activeBalls.length !== nextState.balls.length;

  if (activeBalls.length === 0) {
    if (
      nextState === state &&
      !comboExpired &&
      !ballsExpired &&
      activeWeakPoint === nextState.activeWeakPoint
    ) {
      return state;
    }
    return {
      ...nextState,
      balls: activeBalls,
      missed:
        nextState.missed + nextState.balls.length - activeBalls.length,
      combo: comboExpired ? 0 : nextState.combo,
      lastHitAt: comboExpired ? null : nextState.lastHitAt,
      activeWeakPoint,
      weakPointChangedAt
    };
  }

  const elapsedSeconds = Math.max(0, Math.min(elapsedMs, 1_000)) / 1_000;
  const balls = activeBalls.map((ball) => {
    let [x, vx] = bounceAxis(
      ball.x + ball.vx * elapsedSeconds,
      ball.vx,
      ball.radius,
      100 - ball.radius
    );
    let [y, vy] = bounceAxis(
      ball.y + ball.vy * elapsedSeconds,
      ball.vy,
      ball.radius,
      PET_ARCADE_FLOOR_Y - ball.radius,
      PET_ARCADE_BOUNCE_DAMPING
    );
    vy += PET_ARCADE_GRAVITY * elapsedSeconds;

    x = Number.isFinite(x) ? x : 50;
    y = Number.isFinite(y) ? y : 50;
    vx = Number.isFinite(vx) ? vx : 0;
    vy = Number.isFinite(vy) ? vy : 0;
    return { ...ball, x, y, vx, vy };
  });

  return {
    ...nextState,
    balls,
    missed: nextState.missed + nextState.balls.length - activeBalls.length,
    combo: comboExpired ? 0 : nextState.combo,
    lastHitAt: comboExpired ? null : nextState.lastHitAt,
    activeWeakPoint,
    weakPointChangedAt
  };
}

export function hitPetArcadeBall(
  state: PetArcadeState,
  ballId: string,
  at = Date.now()
): PetArcadeState {
  if (isTerminalPhase(state.phase)) return state;
  const target = state.balls.find((ball) => ball.id === ballId);
  if (!target) return state;

  const chain = findPetArcadeChain(state.balls, target);
  const chainIds = new Set(chain.map((ball) => ball.id));
  const previousCombo =
    state.lastHitAt !== null && at - state.lastHitAt <= PET_ARCADE_COMBO_WINDOW_MS
      ? state.combo
      : 0;
  const scoredBalls = chain.map((ball, index) => ({
    ball,
    points: scoreForChainBall(ball, index)
  }));
  const points =
    scoredBalls.reduce((total, item) => total + item.points, 0) +
    previousCombo * 2;
  const chainBonus = Math.max(0, chain.length - 1);
  const feverGain =
    chain.reduce(
      (total, ball) => total + (ball.kind === "gold" ? 36 : 14),
      0
    ) +
    chainBonus * 12;
  const bossDamage =
    state.phase === "boss"
      ? chain.length * 20 +
        chainBonus * 40 +
        (chain.some((ball) => ball.kind === "gold") ? 80 : 0)
      : 0;
  const bossHealth = Math.max(0, state.bossHealth - bossDamage);
  const feedbackSequence = state.feedbackSequence + 1;

  return {
    ...state,
    balls:
      bossHealth === 0
        ? []
        : state.balls.filter((ball) => !chainIds.has(ball.id)),
    score: state.score + points,
    combo: previousCombo + chain.length,
    lastHitAt: at,
    fever: Math.min(PET_ARCADE_FEVER_MAX, state.fever + feverGain),
    bossHealth,
    ultimate:
      state.phase === "boss"
        ? Math.min(
            PET_ARCADE_ULTIMATE_MAX,
            state.ultimate + chain.length * 12 + chainBonus * 8
          )
        : state.ultimate,
    phase: bossHealth === 0 ? "victory" : state.phase,
    feedbackSequence,
    lastHit: {
      id: feedbackSequence,
      balls: scoredBalls.map(({ ball, points: ballPoints }) => ({
        id: ball.id,
        x: ball.x,
        y: ball.y,
        hue: ball.hue,
        points: ballPoints
      })),
      points,
      chainCount: chain.length,
      bossDamage
    }
  };
}

export function hitPetArcadeWeakPoint(
  state: PetArcadeState,
  weakPoint: number,
  at = Date.now()
): PetArcadeState {
  if (state.phase !== "boss" || weakPoint !== state.activeWeakPoint) {
    return state;
  }
  const previousCombo =
    state.lastHitAt !== null && at - state.lastHitAt <= PET_ARCADE_COMBO_WINDOW_MS
      ? state.combo
      : 0;
  const bossHealth = Math.max(
    0,
    state.bossHealth - PET_ARCADE_WEAK_POINT_DAMAGE
  );
  const feedbackSequence = state.feedbackSequence + 1;

  return {
    ...state,
    balls: bossHealth === 0 ? [] : state.balls,
    score: state.score + PET_ARCADE_WEAK_POINT_DAMAGE + previousCombo * 2,
    combo: previousCombo + 1,
    lastHitAt: at,
    bossHealth,
    ultimate: Math.min(PET_ARCADE_ULTIMATE_MAX, state.ultimate + 25),
    activeWeakPoint:
      (state.activeWeakPoint + 1) % PET_ARCADE_WEAK_POINT_COUNT,
    weakPointChangedAt: at,
    phase: bossHealth === 0 ? "victory" : state.phase,
    feedbackSequence,
    lastBossHit: {
      id: feedbackSequence,
      damage: PET_ARCADE_WEAK_POINT_DAMAGE,
      weakPoint,
      ultimate: false
    }
  };
}

export function triggerPetArcadeUltimate(
  state: PetArcadeState,
  _at = Date.now()
): PetArcadeState {
  if (
    state.phase !== "boss" ||
    state.ultimate < PET_ARCADE_ULTIMATE_MAX
  ) {
    return state;
  }
  const bossHealth = Math.max(0, state.bossHealth - PET_ARCADE_ULTIMATE_DAMAGE);
  const feedbackSequence = state.feedbackSequence + 1;

  return {
    ...state,
    balls: bossHealth === 0 ? [] : state.balls,
    score: state.score + PET_ARCADE_ULTIMATE_DAMAGE,
    bossHealth,
    ultimate: 0,
    phase: bossHealth === 0 ? "victory" : state.phase,
    feedbackSequence,
    lastBossHit: {
      id: feedbackSequence,
      damage: PET_ARCADE_ULTIMATE_DAMAGE,
      weakPoint: null,
      ultimate: true
    }
  };
}

export function remainingPetArcadeSeconds(
  state: PetArcadeState,
  at = Date.now()
): number {
  return Math.max(0, Math.ceil((state.roundEndsAt - at) / 1_000));
}
