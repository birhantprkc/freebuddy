import { BOARD_SIZE, checkWin, coordToString } from "./gomokuEngine.js";

export interface GomokuSearchOptions {
  maxDepth?: number;
  timeBudgetMs?: number;
}

export interface GomokuEngineSuggestion {
  actionId: string;
  x: number;
  y: number;
  score: number;
  reason: string;
  depthReached: number;
}

const SCORE_FIVE = 10_000_000;
const SCORE_LIVE_FOUR = 800_000;
const SCORE_RUSH_FOUR = 120_000;
const SCORE_LIVE_THREE = 90_000;
const SCORE_SLEEP_THREE = 12_000;
const SCORE_LIVE_TWO = 3_000;
const SCORE_SLEEP_TWO = 400;
const SCORE_ONE = 60;

const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1]
];

function opponentOf(player: number): number {
  return player === 1 ? 2 : 1;
}

function inBoard(x: number, y: number): boolean {
  return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
}

export function patternScore(count: number, openEnds: number): number {
  if (count >= 5) return SCORE_FIVE;
  switch (count) {
    case 4:
      if (openEnds >= 2) return SCORE_LIVE_FOUR;
      if (openEnds === 1) return SCORE_RUSH_FOUR;
      return 0;
    case 3:
      if (openEnds >= 2) return SCORE_LIVE_THREE;
      if (openEnds === 1) return SCORE_SLEEP_THREE;
      return 0;
    case 2:
      if (openEnds >= 2) return SCORE_LIVE_TWO;
      if (openEnds === 1) return SCORE_SLEEP_TWO;
      return 0;
    default:
      return openEnds > 0 ? SCORE_ONE : 0;
  }
}

interface SideScan {
  stones: number;
  openEnd: boolean;
}

function scanSide(
  board: number[][],
  x: number,
  y: number,
  dx: number,
  dy: number,
  player: number
): SideScan {
  let stones = 0;
  let cx = x + dx;
  let cy = y + dy;
  while (inBoard(cx, cy) && board[cy][cx] === player) {
    stones++;
    cx += dx;
    cy += dy;
  }
  const openEnd = inBoard(cx, cy) && board[cy][cx] === 0;
  return { stones, openEnd };
}

function directionScore(
  board: number[][],
  x: number,
  y: number,
  dx: number,
  dy: number,
  player: number
): number {
  const fwd = scanSide(board, x, y, dx, dy, player);
  const bwd = scanSide(board, x, y, -dx, -dy, player);
  const count = 1 + fwd.stones + bwd.stones;
  const openEnds = (fwd.openEnd ? 1 : 0) + (bwd.openEnd ? 1 : 0);
  let best = patternScore(count, openEnds);

  if (fwd.openEnd) {
    const gapX = x + dx * (fwd.stones + 1);
    const gapY = y + dy * (fwd.stones + 1);
    const beyondX = gapX + dx;
    const beyondY = gapY + dy;
    if (inBoard(beyondX, beyondY) && board[beyondY][beyondX] === player) {
      const chain = scanSide(board, gapX, gapY, dx, dy, player);
      const merged = count + 1 + chain.stones;
      best = Math.max(
        best,
        patternScore(merged, (bwd.openEnd ? 1 : 0) + (chain.openEnd ? 1 : 0)) *
          0.85
      );
    }
  }

  if (bwd.openEnd) {
    const gapX = x - dx * (bwd.stones + 1);
    const gapY = y - dy * (bwd.stones + 1);
    const beyondX = gapX - dx;
    const beyondY = gapY - dy;
    if (inBoard(beyondX, beyondY) && board[beyondY][beyondX] === player) {
      const chain = scanSide(board, gapX, gapY, -dx, -dy, player);
      const merged = count + 1 + chain.stones;
      best = Math.max(
        best,
        patternScore(merged, (fwd.openEnd ? 1 : 0) + (chain.openEnd ? 1 : 0)) *
          0.85
      );
    }
  }

  return best;
}

export function pointScore(
  board: number[][],
  x: number,
  y: number,
  player: number
): number {
  let total = 0;
  for (const [dx, dy] of DIRECTIONS) {
    const s = directionScore(board, x, y, dx, dy, player);
    if (s >= SCORE_FIVE) return SCORE_FIVE;
    total += s;
  }
  return total;
}

function quickMoveScore(
  board: number[][],
  x: number,
  y: number,
  player: number
): number {
  const self = pointScore(board, x, y, player);
  const opp = pointScore(board, x, y, opponentOf(player));
  return self + Math.floor(opp * 1.05);
}

function candidateCells(board: number[][]): { x: number; y: number }[] {
  let hasStone = false;
  const cells = new Map<string, { x: number; y: number }>();
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] === 0) continue;
      hasStone = true;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (inBoard(nx, ny) && board[ny][nx] === 0) {
            cells.set(`${nx},${ny}`, { x: nx, y: ny });
          }
        }
      }
    }
  }
  if (!hasStone) {
    const center = Math.floor(BOARD_SIZE / 2);
    return [{ x: center, y: center }];
  }
  return [...cells.values()];
}

interface LineCoord {
  x: number;
  y: number;
}

let cachedLines: LineCoord[][] | null = null;

function allLines(): LineCoord[][] {
  if (cachedLines) return cachedLines;
  const lines: LineCoord[][] = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    const line: LineCoord[] = [];
    for (let x = 0; x < BOARD_SIZE; x++) line.push({ x, y });
    lines.push(line);
  }
  for (let x = 0; x < BOARD_SIZE; x++) {
    const line: LineCoord[] = [];
    for (let y = 0; y < BOARD_SIZE; y++) line.push({ x, y });
    lines.push(line);
  }
  for (let start = -(BOARD_SIZE - 5); start <= BOARD_SIZE - 5; start++) {
    const line: LineCoord[] = [];
    for (let i = 0; i < BOARD_SIZE; i++) {
      const x = start + i;
      const y = i;
      if (inBoard(x, y)) line.push({ x, y });
    }
    if (line.length >= 5) lines.push(line);
  }
  for (let start = 4; start <= 2 * (BOARD_SIZE - 5) + 4; start++) {
    const line: LineCoord[] = [];
    for (let i = 0; i < BOARD_SIZE; i++) {
      const x = start - i;
      const y = i;
      if (inBoard(x, y)) line.push({ x, y });
    }
    if (line.length >= 5) lines.push(line);
  }
  cachedLines = lines;
  return lines;
}

export function evaluateBoard(board: number[][], mover: number): number {
  let total = 0;
  for (const line of allLines()) {
    let i = 0;
    while (i < line.length) {
      const startCoord = line[i];
      const player = board[startCoord.y][startCoord.x];
      if (player === 0) {
        i++;
        continue;
      }

      const start = i;
      while (i < line.length) {
        const coord = line[i];
        if (board[coord.y][coord.x] !== player) break;
        i++;
      }
      const runLen = i - start;
      const before = start > 0 ? line[start - 1] : undefined;
      const after = i < line.length ? line[i] : undefined;
      const openEnds =
        (before && board[before.y][before.x] === 0 ? 1 : 0) +
        (after && board[after.y][after.x] === 0 ? 1 : 0);
      const score = patternScore(runLen, openEnds);
      total += player === mover ? score : -Math.round(score * 1.1);
    }
  }
  return total;
}

interface AbortFlag {
  aborted: boolean;
}

function negamax(
  board: number[][],
  depth: number,
  alpha: number,
  beta: number,
  player: number,
  deadline: number,
  ply: number,
  abort: AbortFlag
): number {
  if (abort.aborted) return 0;
  if (Date.now() > deadline) {
    abort.aborted = true;
    return 0;
  }
  if (depth <= 0) return evaluateBoard(board, player);

  const moves = candidateCells(board)
    .map((c) => ({ c, s: quickMoveScore(board, c.x, c.y, player) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, depth >= 3 ? 10 : 14);

  let best = -Infinity;
  let a = alpha;
  for (const { c } of moves) {
    board[c.y][c.x] = player;
    let val: number;
    if (checkWin(board, c.x, c.y, player)) {
      val = SCORE_FIVE - ply * 100;
    } else {
      val = -negamax(
        board,
        depth - 1,
        -beta,
        -a,
        opponentOf(player),
        deadline,
        ply + 1,
        abort
      );
    }
    board[c.y][c.x] = 0;
    if (val > best) best = val;
    if (best > a) a = best;
    if (a >= beta || abort.aborted) break;
  }
  return best;
}

function describeMove(
  board: number[][],
  x: number,
  y: number,
  player: number,
  forcedBlock: boolean,
  score: number,
  depth: number
): string {
  if (score >= SCORE_FIVE - 1000) return "连五制胜";
  if (forcedBlock) return "封堵对方连五威胁";
  const ownBest = Math.max(
    ...DIRECTIONS.map(([dx, dy]) => directionScore(board, x, y, dx, dy, player))
  );
  const oppBest = Math.max(
    ...DIRECTIONS.map(([dx, dy]) =>
      directionScore(board, x, y, dx, dy, opponentOf(player))
    )
  );
  if (ownBest >= SCORE_LIVE_FOUR) return "形成活四";
  if (ownBest >= SCORE_RUSH_FOUR) return "冲四施压";
  if (ownBest >= SCORE_LIVE_THREE) return "构建活三攻势";
  if (oppBest >= SCORE_LIVE_THREE) return "压制对方主要连线";
  return `局部搜索最优着法(深度${depth})`;
}

export function findBestMove(
  board: number[][],
  player: number,
  options?: GomokuSearchOptions
): GomokuEngineSuggestion | null {
  const maxDepth = Math.min(Math.max(options?.maxDepth ?? 6, 2), 8);
  const timeBudgetMs = options?.timeBudgetMs ?? 750;
  const deadline = Date.now() + timeBudgetMs;
  const opponent = opponentOf(player);

  const candidates = candidateCells(board);
  if (candidates.length === 0) return null;

  const winningCell = candidates.find((c) => {
    board[c.y][c.x] = player;
    const won = checkWin(board, c.x, c.y, player);
    board[c.y][c.x] = 0;
    return won;
  });
  if (winningCell) {
    return {
      actionId: coordToString(winningCell.x, winningCell.y),
      x: winningCell.x,
      y: winningCell.y,
      score: SCORE_FIVE,
      reason: "连五制胜",
      depthReached: 0
    };
  }

  const blockCandidates = candidates.filter((c) => {
    board[c.y][c.x] = opponent;
    const won = checkWin(board, c.x, c.y, opponent);
    board[c.y][c.x] = 0;
    return won;
  });
  if (blockCandidates.length > 0) {
    let bestBlock = blockCandidates[0];
    let bestScore = -Infinity;
    for (const c of blockCandidates) {
      const s = quickMoveScore(board, c.x, c.y, player);
      if (s > bestScore) {
        bestScore = s;
        bestBlock = c;
      }
    }
    return {
      actionId: coordToString(bestBlock.x, bestBlock.y),
      x: bestBlock.x,
      y: bestBlock.y,
      score: bestScore,
      reason: "封堵对方连五威胁",
      depthReached: 0
    };
  }

  const scoredRoot = candidates
    .map((c) => ({ c, s: quickMoveScore(board, c.x, c.y, player) }))
    .sort((a, b) => b.s - a.s);

  let bestCell = scoredRoot[0]?.c;
  let bestScore = scoredRoot[0]?.s ?? 0;
  let completedDepth = 0;

  for (let depth = 2; depth <= maxDepth; depth += 2) {
    const abort: AbortFlag = { aborted: false };
    const width = depth <= 2 ? 16 : depth <= 4 ? 12 : 10;
    let iterBest: { x: number; y: number } | null = null;
    let iterScore = -Infinity;
    let alpha = -Infinity;

    for (const { c } of scoredRoot.slice(0, width)) {
      if (Date.now() > deadline) {
        abort.aborted = true;
        break;
      }
      board[c.y][c.x] = player;
      let val: number;
      if (checkWin(board, c.x, c.y, player)) {
        val = SCORE_FIVE - 1;
      } else {
        val = -negamax(
          board,
          depth - 1,
          -Infinity,
          -alpha,
          opponent,
          deadline,
          1,
          abort
        );
      }
      board[c.y][c.x] = 0;
      if (val > iterScore) {
        iterScore = val;
        iterBest = c;
        alpha = val;
      }
      if (abort.aborted) break;
    }

    if (iterBest && !abort.aborted) {
      bestCell = iterBest;
      bestScore = iterScore;
      completedDepth = depth;
    }
    if (abort.aborted) break;
  }

  if (!bestCell) return null;

  return {
    actionId: coordToString(bestCell.x, bestCell.y),
    x: bestCell.x,
    y: bestCell.y,
    score: bestScore,
    reason: describeMove(
      board,
      bestCell.x,
      bestCell.y,
      player,
      false,
      bestScore,
      Math.max(completedDepth, 2)
    ),
    depthReached: completedDepth
  };
}
