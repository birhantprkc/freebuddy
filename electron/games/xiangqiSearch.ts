import type { GameMoveRecord } from "../shared/gameToolProtocol.js";
import {
  PIECE_ADVISOR,
  PIECE_BISHOP,
  PIECE_CANNON,
  PIECE_KING,
  PIECE_KNIGHT,
  PIECE_PAWN,
  PIECE_ROOK,
  PLAYER_BLACK,
  PLAYER_RED,
  getLegalMoves,
  getPieceName,
  isKingInCheck,
  moveToString,
  pieceValue,
  toChineseNotation,
  xiangqiPositionKey,
  type RawXiangqiMove
} from "./xiangqiEngine.js";

export interface XiangqiSearchOptions {
  maxDepth?: number;
  timeBudgetMs?: number;
  positionHistory?: string[];
  recentMoves?: GameMoveRecord[];
}

export interface XiangqiEngineSuggestion {
  actionId: string;
  score: number;
  reason: string;
  depthReached: number;
}

const MATE_SCORE = 10_000_000;

function opponentOf(player: number): number {
  return player === PLAYER_RED ? PLAYER_BLACK : PLAYER_RED;
}

function applyMove(board: number[][], move: RawXiangqiMove): number {
  const captured = board[move.toY][move.toX];
  board[move.toY][move.toX] = move.piece;
  board[move.fromY][move.fromX] = 0;
  return captured;
}

function undoMove(board: number[][], move: RawXiangqiMove, captured: number): void {
  board[move.fromY][move.fromX] = move.piece;
  board[move.toY][move.toX] = captured;
}

function movesEqual(a: RawXiangqiMove | null | undefined, b: RawXiangqiMove | null | undefined): boolean {
  if (!a || !b) return false;
  return a.fromX === b.fromX && a.fromY === b.fromY && a.toX === b.toX && a.toY === b.toY;
}

// ---------------------------------------------------------------------------
// Piece-Square Tables (PST) for Red (y=0..9, x=0..8).
// For Black pieces, coordinates are vertically mirrored: y' = 9 - y.
// ---------------------------------------------------------------------------
const PAWN_PST = [
  [  0,   0,   0,   0,   0,   0,   0,   0,   0], // y = 0
  [  0,   0,   0,   0,   0,   0,   0,   0,   0], // y = 1
  [  0,   0,   0,   0,   0,   0,   0,   0,   0], // y = 2
  [  0,   0,   5,   0,  12,   0,   5,   0,   0], // y = 3 (initial rank)
  [ 10,  15,  25,  35,  40,  35,  25,  15,  10], // y = 4 (river bank)
  [ 55,  70,  90, 110, 120, 110,  90,  70,  55], // y = 5 (crossed river)
  [ 70,  90, 115, 135, 145, 135, 115,  90,  70], // y = 6
  [ 80, 105, 130, 150, 160, 150, 130, 105,  80], // y = 7 (approaching palace)
  [ 80, 105, 130, 150, 160, 150, 130, 105,  80], // y = 8
  [ 40,  50,  60,  70,  70,  70,  60,  50,  40]  // y = 9 (bottom rank)
];

const KNIGHT_PST = [
  [  0, -10,   0,   0,   0,   0,   0, -10,   0], // y = 0
  [  0,   5,  10,  15,  10,  15,  10,   5,   0], // y = 1
  [  5,  15,  25,  30,  20,  30,  25,  15,   5], // y = 2
  [ 10,  25,  35,  45,  35,  45,  35,  25,  10], // y = 3
  [ 15,  30,  40,  50,  40,  50,  40,  30,  15], // y = 4
  [ 20,  35,  50,  60,  45,  60,  50,  35,  20], // y = 5
  [ 20,  40,  55,  65,  50,  65,  55,  40,  20], // y = 6 (cross-river threats)
  [ 15,  35,  50,  60,  40,  60,  50,  35,  15], // y = 7
  [ 10,  20,  35,  45,  30,  45,  35,  20,  10], // y = 8
  [  0,   5,  15,  20,  15,  20,  15,   5,   0]  // y = 9
];

const CANNON_PST = [
  [  0,   0,   5,   0,  15,   0,   5,   0,   0], // y = 0
  [  0,   5,  10,  10,  15,  10,  10,   5,   0], // y = 1
  [  5,  15,  15,  20,  35,  20,  15,  15,   5], // y = 2 (central cannon bonus)
  [  5,  10,  15,  25,  30,  25,  15,  10,   5], // y = 3
  [  5,  15,  20,  30,  35,  30,  20,  15,   5], // y = 4
  [  5,  15,  25,  30,  30,  30,  25,  15,   5], // y = 5
  [  5,  15,  20,  25,  25,  25,  20,  15,   5], // y = 6
  [ 10,  15,  20,  20,  20,  20,  20,  15,  10], // y = 7
  [ 10,  15,  20,  20,  20,  20,  20,  15,  10], // y = 8
  [ 15,  20,  25,  30,  30,  30,  25,  20,  15]  // y = 9 (bottom rank cannon)
];

const ROOK_PST = [
  [  0,  10,   5,  15,  10,  15,   5,  10,   0], // y = 0
  [ 10,  20,  15,  25,  20,  25,  15,  20,  10], // y = 1
  [ 15,  25,  25,  30,  30,  30,  25,  25,  15], // y = 2
  [ 20,  30,  30,  35,  35,  35,  30,  30,  20], // y = 3
  [ 25,  35,  35,  40,  40,  40,  35,  35,  25], // y = 4
  [ 30,  40,  40,  45,  45,  45,  40,  40,  30], // y = 5
  [ 35,  45,  45,  50,  50,  50,  45,  45,  35], // y = 6
  [ 40,  55,  55,  60,  60,  60,  55,  55,  40], // y = 7 (throat/pressure line)
  [ 40,  50,  50,  55,  55,  55,  50,  50,  40], // y = 8
  [ 35,  45,  45,  50,  50,  50,  45,  45,  35]  // y = 9
];

const ADVISOR_PST = [
  [  0,   0,   0,  10,   0,  10,   0,   0,   0], // y = 0
  [  0,   0,   0,   0,  20,   0,   0,   0,   0], // y = 1
  [  0,   0,   0,  10,   0,  10,   0,   0,   0], // y = 2
  [  0,   0,   0,   0,   0,   0,   0,   0,   0],
  [  0,   0,   0,   0,   0,   0,   0,   0,   0],
  [  0,   0,   0,   0,   0,   0,   0,   0,   0],
  [  0,   0,   0,   0,   0,   0,   0,   0,   0],
  [  0,   0,   0,   0,   0,   0,   0,   0,   0],
  [  0,   0,   0,   0,   0,   0,   0,   0,   0],
  [  0,   0,   0,   0,   0,   0,   0,   0,   0]
];

const BISHOP_PST = [
  [  0,   0,  10,   0,   0,   0,  10,   0,   0], // y = 0
  [  0,   0,   0,   0,   0,   0,   0,   0,   0], // y = 1
  [  5,   0,   0,   0,  20,   0,   0,   0,   5], // y = 2
  [  0,   0,   0,   0,   0,   0,   0,   0,   0], // y = 3
  [  0,   0,  10,   0,   0,   0,  10,   0,   0], // y = 4
  [  0,   0,   0,   0,   0,   0,   0,   0,   0],
  [  0,   0,   0,   0,   0,   0,   0,   0,   0],
  [  0,   0,   0,   0,   0,   0,   0,   0,   0],
  [  0,   0,   0,   0,   0,   0,   0,   0,   0],
  [  0,   0,   0,   0,   0,   0,   0,   0,   0]
];

const KING_PST = [
  [  0,   0,   0,   5,  10,   5,   0,   0,   0], // y = 0
  [  0,   0,   0,   0,   5,   0,   0,   0,   0], // y = 1
  [  0,   0,   0,  -5,  -5,  -5,   0,   0,   0], // y = 2
  [  0,   0,   0,   0,   0,   0,   0,   0,   0],
  [  0,   0,   0,   0,   0,   0,   0,   0,   0],
  [  0,   0,   0,   0,   0,   0,   0,   0,   0],
  [  0,   0,   0,   0,   0,   0,   0,   0,   0],
  [  0,   0,   0,   0,   0,   0,   0,   0,   0],
  [  0,   0,   0,   0,   0,   0,   0,   0,   0],
  [  0,   0,   0,   0,   0,   0,   0,   0,   0]
];

function positionalValue(piece: number, x: number, y: number): number {
  const abs = Math.abs(piece);
  const isRed = piece > 0;
  const rank = isRed ? y : 9 - y;
  const file = x;

  if (rank < 0 || rank >= 10 || file < 0 || file >= 9) return 0;

  switch (abs) {
    case PIECE_PAWN:
      return PAWN_PST[rank][file];
    case PIECE_KNIGHT:
      return KNIGHT_PST[rank][file];
    case PIECE_CANNON:
      return CANNON_PST[rank][file];
    case PIECE_ROOK:
      return ROOK_PST[rank][file];
    case PIECE_ADVISOR:
      return ADVISOR_PST[rank][file];
    case PIECE_BISHOP:
      return BISHOP_PST[rank][file];
    case PIECE_KING:
      return KING_PST[rank][file];
    default:
      return 0;
  }
}

export function evaluateXiangqiBoard(board: number[][], player: number): number {
  let score = 0;
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 9; x++) {
      const piece = board[y][x];
      if (piece === 0) continue;
      const value = pieceValue(piece) + positionalValue(piece, x, y);
      const own = player === PLAYER_RED ? piece > 0 : piece < 0;
      score += own ? value : -value;
    }
  }
  if (isKingInCheck(board, player)) score -= 180;
  if (isKingInCheck(board, opponentOf(player))) score += 180;
  return score;
}

// ---------------------------------------------------------------------------
// Zobrist Hashing for O(1) Transposition Table Keys
// ---------------------------------------------------------------------------
class DeterministicPRNG {
  private s: bigint;
  constructor(seed = 1070372n) {
    this.s = seed;
  }
  next(): bigint {
    this.s = (this.s + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
    let z = this.s;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
    return (z ^ (z >> 31n)) & 0xffffffffffffffffn;
  }
}

const prng = new DeterministicPRNG();
const ZOBRIST_PIECES: bigint[][] = Array.from({ length: 15 }, () =>
  Array.from({ length: 90 }, () => prng.next())
);
const ZOBRIST_TURN = prng.next();

function pieceToIndex(piece: number): number {
  if (piece === 0) return 0;
  return piece > 0 ? piece : Math.abs(piece) + 7;
}

function computeZobristHash(board: number[][], turn: number): bigint {
  let hash = turn === PLAYER_RED ? 0n : ZOBRIST_TURN;
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 9; x++) {
      const piece = board[y][x];
      if (piece !== 0) {
        hash ^= ZOBRIST_PIECES[pieceToIndex(piece)][y * 9 + x];
      }
    }
  }
  return hash;
}

// ---------------------------------------------------------------------------
// Transposition Table
// ---------------------------------------------------------------------------
const TT_SIZE = 1 << 18; // 262,144 entries
const TT_MASK = BigInt(TT_SIZE - 1);

export const FLAG_EXACT = 0;
export const FLAG_LOWERBOUND = 1;
export const FLAG_UPPERBOUND = 2;

export interface TTEntry {
  hashKey: bigint;
  depth: number;
  score: number;
  flag: number;
  bestMove?: RawXiangqiMove;
}

const transpositionTable: (TTEntry | null)[] = new Array(TT_SIZE).fill(null);

// ---------------------------------------------------------------------------
// Move Ordering and Scoring
// ---------------------------------------------------------------------------
function moveOrderScore(board: number[][], move: RawXiangqiMove, player: number): number {
  const captured = move.captured === undefined ? 0 : pieceValue(move.captured);
  const mover = pieceValue(move.piece);
  const center = 4 - Math.abs(4 - move.toX);
  const taken = applyMove(board, move);
  const givesCheck = isKingInCheck(board, opponentOf(player));
  undoMove(board, move, taken);
  return captured * 20 - (captured > 0 ? Math.floor(mover / 20) : 0) +
    (givesCheck ? 20_000 : 0) + center * 8;
}

export function orderedMoves(board: number[][], player: number, depth: number): RawXiangqiMove[] {
  void depth;
  return getLegalMoves(board, player).sort(
    (a, b) => moveOrderScore(board, b, player) - moveOrderScore(board, a, player)
  );
}

interface SearchState {
  deadline: number;
  aborted: boolean;
  killerMoves: [RawXiangqiMove | null, RawXiangqiMove | null][];
  historyTable: number[][][];
  history: bigint[];
}

function scoreMoveForOrdering(
  board: number[][],
  move: RawXiangqiMove,
  player: number,
  ply: number,
  ttMove: RawXiangqiMove | undefined,
  state: SearchState
): number {
  if (movesEqual(move, ttMove)) {
    return 500_000;
  }

  const captured = move.captured !== undefined && move.captured !== 0 ? pieceValue(move.captured) : 0;
  const moverVal = pieceValue(move.piece);

  if (captured > 0) {
    // MVV-LVA for captures
    return 100_000 + captured * 20 - Math.floor(moverVal / 20);
  }

  // Killer move heuristics
  if (ply < state.killerMoves.length) {
    if (movesEqual(state.killerMoves[ply][0], move)) return 80_000;
    if (movesEqual(state.killerMoves[ply][1], move)) return 70_000;
  }

  // Check giving bonus
  const taken = applyMove(board, move);
  const givesCheck = isKingInCheck(board, opponentOf(player));
  undoMove(board, move, taken);
  if (givesCheck) return 50_000;

  // History heuristic
  const pIdx = pieceToIndex(move.piece);
  const fromIdx = move.fromY * 9 + move.fromX;
  const toIdx = move.toY * 9 + move.toX;
  const historyScore = state.historyTable[pIdx]?.[fromIdx]?.[toIdx] ?? 0;

  // Positional delta
  const posDelta = positionalValue(move.piece, move.toX, move.toY) -
                   positionalValue(move.piece, move.fromX, move.fromY);

  return historyScore + posDelta;
}

function advancedOrderedMoves(
  board: number[][],
  moves: RawXiangqiMove[],
  player: number,
  ply: number,
  ttMove: RawXiangqiMove | undefined,
  state: SearchState
): RawXiangqiMove[] {
  return moves.sort(
    (a, b) =>
      scoreMoveForOrdering(board, b, player, ply, ttMove, state) -
      scoreMoveForOrdering(board, a, player, ply, ttMove, state)
  );
}

// ---------------------------------------------------------------------------
// Quiescence Search (Q-Search to eliminate Horizon Effect)
// ---------------------------------------------------------------------------
function quiescenceSearch(
  board: number[][],
  player: number,
  alpha: number,
  beta: number,
  ply: number,
  qdepth: number,
  state: SearchState
): number {
  if (Date.now() >= state.deadline) {
    state.aborted = true;
    return 0;
  }

  const inCheck = isKingInCheck(board, player);
  const standPat = evaluateXiangqiBoard(board, player);

  if (!inCheck) {
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
  }

  if (qdepth <= 0) return standPat;

  const opponent = opponentOf(player);
  const allMoves = getLegalMoves(board, player);
  if (allMoves.length === 0) {
    return inCheck ? -MATE_SCORE + ply * 100 : 0;
  }

  // In check: must search evasions; Not in check: search captures only
  const candidateMoves = inCheck
    ? allMoves
    : allMoves.filter((m) => m.captured !== undefined && m.captured !== 0);

  if (candidateMoves.length === 0) {
    return standPat;
  }

  // MVV-LVA sort for Q-Search
  candidateMoves.sort((a, b) => {
    const capA = a.captured ? pieceValue(a.captured) : 0;
    const capB = b.captured ? pieceValue(b.captured) : 0;
    const movA = pieceValue(a.piece);
    const movB = pieceValue(b.piece);
    return capB * 20 - Math.floor(movB / 20) - (capA * 20 - Math.floor(movA / 20));
  });

  for (const move of candidateMoves) {
    if (!inCheck && move.captured !== undefined && move.captured !== 0) {
      const capVal = pieceValue(move.captured);
      if (standPat + capVal + 150 < alpha) {
        continue; // Delta pruning
      }
    }

    const captured = applyMove(board, move);
    const score = -quiescenceSearch(
      board,
      opponent,
      -beta,
      -alpha,
      ply + 1,
      qdepth - 1,
      state
    );
    undoMove(board, move, captured);

    if (state.aborted) return 0;
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }

  return alpha;
}

// ---------------------------------------------------------------------------
// Negamax Search with Alpha-Beta, TT, and Q-Search
// ---------------------------------------------------------------------------
function negamax(
  board: number[][],
  player: number,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  hashKey: bigint,
  state: SearchState
): number {
  if (Date.now() >= state.deadline) {
    state.aborted = true;
    return 0;
  }

  const ttIndex = Number(hashKey & TT_MASK);
  const ttEntry = transpositionTable[ttIndex];
  let ttMove: RawXiangqiMove | undefined;

  if (ttEntry && ttEntry.hashKey === hashKey) {
    ttMove = ttEntry.bestMove;
    if (ttEntry.depth >= depth && ply > 0) {
      const score = ttEntry.score;
      if (ttEntry.flag === FLAG_EXACT) return score;
      if (ttEntry.flag === FLAG_LOWERBOUND && score >= beta) return score;
      if (ttEntry.flag === FLAG_UPPERBOUND && score <= alpha) return score;
    }
  }

  if (depth <= 0) {
    return quiescenceSearch(board, player, alpha, beta, ply, 6, state);
  }

  const moves = getLegalMoves(board, player);
  if (moves.length === 0) {
    const inCheck = isKingInCheck(board, player);
    return inCheck ? -MATE_SCORE + ply * 100 : 0;
  }

  const sortedMoves = advancedOrderedMoves(board, moves, player, ply, ttMove, state);
  let bestScore = -Infinity;
  let bestMove: RawXiangqiMove | undefined = sortedMoves[0];
  const initialAlpha = alpha;
  let localAlpha = alpha;
  const opponent = opponentOf(player);

  state.history.push(hashKey);

  for (const move of sortedMoves) {
    const fromIdx = move.fromY * 9 + move.fromX;
    const toIdx = move.toY * 9 + move.toX;
    const pIdx = pieceToIndex(move.piece);
    const cap = move.captured !== undefined && move.captured !== 0 ? move.captured : 0;
    const capIdx = cap !== 0 ? pieceToIndex(cap) : 0;

    let nextHash = hashKey ^ ZOBRIST_PIECES[pIdx][fromIdx] ^ ZOBRIST_PIECES[pIdx][toIdx] ^ ZOBRIST_TURN;
    if (capIdx !== 0) {
      nextHash ^= ZOBRIST_PIECES[capIdx][toIdx];
    }

    const captured = applyMove(board, move);
    const score = -negamax(
      board,
      opponent,
      depth - 1,
      -beta,
      -localAlpha,
      ply + 1,
      nextHash,
      state
    );
    undoMove(board, move, captured);

    if (state.aborted) {
      state.history.pop();
      return 0;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }

    localAlpha = Math.max(localAlpha, score);

    if (localAlpha >= beta) {
      // Beta Cutoff
      if (cap === 0 && ply < state.killerMoves.length) {
        if (!movesEqual(state.killerMoves[ply][0], move)) {
          state.killerMoves[ply][1] = state.killerMoves[ply][0];
          state.killerMoves[ply][0] = move;
        }
        const histVal = (state.historyTable[pIdx]?.[fromIdx]?.[toIdx] || 0) + depth * depth;
        if (!state.historyTable[pIdx]) state.historyTable[pIdx] = Array.from({ length: 90 }, () => Array(90).fill(0));
        state.historyTable[pIdx][fromIdx][toIdx] = Math.min(histVal, 40_000);
      }
      break;
    }
  }

  state.history.pop();

  // Store in Transposition Table
  let flag = FLAG_EXACT;
  if (bestScore <= initialAlpha) {
    flag = FLAG_UPPERBOUND;
  } else if (bestScore >= beta) {
    flag = FLAG_LOWERBOUND;
  }

  transpositionTable[ttIndex] = {
    hashKey,
    depth,
    score: bestScore,
    flag,
    bestMove
  };

  return bestScore;
}

function repetitionPenalty(
  board: number[][],
  move: RawXiangqiMove,
  player: number,
  options: XiangqiSearchOptions
): number {
  const captured = applyMove(board, move);
  const key = xiangqiPositionKey(board, opponentOf(player));
  undoMove(board, move, captured);
  const priorOccurrences = (options.positionHistory ?? []).filter((item) => item === key).length;

  let penalty = priorOccurrences * 12_000;
  const previousOwnMove = [...(options.recentMoves ?? [])]
    .reverse()
    .find((item) => item.player === player);
  if (
    previousOwnMove?.fromX === move.toX &&
    previousOwnMove?.fromY === move.toY &&
    previousOwnMove?.toX === move.fromX &&
    previousOwnMove?.toY === move.fromY
  ) {
    penalty += 800;
  }
  return penalty;
}

function factualReason(board: number[][], move: RawXiangqiMove, player: number): string {
  const notation = toChineseNotation(board, move, player);
  const capturedName = move.captured === undefined || move.captured === 0 ? "" : getPieceName(move.captured);
  const captured = applyMove(board, move);
  const opponent = opponentOf(player);
  const check = isKingInCheck(board, opponent);
  const mate = check && getLegalMoves(board, opponent).length === 0;
  undoMove(board, move, captured);

  if (mate) return `${notation}，绝杀`;
  if (capturedName && check) return `${notation}，吃${capturedName}并将军`;
  if (capturedName) return `${notation}，吃${capturedName}`;
  if (check) return `${notation}，将军`;
  return `${notation}，改善子力位置`;
}

export function findBestXiangqiMove(
  sourceBoard: number[][],
  player: number,
  options: XiangqiSearchOptions = {}
): XiangqiEngineSuggestion | null {
  const board = sourceBoard.map((row) => [...row]);
  const legal = getLegalMoves(board, player);
  if (legal.length === 0) return null;

  const deadline = Date.now() + Math.max(50, options.timeBudgetMs ?? 700);
  const maxDepth = Math.max(1, options.maxDepth ?? 5);

  const state: SearchState = {
    deadline,
    aborted: false,
    killerMoves: Array.from({ length: 64 }, () => [null, null]),
    historyTable: Array.from({ length: 15 }, () =>
      Array.from({ length: 90 }, () => Array(90).fill(0))
    ),
    history: []
  };

  const initialHash = computeZobristHash(board, player);
  const ordered = orderedMoves(board, player, 1);
  let bestMove = ordered[0];
  let bestScore = -Infinity;
  let depthReached = 0;

  for (let depth = 1; depth <= maxDepth; depth++) {
    state.aborted = false;
    let iterationMove = bestMove;
    let iterationScore = -Infinity;
    let alpha = -Infinity;
    const opponent = opponentOf(player);

    const movesToSearch = advancedOrderedMoves(
      board,
      legal,
      player,
      0,
      bestMove,
      state
    );

    for (const move of movesToSearch) {
      const rootPenalty = repetitionPenalty(board, move, player, options);
      const fromIdx = move.fromY * 9 + move.fromX;
      const toIdx = move.toY * 9 + move.toX;
      const pIdx = pieceToIndex(move.piece);
      const cap = move.captured !== undefined && move.captured !== 0 ? move.captured : 0;
      const capIdx = cap !== 0 ? pieceToIndex(cap) : 0;

      let nextHash = initialHash ^ ZOBRIST_PIECES[pIdx][fromIdx] ^ ZOBRIST_PIECES[pIdx][toIdx] ^ ZOBRIST_TURN;
      if (capIdx !== 0) {
        nextHash ^= ZOBRIST_PIECES[capIdx][toIdx];
      }

      const captured = applyMove(board, move);
      const score =
        -negamax(
          board,
          opponent,
          depth - 1,
          -Infinity,
          -(alpha + rootPenalty),
          1,
          nextHash,
          state
        ) - rootPenalty;
      undoMove(board, move, captured);

      if (state.aborted) break;
      if (score > iterationScore) {
        iterationScore = score;
        iterationMove = move;
      }
      alpha = Math.max(alpha, score);
    }

    if (state.aborted) break;
    bestMove = iterationMove;
    bestScore = iterationScore;
    depthReached = depth;
  }

  // Fallback for very small budgets
  if (depthReached === 0) {
    bestMove = [...legal].sort(
      (a, b) =>
        moveOrderScore(board, b, player) - repetitionPenalty(board, b, player, options) -
        (moveOrderScore(board, a, player) - repetitionPenalty(board, a, player, options))
    )[0];
    bestScore =
      moveOrderScore(board, bestMove, player) -
      repetitionPenalty(board, bestMove, player, options);
  }

  return {
    actionId: moveToString(bestMove.fromX, bestMove.fromY, bestMove.toX, bestMove.toY),
    score: bestScore,
    reason: factualReason(board, bestMove, player),
    depthReached
  };
}

