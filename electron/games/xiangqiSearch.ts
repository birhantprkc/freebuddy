import type { GameMoveRecord } from "../shared/gameToolProtocol.js";
import {
  PIECE_CANNON,
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

function positionalValue(piece: number, x: number, y: number): number {
  const abs = Math.abs(piece);
  const isRed = piece > 0;
  const advance = isRed ? y : 9 - y;
  const center = 4 - Math.abs(4 - x);
  if (abs === PIECE_PAWN) return advance * 12 + center * 3;
  if (abs === PIECE_KNIGHT) return center * 9 + (y >= 2 && y <= 7 ? 18 : 0);
  if (abs === PIECE_CANNON) return center * 6;
  if (abs === PIECE_ROOK) return center * 3;
  return 0;
}

export function evaluateXiangqiBoard(board: number[][], player: number): number {
  let score = 0;
  for (let y = 0; y < board.length; y++) {
    for (let x = 0; x < board[y].length; x++) {
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

function moveOrderScore(board: number[][], move: RawXiangqiMove, player: number): number {
  const captured = move.captured === undefined ? 0 : pieceValue(move.captured);
  const mover = pieceValue(move.piece);
  const center = 4 - Math.abs(4 - move.toX);
  const taken = applyMove(board, move);
  const givesCheck = isKingInCheck(board, opponentOf(player));
  undoMove(board, move, taken);
  // MVV-LVA for captures, then checks and central development. Quiet moves by
  // Kings/Rooks must not be buried merely because the moving piece is valuable.
  return captured * 20 - (captured > 0 ? Math.floor(mover / 20) : 0) +
    (givesCheck ? 20_000 : 0) + center * 8;
}

function orderedMoves(board: number[][], player: number, depth: number): RawXiangqiMove[] {
  void depth;
  return getLegalMoves(board, player).sort(
    (a, b) => moveOrderScore(board, b, player) - moveOrderScore(board, a, player)
  );
}

interface SearchState {
  deadline: number;
  aborted: boolean;
}

function negamax(
  board: number[][],
  player: number,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  state: SearchState
): number {
  if (Date.now() >= state.deadline) {
    state.aborted = true;
    return 0;
  }

  const moves = orderedMoves(board, player, depth);
  if (moves.length === 0) return -MATE_SCORE + ply * 100;
  if (depth <= 0) return evaluateXiangqiBoard(board, player);

  let best = -Infinity;
  let localAlpha = alpha;
  const opponent = opponentOf(player);
  for (const move of moves) {
    const captured = applyMove(board, move);
    const score = -negamax(
      board,
      opponent,
      depth - 1,
      -beta,
      -localAlpha,
      ply + 1,
      state
    );
    undoMove(board, move, captured);
    if (state.aborted) return 0;
    best = Math.max(best, score);
    localAlpha = Math.max(localAlpha, score);
    if (localAlpha >= beta) break;
  }
  return best;
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
  const capturedName = move.captured === undefined ? "" : getPieceName(move.captured);
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
  const legal = getLegalMoves(board, player).sort(
    (a, b) => moveOrderScore(board, b, player) - moveOrderScore(board, a, player)
  );
  if (legal.length === 0) return null;

  const deadline = Date.now() + Math.max(50, options.timeBudgetMs ?? 700);
  const maxDepth = Math.max(1, options.maxDepth ?? 3);
  let bestMove = legal[0];
  let bestScore = -Infinity;
  let depthReached = 0;

  for (let depth = 1; depth <= maxDepth; depth++) {
    const state: SearchState = { deadline, aborted: false };
    let iterationMove = bestMove;
    let iterationScore = -Infinity;
    let alpha = -Infinity;
    const opponent = opponentOf(player);

    for (const move of legal) {
      const rootPenalty = repetitionPenalty(board, move, player, options);
      const captured = applyMove(board, move);
      const score =
        -negamax(
          board,
          opponent,
          depth - 1,
          -Infinity,
          -(alpha + rootPenalty),
          1,
          state
        ) -
        rootPenalty;
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

  // Very small budgets may expire before depth 1 completes. Keep a legal,
  // ordered fallback and still apply the root repetition preference.
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
