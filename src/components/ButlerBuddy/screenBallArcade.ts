/**
 * The reducer for ButlerBuddy's full-display ball game.
 *
 * This module deliberately has no renderer or Electron dependencies.  A
 * renderer can drive it with a monotonic clock while the main process keeps
 * ownership of the display/session.  Every helper returns the input object
 * when there is no observable change; that makes a rAF loop inexpensive and
 * also gives callers a useful no-op signal.
 */

// Eight active balls is the level-one baseline; later levels add targets while
// capping the swarm at sixteen so the full-display mode feels lively.
export const SCREEN_BALL_MAX_BALLS = 8;
export const SCREEN_BALL_ABSOLUTE_MAX_BALLS = 16;
export const SCREEN_BALL_LEVEL_THRESHOLDS = [0, 400, 1_000, 1_800, 3_000] as const;
export const SCREEN_BALL_MISS_LIMIT = 10;
export const SCREEN_BALL_ROUND_DURATION_MS = 180_000;
export const SCREEN_BALL_COMBO_WINDOW_MS = 1_200;
export const SCREEN_BALL_DEFAULT_WIDTH = 100;
export const SCREEN_BALL_DEFAULT_HEIGHT = 100;
export const SCREEN_BALL_DEFAULT_RADIUS = 14;
// The game spans a whole display, so small arcade-scale velocities make the
// projectile look stuck to the pet.  These values produce a clear, casual arc
// of roughly 250–370 px while keeping the flight short enough to click.
export const SCREEN_BALL_GRAVITY = 520;
export const SCREEN_BALL_BOUNCE_DAMPING = 0.82;
export const SCREEN_BALL_MIN_SCORE = 10;
export const SCREEN_BALL_MAX_SCORE = 100;
export const SCREEN_BALL_REACTION_WINDOW_MS = 5_000;
export const SCREEN_BALL_COMBO_STEP = 0.25;

export type ScreenBallKind = "ball" | "bomb";
export type ScreenBallColor = "mint" | "sky" | "violet" | "amber" | "coral" | "bomb";

/** Compatibility aliases make the constants pleasant to consume alongside
 * the existing petArcade module. */
export const SCREEN_BALL_ARCADE_MAX_BALLS = SCREEN_BALL_MAX_BALLS;
export const SCREEN_BALL_ARCADE_MISS_LIMIT = SCREEN_BALL_MISS_LIMIT;
export const SCREEN_BALL_ARCADE_ROUND_DURATION_MS =
  SCREEN_BALL_ROUND_DURATION_MS;
export const SCREEN_BALL_MAX_ACTIVE_BALLS = SCREEN_BALL_MAX_BALLS;
export const SCREEN_BALL_MAX_MISSES = SCREEN_BALL_MISS_LIMIT;
export const SCREEN_BALL_DURATION_MS = SCREEN_BALL_ROUND_DURATION_MS;

export type ScreenBallArcadePhase = "playing" | "settled" | "stopped";
export type ScreenBallTerminalReason =
  | "miss-limit"
  | "perfect-finish"
  | "bomb-hit"
  | "stopped";

export interface ScreenBallOrigin {
  x: number;
  y: number;
}

export interface ScreenBallPoint {
  x: number;
  y: number;
}

export interface ScreenBallBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ScreenBall {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  createdAt: number;
  kind?: ScreenBallKind;
  color?: ScreenBallColor;
}

export interface ScreenBallArcadeState {
  phase: ScreenBallArcadePhase;
  terminalReason: ScreenBallTerminalReason | null;
  /** `status` and `reason` are read-only-friendly aliases for integrations. */
  status: ScreenBallArcadePhase;
  reason: ScreenBallTerminalReason | null;
  balls: ScreenBall[];
  score: number;
  level: number;
  missed: number;
  /** Alias used by the screen HUD and by the product wording. */
  misses: number;
  reactionTimes: number[];
  /** Alias retained so a consumer can call these samples rather than times. */
  reactionSamples: number[];
  averageReactionTime: number | null;
  combo: number;
  maxCombo: number;
  lastHitAt: number | null;
  nextBallId: number;
  roundStartedAt: number;
  roundEndsAt: number;
  bounds: ScreenBallBounds;
  spawnOrigin: ScreenBallOrigin;
  endedAt: number | null;
}

export interface ScreenBallArcadeOptions {
  at?: number;
  width?: number;
  height?: number;
  bounds?: Partial<ScreenBallBounds> & {
    width?: number;
    height?: number;
  };
  origin?: ScreenBallOrigin;
  spawnOrigin?: ScreenBallOrigin;
}

export interface ScreenBallSpawnOptions {
  at?: number;
  random?: () => number;
  origin?: ScreenBallOrigin;
  spawnOrigin?: ScreenBallOrigin;
}

function distanceSquaredToSegment(
  point: ScreenBallPoint,
  start: ScreenBallPoint,
  end: ScreenBallPoint
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0) {
    const px = point.x - start.x;
    const py = point.y - start.y;
    return px * px + py * py;
  }
  const projection = clamp(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
    0,
    1
  );
  const closestX = start.x + projection * dx;
  const closestY = start.y + projection * dy;
  const offsetX = point.x - closestX;
  const offsetY = point.y - closestY;
  return offsetX * offsetX + offsetY * offsetY;
}

/** Return true when a mouse swipe segment crosses a ball's padded circle. */
export function screenBallIntersectsSegment(
  ball: Pick<ScreenBall, "x" | "y" | "radius">,
  start: ScreenBallPoint,
  end: ScreenBallPoint,
  padding = 12
): boolean {
  const radius = Math.max(0, finiteNumber(ball.radius, SCREEN_BALL_DEFAULT_RADIUS));
  const safePadding = Math.max(0, finiteNumber(padding, 0));
  return (
    distanceSquaredToSegment(
      { x: finiteNumber(ball.x, 0), y: finiteNumber(ball.y, 0) },
      { x: finiteNumber(start.x, 0), y: finiteNumber(start.y, 0) },
      { x: finiteNumber(end.x, 0), y: finiteNumber(end.y, 0) }
    ) <= (radius + safePadding) ** 2
  );
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function screenBallLevelForScore(score: number): number {
  const safeScore = Math.max(0, finiteNumber(score, 0));
  let level = 1;
  for (let index = 0; index < SCREEN_BALL_LEVEL_THRESHOLDS.length; index += 1) {
    if (safeScore >= SCREEN_BALL_LEVEL_THRESHOLDS[index]) level = index + 1;
  }
  return level;
}

export function maxScreenBallCount(level: number): number {
  const safeLevel = Math.max(1, Math.floor(finiteNumber(level, 1)));
  return Math.min(
    SCREEN_BALL_ABSOLUTE_MAX_BALLS,
    SCREEN_BALL_MAX_BALLS + Math.max(0, safeLevel - 1) * 2
  );
}

export function screenBallSpawnIntervalMs(level: number): number {
  const safeLevel = Math.max(1, Math.floor(finiteNumber(level, 1)));
  return Math.max(260, 520 - (safeLevel - 1) * 65);
}

export function screenBallColorForLevel(level: number): ScreenBallColor {
  const colors: ScreenBallColor[] = ["mint", "sky", "violet", "amber", "coral"];
  const index = Math.max(0, Math.min(colors.length - 1, Math.floor(finiteNumber(level, 1)) - 1));
  return colors[index];
}

function normalizeBounds(
  value?: ScreenBallArcadeOptions["bounds"] | ScreenBallBounds,
  fallback: ScreenBallBounds = {
    left: 0,
    right: SCREEN_BALL_DEFAULT_WIDTH,
    top: 0,
    bottom: SCREEN_BALL_DEFAULT_HEIGHT
  }
): ScreenBallBounds {
  const candidate = (value ?? {}) as Partial<ScreenBallBounds> & {
    width?: number;
    height?: number;
  };
  const width = finiteNumber(candidate.width, fallback.right - fallback.left);
  const height = finiteNumber(candidate.height, fallback.bottom - fallback.top);
  const left = finiteNumber(candidate.left, fallback.left);
  const top = finiteNumber(candidate.top, fallback.top);
  const right = finiteNumber(candidate.right, left + Math.max(0, width));
  const bottom = finiteNumber(candidate.bottom, top + Math.max(0, height));
  return {
    left,
    right: Math.max(left, right),
    top,
    bottom: Math.max(top, bottom)
  };
}

function normalizeOrigin(value: unknown, fallback: ScreenBallOrigin): ScreenBallOrigin {
  if (!value || typeof value !== "object") return { ...fallback };
  const candidate = value as Partial<ScreenBallOrigin>;
  return {
    x: finiteNumber(candidate.x, fallback.x),
    y: finiteNumber(candidate.y, fallback.y)
  };
}

function isOptions(value: unknown): value is ScreenBallArcadeOptions {
  return typeof value === "object" && value !== null;
}

function isTerminal(state: ScreenBallArcadeState): boolean {
  return state.terminalReason !== null || state.phase !== "playing";
}

function effectiveMisses(state: ScreenBallArcadeState): number {
  // `missed` is the historical reducer spelling; `misses` is the product/HUD
  // spelling.  Treat either one as authoritative when a caller has supplied a
  // state snapshot from another boundary.
  return Math.max(0, state.missed, state.misses);
}

function effectiveLevel(state: ScreenBallArcadeState): number {
  return Math.max(
    screenBallLevelForScore(state.score),
    Math.min(5, Math.floor(finiteNumber(state.level, 1)))
  );
}

function isBomb(ball: ScreenBall): boolean {
  return ball.kind === "bomb" || ball.color === "bomb";
}

function withTerminal(
  state: ScreenBallArcadeState,
  reason: ScreenBallTerminalReason,
  at: number
): ScreenBallArcadeState {
  if (isTerminal(state)) return state;
  const missed = effectiveMisses(state);
  const phase: ScreenBallArcadePhase =
    reason === "stopped" ? "stopped" : "settled";
  return {
    ...state,
    phase,
    status: phase,
    terminalReason: reason,
    reason,
    balls: [],
    missed,
    misses: missed,
    endedAt: at
  };
}

/**
 * Create a new, display-independent run.  `at` may be a timestamp or an
 * options object, which keeps the function convenient for deterministic tests
 * without making the normal `createState( Date.now() )` call verbose.
 */
export function createScreenBallArcadeState(
  atOrOptions: number | ScreenBallArcadeOptions = Date.now(),
  maybeOptions: ScreenBallArcadeOptions = {}
): ScreenBallArcadeState {
  const options = isOptions(atOrOptions) ? atOrOptions : maybeOptions;
  const at = isOptions(atOrOptions)
    ? finiteNumber(atOrOptions.at, Date.now())
    : finiteNumber(atOrOptions, Date.now());
  const bounds = normalizeBounds(
    options.bounds ?? { width: options.width, height: options.height }
  );
  const fallbackOrigin = {
    x: (bounds.left + bounds.right) / 2,
    y: bounds.bottom - 18
  };
  const spawnOrigin = normalizeOrigin(
    options.origin ?? options.spawnOrigin,
    fallbackOrigin
  );
  const reactionTimes: number[] = [];
  return {
    phase: "playing",
    terminalReason: null,
    status: "playing",
    reason: null,
    balls: [],
    score: 0,
    level: 1,
    missed: 0,
    misses: 0,
    reactionTimes,
    reactionSamples: reactionTimes,
    averageReactionTime: null,
    combo: 0,
    maxCombo: 0,
    lastHitAt: null,
    nextBallId: 1,
    roundStartedAt: at,
    roundEndsAt: at + SCREEN_BALL_ROUND_DURATION_MS,
    bounds,
    spawnOrigin,
    endedAt: null
  };
}

export const createScreenBallState = createScreenBallArcadeState;

function randomValue(random: () => number): number {
  const value = random();
  return clamp(finiteNumber(value, 0.5), 0, 0.999999);
}

function parseSpawnArgs(
  atOrOptions: number | ScreenBallSpawnOptions,
  randomOrOrigin: (() => number) | ScreenBallOrigin | undefined,
  maybeOrigin: ScreenBallOrigin | undefined
): Required<Pick<ScreenBallSpawnOptions, "at" | "random">> & {
  origin?: ScreenBallOrigin;
} {
  if (isOptions(atOrOptions)) {
    const options = atOrOptions as ScreenBallSpawnOptions;
    const positionalOrigin =
      typeof (atOrOptions as ScreenBallOrigin).x === "number" &&
      typeof (atOrOptions as ScreenBallOrigin).y === "number"
        ? (atOrOptions as ScreenBallOrigin)
        : undefined;
    return {
      at: finiteNumber(options.at, Date.now()),
      random:
        options.random ??
        (typeof randomOrOrigin === "function" ? randomOrOrigin : Math.random),
      origin:
        options.origin ?? options.spawnOrigin ?? positionalOrigin
    };
  }
  return {
    at: finiteNumber(atOrOptions, Date.now()),
    random:
      typeof randomOrOrigin === "function" ? randomOrOrigin : Math.random,
    origin:
      typeof randomOrOrigin === "object" ? randomOrOrigin : maybeOrigin
  };
}

/** Add one ball while preserving the level-scaled active-ball cap. */
export function spawnScreenBall(
  state: ScreenBallArcadeState,
  atOrOptions: number | ScreenBallSpawnOptions = Date.now(),
  randomOrOrigin?: (() => number) | ScreenBallOrigin,
  maybeOrigin?: ScreenBallOrigin
): ScreenBallArcadeState {
  const { at, random, origin: suppliedOrigin } = parseSpawnArgs(
    atOrOptions,
    randomOrOrigin,
    maybeOrigin
  );
  if (isTerminal(state)) return state;
  if (at >= state.roundEndsAt) return finishScreenBallForTime(state, at);
  if (effectiveMisses(state) >= SCREEN_BALL_MISS_LIMIT) {
    return withTerminal(state, "miss-limit", at);
  }
  const level = effectiveLevel(state);
  if (state.balls.length >= maxScreenBallCount(level)) return state;

  const radius = SCREEN_BALL_DEFAULT_RADIUS;
  const origin = normalizeOrigin(suppliedOrigin, state.spawnOrigin);
  const horizontalRange = 360 + (level - 1) * 70;
  const verticalBase = 520 + (level - 1) * 50;
  const verticalSpread = 120 + (level - 1) * 15;
  const bombRoll = randomValue(random);
  const isBombSpawn =
    level >= 2 && (state.nextBallId % 7 === 0 || bombRoll >= 0.97);
  const horizontalSpeed =
    -horizontalRange / 2 + randomValue(random) * horizontalRange;
  const verticalSpeed = -verticalBase - randomValue(random) * verticalSpread;
  const ball: ScreenBall = {
    id: `screen-ball-${state.nextBallId}`,
    x: origin.x,
    y: origin.y,
    vx: horizontalSpeed,
    vy: verticalSpeed,
    radius,
    createdAt: at,
    kind: isBombSpawn ? "bomb" : "ball",
    color: isBombSpawn ? "bomb" : screenBallColorForLevel(level)
  };
  return {
    ...state,
    level,
    balls: [...state.balls, ball],
    nextBallId: state.nextBallId + 1
  };
}

export const spawnScreenBallArcadeBall = spawnScreenBall;
export const spawnScreenBallBall = spawnScreenBall;

function reflectAxis(
  position: number,
  velocity: number,
  min: number,
  max: number,
  damping = 1
): [number, number] {
  if (max <= min) return [min, 0];
  let nextPosition = finiteNumber(position, (min + max) / 2);
  let nextVelocity = finiteNumber(velocity, 0);
  // A capped physics step keeps this loop tiny in normal use; the guard also
  // makes malformed/injected velocities safe for a caller.
  for (let count = 0; count < 8; count += 1) {
    const atLeft = nextPosition < min || (nextPosition === min && nextVelocity < 0);
    const atRight =
      nextPosition > max || (nextPosition === max && nextVelocity > 0);
    if (atLeft) {
      nextPosition = min + (min - nextPosition);
      nextVelocity = Math.abs(nextVelocity) * damping;
      continue;
    }
    if (atRight) {
      nextPosition = max - (nextPosition - max);
      nextVelocity = -Math.abs(nextVelocity) * damping;
      continue;
    }
    break;
  }
  return [
    clamp(nextPosition, min, max),
    Number.isFinite(nextVelocity) ? nextVelocity : 0
  ];
}

function movedBall(
  ball: ScreenBall,
  elapsedMs: number,
  bounds: ScreenBallBounds
): ScreenBall | null {
  const elapsedSeconds = Math.max(0, Math.min(elapsedMs, 1_000)) / 1_000;
  const radius = Math.max(0, finiteNumber(ball.radius, SCREEN_BALL_DEFAULT_RADIUS));
  let x = ball.x + ball.vx * elapsedSeconds;
  let y = ball.y + ball.vy * elapsedSeconds;

  // A ball is lost when its *top* edge has passed the bottom edge of the work
  // area.  It never bounces from the bottom.
  if (y - radius > bounds.bottom) return null;

  let vx = ball.vx;
  let vy = ball.vy;
  [x, vx] = reflectAxis(
    x,
    vx,
    bounds.left + radius,
    bounds.right - radius
  );
  // Only the top edge reflects.  In particular, do not use the bottom as the
  // upper bound here: a ball may be below the bottom edge while its top edge
  // is still visible, and should continue falling until it is fully gone.
  const topBoundary = bounds.top + radius;
  if (y < topBoundary || (y === topBoundary && vy < 0)) {
    y = topBoundary + (topBoundary - y);
    vy = Math.abs(vy) * SCREEN_BALL_BOUNCE_DAMPING;
  }
  vy += SCREEN_BALL_GRAVITY * elapsedSeconds;

  x = finiteNumber(x, ball.x);
  y = finiteNumber(y, ball.y);
  vx = finiteNumber(vx, ball.vx);
  vy = finiteNumber(vy, ball.vy);
  if (
    Object.is(x, ball.x) &&
    Object.is(y, ball.y) &&
    Object.is(vx, ball.vx) &&
    Object.is(vy, ball.vy)
  ) {
    return ball;
  }
  return { ...ball, x, y, vx, vy };
}

function finishScreenBallForTime(
  state: ScreenBallArcadeState,
  at: number
): ScreenBallArcadeState {
  return withTerminal(state, "perfect-finish", at);
}

/** Advance physics and apply absolute deadline/miss-limit settlement. */
export function advanceScreenBallState(
  state: ScreenBallArcadeState,
  elapsedMs: number,
  at = Date.now()
): ScreenBallArcadeState {
  if (isTerminal(state)) return state;
  const now = finiteNumber(at, Date.now());
  const startingMisses = effectiveMisses(state);
  if (startingMisses >= SCREEN_BALL_MISS_LIMIT) {
    return withTerminal(state, "miss-limit", now);
  }
  if (now >= state.roundEndsAt) return finishScreenBallForTime(state, now);

  const safeElapsedMs = Math.max(0, finiteNumber(elapsedMs, 0));
  const comboExpired =
    state.lastHitAt !== null && now - state.lastHitAt > SCREEN_BALL_COMBO_WINDOW_MS;
  const movedBalls: ScreenBall[] = [];
  let lost = 0;
  for (const ball of state.balls) {
    const nextBall = movedBall(ball, safeElapsedMs, state.bounds);
    if (nextBall === null) lost += 1;
    else movedBalls.push(nextBall);
  }

  const nextMissed = startingMisses + lost;
  const anyBallChanged =
    movedBalls.length !== state.balls.length ||
    movedBalls.some((ball, index) => ball !== state.balls[index]);
  if (
    lost === 0 &&
    !anyBallChanged &&
    !comboExpired &&
    nextMissed < SCREEN_BALL_MISS_LIMIT
  ) {
    return state;
  }

  const nextState: ScreenBallArcadeState = {
    ...state,
    balls: movedBalls,
    missed: nextMissed,
    misses: nextMissed,
    combo: comboExpired ? 0 : state.combo,
    lastHitAt: comboExpired ? null : state.lastHitAt
  };
  if (nextMissed >= SCREEN_BALL_MISS_LIMIT) {
    return withTerminal(nextState, "miss-limit", now);
  }
  return nextState;
}

export const advanceScreenBallArcadeState = advanceScreenBallState;

/** Score one ball from reaction time. Faster (smaller) times always score more. */
export function scoreForScreenBallReaction(
  reactionTimeMs: number,
  combo = 1
): number {
  const reaction = Math.max(0, finiteNumber(reactionTimeMs, SCREEN_BALL_REACTION_WINDOW_MS));
  const progress = clamp(
    1 - reaction / SCREEN_BALL_REACTION_WINDOW_MS,
    0,
    1
  );
  const base = Math.round(
    SCREEN_BALL_MIN_SCORE +
      (SCREEN_BALL_MAX_SCORE - SCREEN_BALL_MIN_SCORE) * progress
  );
  const multiplier = 1 + Math.max(0, combo - 1) * SCREEN_BALL_COMBO_STEP;
  return Math.max(0, Math.round(base * multiplier));
}

export const screenBallScoreForReaction = scoreForScreenBallReaction;

/** Hit an active ball, record its reaction sample, and remove it immediately. */
export function hitScreenBall(
  state: ScreenBallArcadeState,
  ballId: string,
  at = Date.now()
): ScreenBallArcadeState {
  if (isTerminal(state)) return state;
  const now = finiteNumber(at, Date.now());
  if (now >= state.roundEndsAt) return finishScreenBallForTime(state, now);
  if (effectiveMisses(state) >= SCREEN_BALL_MISS_LIMIT) {
    return withTerminal(state, "miss-limit", now);
  }
  const target = state.balls.find((ball) => ball.id === ballId);
  if (!target) return state;

  if (isBomb(target)) {
    return withTerminal(state, "bomb-hit", now);
  }

  const reactionTime = Math.max(0, now - target.createdAt);
  const inComboWindow =
    state.lastHitAt !== null &&
    now - state.lastHitAt <= SCREEN_BALL_COMBO_WINDOW_MS;
  const combo = inComboWindow ? state.combo + 1 : 1;
  const reactionTimes = [...state.reactionTimes, reactionTime];
  const averageReactionTime =
    reactionTimes.reduce((total, sample) => total + sample, 0) /
    reactionTimes.length;
  const score = scoreForScreenBallReaction(reactionTime, combo);
  const nextScore = state.score + score;
  return {
    ...state,
    balls: state.balls.filter((ball) => ball.id !== ballId),
    score: nextScore,
    level: Math.max(effectiveLevel(state), screenBallLevelForScore(nextScore)),
    reactionTimes,
    reactionSamples: reactionTimes,
    averageReactionTime,
    combo,
    maxCombo: Math.max(state.maxCombo, combo),
    lastHitAt: now
  };
}

export const hitScreenBallArcadeBall = hitScreenBall;

export function averageScreenBallReactionTime(
  state: ScreenBallArcadeState
): number | null {
  return state.averageReactionTime;
}

export const getAverageScreenBallReactionTime = averageScreenBallReactionTime;
export const getScreenBallAverageReactionTime = averageScreenBallReactionTime;

/** Voluntary termination. Calling stop again (or after natural settlement) is a no-op. */
export function stopScreenBall(
  state: ScreenBallArcadeState,
  at = Date.now()
): ScreenBallArcadeState {
  if (isTerminal(state)) return state;
  return withTerminal(state, "stopped", finiteNumber(at, Date.now()));
}

export const stopScreenBallArcade = stopScreenBall;
export const stopScreenBallState = stopScreenBall;

export function remainingScreenBallSeconds(
  state: ScreenBallArcadeState,
  at = Date.now()
): number {
  return Math.max(
    0,
    Math.ceil((state.roundEndsAt - finiteNumber(at, Date.now())) / 1_000)
  );
}
