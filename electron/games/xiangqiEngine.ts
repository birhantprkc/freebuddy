import type {
  GameChatMessage,
  GameMoveRecord,
  GameStateSnapshot,
  GameStatus,
  LegalGameMove
} from "../shared/gameToolProtocol.js";

export const BOARD_COLS = 9;
export const BOARD_ROWS = 10;

export const PLAYER_RED = 1;   // Red side (moves first by default)
export const PLAYER_BLACK = 2; // Black side

// Piece Definitions
// Red pieces > 0, Black pieces < 0, Empty = 0
export const PIECE_KING = 1;     // 帥 (Red: 1), 將 (Black: -1)
export const PIECE_ADVISOR = 2;  // 仕 (Red: 2), 士 (Black: -2)
export const PIECE_BISHOP = 3;   // 相 (Red: 3), 象 (Black: -3)
export const PIECE_KNIGHT = 4;   // 傌 (Red: 4), 馬 (Black: -4)
export const PIECE_ROOK = 5;     // 俥 (Red: 5), 車 (Black: -5)
export const PIECE_CANNON = 6;   // 炮 (Red: 6), 砲 (Black: -6)
export const PIECE_PAWN = 7;     // 兵 (Red: 7), 卒 (Black: -7)

const COL_LETTERS = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
const CHINESE_DIGITS_RED = ["九", "八", "七", "六", "五", "四", "三", "二", "一"];
const CHINESE_DIGITS_BLACK = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

export interface RawXiangqiMove {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  piece: number;
  captured?: number;
}

export interface XiangqiMoveOptions {
  /** Reject an avoidable move that gives the opponent mate in one. */
  rejectAvoidableMate?: boolean;
}

export interface XiangqiMoveResult {
  ok: boolean;
  error?: string;
  winner?: number | null;
  draw?: boolean;
  chineseMove?: string;
  capturedPiece?: number;
  capturedPieceName?: string;
  isCheck?: boolean;
  isCheckmate?: boolean;
  isStalemate?: boolean;
}

export function coordToString(x: number, y: number): string {
  const col = COL_LETTERS[x] || `${x}`;
  return `${col}${y}`;
}

export function moveToString(fromX: number, fromY: number, toX: number, toY: number): string {
  return `${coordToString(fromX, fromY)}${coordToString(toX, toY)}`;
}

export function xiangqiPositionKey(board: number[][], turn: number): string {
  return `${turn}|${board.map((row) => row.join(",")).join("/")}`;
}

export function stringToMove(moveStr: string): { fromX: number; fromY: number; toX: number; toY: number } | null {
  const clean = moveStr.trim().toLowerCase();
  const match = clean.match(/^([a-i])(\d)([a-i])(\d)$/);
  if (!match) return null;

  const fromX = COL_LETTERS.indexOf(match[1]);
  const fromY = parseInt(match[2], 10);
  const toX = COL_LETTERS.indexOf(match[3]);
  const toY = parseInt(match[4], 10);

  if (
    fromX >= 0 && fromX < BOARD_COLS &&
    fromY >= 0 && fromY < BOARD_ROWS &&
    toX >= 0 && toX < BOARD_COLS &&
    toY >= 0 && toY < BOARD_ROWS
  ) {
    return { fromX, fromY, toX, toY };
  }
  return null;
}

export function createInitialBoard(): number[][] {
  const board: number[][] = Array.from({ length: BOARD_ROWS }, () => Array(BOARD_COLS).fill(0));

  // Red Side (y = 0..3)
  board[0][0] = PIECE_ROOK;
  board[0][1] = PIECE_KNIGHT;
  board[0][2] = PIECE_BISHOP;
  board[0][3] = PIECE_ADVISOR;
  board[0][4] = PIECE_KING;
  board[0][5] = PIECE_ADVISOR;
  board[0][6] = PIECE_BISHOP;
  board[0][7] = PIECE_KNIGHT;
  board[0][8] = PIECE_ROOK;

  board[2][1] = PIECE_CANNON;
  board[2][7] = PIECE_CANNON;

  board[3][0] = PIECE_PAWN;
  board[3][2] = PIECE_PAWN;
  board[3][4] = PIECE_PAWN;
  board[3][6] = PIECE_PAWN;
  board[3][8] = PIECE_PAWN;

  // Black Side (y = 6..9)
  board[9][0] = -PIECE_ROOK;
  board[9][1] = -PIECE_KNIGHT;
  board[9][2] = -PIECE_BISHOP;
  board[9][3] = -PIECE_ADVISOR;
  board[9][4] = -PIECE_KING;
  board[9][5] = -PIECE_ADVISOR;
  board[9][6] = -PIECE_BISHOP;
  board[9][7] = -PIECE_KNIGHT;
  board[9][8] = -PIECE_ROOK;

  board[7][1] = -PIECE_CANNON;
  board[7][7] = -PIECE_CANNON;

  board[6][0] = -PIECE_PAWN;
  board[6][2] = -PIECE_PAWN;
  board[6][4] = -PIECE_PAWN;
  board[6][6] = -PIECE_PAWN;
  board[6][8] = -PIECE_PAWN;

  return board;
}

export function isRedPiece(val: number): boolean {
  return val > 0;
}

export function isBlackPiece(val: number): boolean {
  return val < 0;
}

export function isOwnPiece(val: number, player: number): boolean {
  if (val === 0) return false;
  return player === PLAYER_RED ? isRedPiece(val) : isBlackPiece(val);
}

export function isOpponentPiece(val: number, player: number): boolean {
  if (val === 0) return false;
  return player === PLAYER_RED ? isBlackPiece(val) : isRedPiece(val);
}

export function getPieceName(piece: number): string {
  switch (piece) {
    case PIECE_KING: return "帥";
    case PIECE_ADVISOR: return "仕";
    case PIECE_BISHOP: return "相";
    case PIECE_KNIGHT: return "傌";
    case PIECE_ROOK: return "俥";
    case PIECE_CANNON: return "炮";
    case PIECE_PAWN: return "兵";
    case -PIECE_KING: return "將";
    case -PIECE_ADVISOR: return "士";
    case -PIECE_BISHOP: return "象";
    case -PIECE_KNIGHT: return "馬";
    case -PIECE_ROOK: return "車";
    case -PIECE_CANNON: return "砲";
    case -PIECE_PAWN: return "卒";
    default: return "";
  }
}

// Pseudo-legal moves generation without king safety check
export function getPseudoLegalMoves(board: number[][], x: number, y: number): { toX: number; toY: number }[] {
  const piece = board[y][x];
  if (piece === 0) return [];
  const player = isRedPiece(piece) ? PLAYER_RED : PLAYER_BLACK;
  const absPiece = Math.abs(piece);
  const moves: { toX: number; toY: number }[] = [];

  const addIfValid = (tx: number, ty: number) => {
    if (tx < 0 || tx >= BOARD_COLS || ty < 0 || ty >= BOARD_ROWS) return;
    if (isOwnPiece(board[ty][tx], player)) return;
    moves.push({ toX: tx, toY: ty });
  };

  switch (absPiece) {
    case PIECE_KING: {
      // Palace check: Red (x: 3..5, y: 0..2), Black (x: 3..5, y: 7..9)
      const minX = 3, maxX = 5;
      const minY = player === PLAYER_RED ? 0 : 7;
      const maxY = player === PLAYER_RED ? 2 : 9;

      const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
      for (const [dx, dy] of dirs) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= minX && nx <= maxX && ny >= minY && ny <= maxY) {
          addIfValid(nx, ny);
        }
      }

      // Flying General (飞将 / King faces King)
      const stepY = player === PLAYER_RED ? 1 : -1;
      let checkY = y + stepY;
      while (checkY >= 0 && checkY < BOARD_ROWS) {
        const target = board[checkY][x];
        if (target !== 0) {
          if (target === (player === PLAYER_RED ? -PIECE_KING : PIECE_KING)) {
            moves.push({ toX: x, toY: checkY });
          }
          break;
        }
        checkY += stepY;
      }
      break;
    }

    case PIECE_ADVISOR: {
      // Palace diagonal steps
      const minX = 3, maxX = 5;
      const minY = player === PLAYER_RED ? 0 : 7;
      const maxY = player === PLAYER_RED ? 2 : 9;

      const dirs = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
      for (const [dx, dy] of dirs) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= minX && nx <= maxX && ny >= minY && ny <= maxY) {
          addIfValid(nx, ny);
        }
      }
      break;
    }

    case PIECE_BISHOP: {
      // Diagonal 2 steps, cannot cross river, elephant eye check
      const minY = player === PLAYER_RED ? 0 : 5;
      const maxY = player === PLAYER_RED ? 4 : 9;

      const dirs = [[2, 2], [2, -2], [-2, 2], [-2, -2]];
      for (const [dx, dy] of dirs) {
        const nx = x + dx;
        const ny = y + dy;
        const eyeX = x + dx / 2;
        const eyeY = y + dy / 2;
        if (nx >= 0 && nx < BOARD_COLS && ny >= minY && ny <= maxY) {
          if (board[eyeY][eyeX] === 0) {
            addIfValid(nx, ny);
          }
        }
      }
      break;
    }

    case PIECE_KNIGHT: {
      // 8 horse directions with horse leg check (蹩马腿)
      const knightMoves = [
        { dx: 1, dy: 2, legX: 0, legY: 1 },
        { dx: -1, dy: 2, legX: 0, legY: 1 },
        { dx: 1, dy: -2, legX: 0, legY: -1 },
        { dx: -1, dy: -2, legX: 0, legY: -1 },
        { dx: 2, dy: 1, legX: 1, legY: 0 },
        { dx: 2, dy: -1, legX: 1, legY: 0 },
        { dx: -2, dy: 1, legX: -1, legY: 0 },
        { dx: -2, dy: -1, legX: -1, legY: 0 }
      ];

      for (const m of knightMoves) {
        const nx = x + m.dx;
        const ny = y + m.dy;
        const lx = x + m.legX;
        const ly = y + m.legY;
        if (nx >= 0 && nx < BOARD_COLS && ny >= 0 && ny < BOARD_ROWS) {
          if (board[ly][lx] === 0) {
            addIfValid(nx, ny);
          }
        }
      }
      break;
    }

    case PIECE_ROOK: {
      // 4 orthogonal straight lines
      const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
      for (const [dx, dy] of dirs) {
        let nx = x + dx;
        let ny = y + dy;
        while (nx >= 0 && nx < BOARD_COLS && ny >= 0 && ny < BOARD_ROWS) {
          const target = board[ny][nx];
          if (target === 0) {
            moves.push({ toX: nx, toY: ny });
          } else {
            if (isOpponentPiece(target, player)) {
              moves.push({ toX: nx, toY: ny });
            }
            break;
          }
          nx += dx;
          ny += dy;
        }
      }
      break;
    }

    case PIECE_CANNON: {
      // 4 orthogonal lines: move like rook before obstacle, jump over 1 screen to capture
      const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
      for (const [dx, dy] of dirs) {
        let nx = x + dx;
        let ny = y + dy;
        let jumped = false;

        while (nx >= 0 && nx < BOARD_COLS && ny >= 0 && ny < BOARD_ROWS) {
          const target = board[ny][nx];
          if (!jumped) {
            if (target === 0) {
              moves.push({ toX: nx, toY: ny });
            } else {
              jumped = true; // Screen found!
            }
          } else {
            if (target !== 0) {
              if (isOpponentPiece(target, player)) {
                moves.push({ toX: nx, toY: ny });
              }
              break; // Second obstacle reached, stop
            }
          }
          nx += dx;
          ny += dy;
        }
      }
      break;
    }

    case PIECE_PAWN: {
      // Red: moves up (y+1). After river (y >= 5), can also move left/right (x±1)
      // Black: moves down (y-1). After river (y <= 4), can also move left/right (x±1)
      const forwardY = player === PLAYER_RED ? 1 : -1;
      const crossedRiver = player === PLAYER_RED ? y >= 5 : y <= 4;

      addIfValid(x, y + forwardY);
      if (crossedRiver) {
        addIfValid(x - 1, y);
        addIfValid(x + 1, y);
      }
      break;
    }
  }

  return moves;
}

// Find king coordinate
export function findKing(board: number[][], player: number): { x: number; y: number } | null {
  const target = player === PLAYER_RED ? PIECE_KING : -PIECE_KING;
  for (let y = 0; y < BOARD_ROWS; y++) {
    for (let x = 0; x < BOARD_COLS; x++) {
      if (board[y][x] === target) {
        return { x, y };
      }
    }
  }
  return null;
}

// Check if King is attacked or facing opponent King directly
export function isKingInCheck(board: number[][], player: number): boolean {
  const king = findKing(board, player);
  if (!king) return true; // No king means king was captured

  // Check Flying General (对将)
  const oppKingVal = player === PLAYER_RED ? -PIECE_KING : PIECE_KING;
  const stepY = player === PLAYER_RED ? 1 : -1;
  let cy = king.y + stepY;
  while (cy >= 0 && cy < BOARD_ROWS) {
    const p = board[cy][king.x];
    if (p !== 0) {
      if (p === oppKingVal) return true; // Direct line of sight!
      break;
    }
    cy += stepY;
  }

  // Check if any opponent piece attacks the King
  for (let y = 0; y < BOARD_ROWS; y++) {
    for (let x = 0; x < BOARD_COLS; x++) {
      const piece = board[y][x];
      if (isOpponentPiece(piece, player)) {
        const moves = getPseudoLegalMoves(board, x, y);
        if (moves.some((m) => m.toX === king.x && m.toY === king.y)) {
          return true;
        }
      }
    }
  }

  return false;
}

// Generate fully verified legal moves for player
export function getLegalMoves(board: number[][], player: number): RawXiangqiMove[] {
  const legalMoves: RawXiangqiMove[] = [];

  for (let y = 0; y < BOARD_ROWS; y++) {
    for (let x = 0; x < BOARD_COLS; x++) {
      const piece = board[y][x];
      if (isOwnPiece(piece, player)) {
        const pseudo = getPseudoLegalMoves(board, x, y);
        for (const m of pseudo) {
          // Clone and simulate move
          const nextBoard = board.map((row) => [...row]);
          const captured = nextBoard[m.toY][m.toX];
          nextBoard[m.toY][m.toX] = piece;
          nextBoard[y][x] = 0;

          if (!isKingInCheck(nextBoard, player)) {
            legalMoves.push({
              fromX: x,
              fromY: y,
              toX: m.toX,
              toY: m.toY,
              piece,
              captured: captured !== 0 ? captured : undefined
            });
          }
        }
      }
    }
  }

  return legalMoves;
}

// Convert move to traditional Chinese notation (e.g. 炮二平五, 马八进七, 车1进3)
export function toChineseNotation(board: number[][], move: RawXiangqiMove, player: number): string {
  const piece = move.piece;
  const name = getPieceName(piece);
  const isRed = player === PLAYER_RED;
  const digits = isRed ? CHINESE_DIGITS_RED : CHINESE_DIGITS_BLACK;

  const fromCol = isRed ? digits[move.fromX] : digits[move.fromX];
  const toCol = isRed ? digits[move.toX] : digits[move.toX];

  const dx = move.toX - move.fromX;
  const dy = move.toY - move.fromY;

  // Straight line pieces vs diagonal pieces
  const absPiece = Math.abs(piece);

  if (absPiece === PIECE_ROOK || absPiece === PIECE_CANNON || absPiece === PIECE_PAWN || absPiece === PIECE_KING) {
    if (dy === 0) {
      // Horizontal move
      return `${name}${fromCol}平${toCol}`;
    }
    const stepCount = Math.abs(dy);
    const stepDigit = isRed ? digits[9 - stepCount] : digits[stepCount - 1];
    const isAdvancing = isRed ? dy > 0 : dy < 0;
    const action = isAdvancing ? "进" : "退";
    return `${name}${fromCol}${action}${stepDigit}`;
  } else {
    // Diagonal pieces (Knight, Advisor, Bishop)
    const isAdvancing = isRed ? dy > 0 : dy < 0;
    const action = isAdvancing ? "进" : "退";
    return `${name}${fromCol}${action}${toCol}`;
  }
}

// Piece value for tactical threat evaluation
const PIECE_VALUES: Record<number, number> = {
  [PIECE_KING]: 10000,
  [PIECE_ROOK]: 1000,
  [PIECE_CANNON]: 450,
  [PIECE_KNIGHT]: 400,
  [PIECE_ADVISOR]: 200,
  [PIECE_BISHOP]: 200,
  [PIECE_PAWN]: 100
};

export function pieceValue(piece: number): number {
  return PIECE_VALUES[Math.abs(piece)] || 100;
}

export interface OpponentCaptureThreat {
  targetCoord: string;
  targetName: string;
  attackerCoord: string;
  attackerName: string;
  defended: boolean;
  value: number;
}

/**
 * Static 2-ply threat scan: which of `mover`'s pieces can the opponent
 * capture right now, and can `mover` recapture afterwards (defended)?
 */
export function getOpponentCaptureThreats(
  board: number[][],
  mover: number
): OpponentCaptureThreat[] {
  const opponent = mover === PLAYER_RED ? PLAYER_BLACK : PLAYER_RED;
  const seen = new Map<string, OpponentCaptureThreat>();

  for (const m of getLegalMoves(board, opponent)) {
    if (m.captured === undefined) continue;

    const key = `${m.toX},${m.toY}`;
    const value = pieceValue(m.captured);
    const existing = seen.get(key);
    if (existing && existing.value >= value) continue;

    const nextBoard = board.map((row) => [...row]);
    nextBoard[m.toY][m.toX] = m.piece;
    nextBoard[m.fromY][m.fromX] = 0;

    let defended = false;
    for (const reply of getLegalMoves(nextBoard, mover)) {
      if (
        reply.captured !== undefined &&
        reply.toX === m.toX &&
        reply.toY === m.toY
      ) {
        defended = true;
        break;
      }
    }

    seen.set(key, {
      targetCoord: coordToString(m.toX, m.toY),
      targetName: getPieceName(m.captured),
      attackerCoord: coordToString(m.fromX, m.fromY),
      attackerName: getPieceName(m.piece),
      defended,
      value
    });
  }

  return [...seen.values()].sort(
    (a, b) => (a.defended ? 1 : 0) - (b.defended ? 1 : 0) || b.value - a.value
  );
}

function boardAfterMove(board: number[][], move: RawXiangqiMove): number[][] {
  const nextBoard = board.map((row) => [...row]);
  nextBoard[move.toY][move.toX] = move.piece;
  nextBoard[move.fromY][move.fromX] = 0;
  return nextBoard;
}

interface CaptureExchangeLoss {
  targetCoord: string;
  targetPiece: number;
  /** Material lost after the best immediate legal recapture. */
  netLoss: number;
}

/**
 * Score every immediate capture separately. This intentionally excludes King
 * captures: when the side to move is already in check, treating the King as a
 * 10000-point baseline masks newly hung Rooks/Cannons.
 */
function captureExchangeLosses(
  board: number[][],
  attacker: number,
  defender: number
): Map<string, CaptureExchangeLoss> {
  const losses = new Map<string, CaptureExchangeLoss>();
  for (const capture of getLegalMoves(board, attacker)) {
    if (
      capture.captured === undefined ||
      Math.abs(capture.captured) === PIECE_KING
    ) {
      continue;
    }

    const afterCapture = boardAfterMove(board, capture);
    let recaptureValue = 0;
    for (const reply of getLegalMoves(afterCapture, defender)) {
      if (
        reply.captured !== undefined &&
        reply.toX === capture.toX &&
        reply.toY === capture.toY
      ) {
        recaptureValue = Math.max(recaptureValue, pieceValue(reply.captured));
      }
    }

    const targetCoord = coordToString(capture.toX, capture.toY);
    const netLoss = Math.max(0, pieceValue(capture.captured) - recaptureValue);
    const existing = losses.get(targetCoord);
    if (!existing || netLoss > existing.netLoss) {
      losses.set(targetCoord, {
        targetCoord,
        targetPiece: capture.captured,
        netLoss
      });
    }
  }
  return losses;
}

/** True if `attacker` has a move after which `defender` has zero legal replies. */
export function canDeliverMateInOne(board: number[][], attacker: number, defender: number): boolean {
  for (const m of getLegalMoves(board, attacker)) {
    const nextBoard = board.map((row) => [...row]);
    nextBoard[m.toY][m.toX] = m.piece;
    nextBoard[m.fromY][m.fromX] = 0;
    if (!isKingInCheck(nextBoard, defender)) continue;
    if (getLegalMoves(nextBoard, defender).length === 0) return true;
  }
  return false;
}

export function moveAllowsMateInOne(
  board: number[][],
  move: RawXiangqiMove,
  player: number
): boolean {
  const opponent = player === PLAYER_RED ? PLAYER_BLACK : PLAYER_RED;
  return canDeliverMateInOne(boardAfterMove(board, move), opponent, player);
}

export function getCandidateMoves(
  board: number[][],
  player: number,
  recentMoves: GameMoveRecord[] = [],
  limit = 30
): LegalGameMove[] {
  const legal = getLegalMoves(board, player);
  if (legal.length === 0) return [];

  const opponent = player === PLAYER_RED ? PLAYER_BLACK : PLAYER_RED;
  const baselineLosses = captureExchangeLosses(board, opponent, player);
  const previousOwnMove = [...recentMoves].reverse().find((move) => move.player === player);

  const scored = legal.map((move) => {
    const actionId = moveToString(move.fromX, move.fromY, move.toX, move.toY);
    const chineseDesc = toChineseNotation(board, move, player);

    // Simulate move
    const nextBoard = boardAfterMove(board, move);

    const oppInCheck = isKingInCheck(nextBoard, opponent);
    const oppMovesAfter = getLegalMoves(nextBoard, opponent);
    const oppLegalCount = oppInCheck ? oppMovesAfter.length : 10;

    // Compare threats per target instead of using one global maximum. The
    // moved piece is always a new target at its destination; other pieces only
    // count when this move newly exposes or worsens their exchange loss.
    const replyLosses = captureExchangeLosses(nextBoard, opponent, player);
    let createdLoss = 0;
    let lossPiece: number | undefined;
    const destination = coordToString(move.toX, move.toY);
    for (const loss of replyLosses.values()) {
      const baseline =
        loss.targetCoord === destination
          ? 0
          : baselineLosses.get(loss.targetCoord)?.netLoss ?? 0;
      const delta = Math.max(0, loss.netLoss - baseline);
      if (delta > createdLoss) {
        createdLoss = delta;
        lossPiece = loss.targetPiece;
      }
    }
    const ourGain = move.captured ? pieceValue(move.captured) : 0;
    const materialDelta = ourGain - createdLoss;

    // Does this move hand the opponent a one-move mate?
    const allowsMate = moveAllowsMateInOne(board, move, player);

    let safety: "lose" | "trade" | "gain" | undefined;
    if (createdLoss > 0 && materialDelta < 0 && Math.abs(move.piece) !== PIECE_KING) {
      safety = "lose";
    } else if (createdLoss > 0 && ourGain > 0 && materialDelta === 0) {
      safety = "trade";
    } else if (ourGain > createdLoss) {
      safety = "gain";
    }

    if (allowsMate) safety = "lose";

    let priority = 10;
    let threatLevel: "winning" | "critical_block" | "attack" | "normal" = "normal";

    if (oppInCheck && oppLegalCount === 0) {
      threatLevel = "winning";
      priority = 10000;
    } else if (move.captured) {
      const capVal = ourGain;
      priority = 200 + capVal;
      threatLevel = capVal >= 400 ? "attack" : "normal";
    } else if (oppInCheck) {
      threatLevel = "attack";
      priority = 300;
    } else {
      // Positional preference: develop Knights, Rooks and central control
      const absPiece = Math.abs(move.piece);
      if (absPiece === PIECE_CANNON && (move.toX === 4 || move.toX === 2 || move.toX === 6)) priority += 50;
      if (absPiece === PIECE_KNIGHT && (move.toY >= 2 && move.toY <= 7)) priority += 40;
      if (absPiece === PIECE_ROOK && (move.toY === 0 || move.toY === 9 || move.toX === 1 || move.toX === 7)) priority += 60;
    }

    if (allowsMate) {
      priority -= 100000;
    } else if (safety === "lose") {
      priority -= Math.max(100, -materialDelta) * 2;
    } else if (safety === "gain") {
      priority += ourGain / 2;
    }

    let fullDesc = `${chineseDesc} (${coordToString(move.fromX, move.fromY)}->${coordToString(move.toX, move.toY)})`;
    if (threatLevel === "winning") fullDesc += " [绝杀胜手]";
    else if (move.captured) fullDesc += ` [吃${getPieceName(move.captured)}]`;
    else if (oppInCheck) fullDesc += " [将军抽将]";

    if (allowsMate) {
      fullDesc += " 🚨[招致绝杀!]";
    } else if (safety === "lose") {
      fullDesc += ` ⚠[丢${getPieceName(lossPiece ?? move.piece)}!]`;
    } else if (safety === "trade") {
      fullDesc += " [兑子简化]";
    } else if (safety === "gain" && move.captured) {
      fullDesc += " [得子主动]";
    } else if (!move.captured && !oppInCheck) {
      const absPiece = Math.abs(move.piece);
      if (recentMoves.length <= 4) {
        if (absPiece === PIECE_CANNON && move.toX === 4) fullDesc += " [中炮刚猛]";
        else if (absPiece === PIECE_CANNON && (move.toX === 2 || move.toX === 6)) fullDesc += " [过宫炮机变]";
        else if (absPiece === PIECE_KNIGHT && (move.toX === 2 || move.toX === 6)) fullDesc += " [正马稳健]";
        else if (absPiece === PIECE_KNIGHT && (move.toX === 0 || move.toX === 8)) fullDesc += " [边马奇兵]";
        else if (absPiece === PIECE_PAWN && (move.toX === 2 || move.toX === 6)) fullDesc += " [仙人指路]";
        else if (absPiece === PIECE_PAWN && move.toX === 4) fullDesc += " [进中卒争先]";
        else if (absPiece === PIECE_BISHOP) fullDesc += " [飞相厚重]";
        else if (absPiece === PIECE_ADVISOR) fullDesc += " [上士固守]";
        else if (absPiece === PIECE_ROOK) fullDesc += " [巡河出车]";
      } else {
        if (absPiece === PIECE_ROOK || absPiece === PIECE_KNIGHT) {
          fullDesc += (player === PLAYER_RED ? move.toY >= 5 : move.toY <= 4) ? " [抢占要道]" : " [出子占位]";
        } else if (absPiece === PIECE_CANNON) {
          fullDesc += " [伺机调动]";
        } else if (absPiece === PIECE_PAWN) {
          fullDesc += (player === PLAYER_RED ? move.toY >= 5 : move.toY <= 4) ? " [过河压迫]" : " [稳健挺卒]";
        } else if (absPiece === PIECE_BISHOP || absPiece === PIECE_ADVISOR || absPiece === PIECE_KING) {
          fullDesc += " [固守阵型]";
        }
      }
    }

    return {
      actionId,
      x: move.toX,
      y: move.toY,
      fromX: move.fromX,
      fromY: move.fromY,
      toX: move.toX,
      toY: move.toY,
      coord: actionId,
      description: fullDesc,
      threatLevel,
      safety,
      allowsMate,
      lossPiece:
        safety === "lose" && !allowsMate
          ? getPieceName(lossPiece ?? move.piece)
          : undefined,
      priority
    };
  });

  // Discourage immediate backtracking/oscillation while keeping the move
  // legal and available when tactics require it.
  for (const candidate of scored) {
    if (
      previousOwnMove?.fromX === candidate.toX &&
      previousOwnMove?.fromY === candidate.toY &&
      previousOwnMove?.toX === candidate.fromX &&
      previousOwnMove?.toY === candidate.fromY
    ) {
      candidate.priority -= 250;
    }
    const repeats = recentMoves.filter(
      (move) => move.player === player && move.actionId === candidate.actionId
    ).length;
    candidate.priority -= repeats * 120;
  }

  scored.sort((a, b) => b.priority - a.priority);

  return scored.slice(0, limit).map((s) => ({
    actionId: s.actionId,
    x: s.x,
    y: s.y,
    fromX: s.fromX,
    fromY: s.fromY,
    toX: s.toX,
    toY: s.toY,
    coord: s.coord,
    description: s.description,
    threatLevel: s.threatLevel,
    safety: s.safety,
    allowsMate: s.allowsMate,
    lossPiece: s.lossPiece
  }));
}

export class XiangqiGameInstance {
  public gameId: string;
  public status: GameStatus = "playing";
  public turn: number = PLAYER_RED; // Red moves first
  public playerSide: number;
  public agentSide: number;
  public board: number[][];
  public moveHistory: GameMoveRecord[] = [];
  public positionHistory: string[];
  public chatHistory: GameChatMessage[] = [];
  public winner: number | null = null;
  public updatedAt: number = Date.now();

  constructor(gameId: string, playerSide: number = PLAYER_RED) {
    this.gameId = gameId;
    this.playerSide = playerSide === 0 ? 0 : playerSide === PLAYER_BLACK ? PLAYER_BLACK : PLAYER_RED;
    this.agentSide = this.playerSide === PLAYER_RED ? PLAYER_BLACK : PLAYER_RED;
    this.board = createInitialBoard();
    this.positionHistory = [xiangqiPositionKey(this.board, this.turn)];
  }

  public static fromSnapshot(
    snapshot: GameStateSnapshot,
    playerSide: number = snapshot.playerSide ?? PLAYER_RED
  ): XiangqiGameInstance {
    const inst = new XiangqiGameInstance(snapshot.gameId, playerSide);
    inst.status = snapshot.status;
    inst.turn = snapshot.turn;
    inst.winner = snapshot.winner ?? null;
    inst.board = snapshot.board ? snapshot.board.map((row) => [...row]) : createInitialBoard();
    inst.moveHistory = [...(snapshot.moveHistory || [])];
    inst.positionHistory = snapshot.positionHistory?.length
      ? [...snapshot.positionHistory]
      : [xiangqiPositionKey(inst.board, inst.turn)];
    inst.chatHistory = [...(snapshot.chatHistory || [])];
    inst.updatedAt = snapshot.updatedAt || Date.now();
    return inst;
  }

  public getSnapshot(options?: { includeHistory?: boolean }): GameStateSnapshot {
    const includeHistory = options?.includeHistory ?? false;
    return {
      gameType: "xiangqi",
      gameId: this.gameId,
      status: this.status,
      turn: this.turn,
      playerSide: this.playerSide,
      agentSide: this.agentSide,
      stepCount: this.moveHistory.length,
      winner: this.winner,
      board: this.board.map((row) => [...row]),
      lastMove: this.moveHistory.length > 0 ? this.moveHistory[this.moveHistory.length - 1] : null,
      moveHistory: includeHistory ? [...this.moveHistory] : undefined,
      positionHistory: includeHistory ? [...this.positionHistory] : undefined,
      recentMoves: this.moveHistory.slice(-3),
      legalMoves:
        this.status === "playing"
          ? getCandidateMoves(this.board, this.turn, this.moveHistory)
          : [],
      chatHistory: includeHistory ? [...this.chatHistory] : this.chatHistory.slice(-3),
      updatedAt: this.updatedAt
    };
  }

  public applyMove(
    actionId: string,
    player: number,
    reason?: string,
    options: XiangqiMoveOptions = {}
  ): XiangqiMoveResult {
    if (this.status !== "playing") {
      return { ok: false, error: `Game is already over with status '${this.status}'.` };
    }

    if (this.turn !== player) {
      return { ok: false, error: `Not player ${player}'s turn. Current turn: ${this.turn}` };
    }

    const moveCoords = stringToMove(actionId);
    if (!moveCoords) {
      return { ok: false, error: `Invalid Xiangqi actionId '${actionId}'. Format should be like 'b2e2' or 'h0g2'.` };
    }

    const { fromX, fromY, toX, toY } = moveCoords;
    const piece = this.board[fromY][fromX];

    if (!isOwnPiece(piece, player)) {
      return { ok: false, error: `No valid piece belonging to player ${player} at (${fromX}, ${fromY}). Found: ${piece}` };
    }

    // Validate legality
    const legalMoves = getLegalMoves(this.board, player);
    const match = legalMoves.find(
      (m) => m.fromX === fromX && m.fromY === fromY && m.toX === toX && m.toY === toY
    );

    if (!match) {
      return { ok: false, error: `Move '${actionId}' (${getPieceName(piece)}) is illegal according to Xiangqi rules or leaves King in check.` };
    }

    if (options.rejectAvoidableMate && moveAllowsMateInOne(this.board, match, player)) {
      const hasSafeAlternative = legalMoves.some(
        (move) =>
          move !== match &&
          !moveAllowsMateInOne(this.board, move, player)
      );
      if (hasSafeAlternative) {
        return {
          ok: false,
          error: `Move '${actionId}' rejected: it allows mate in one while a safe legal alternative exists.`
        };
      }
    }

    const chineseMove = toChineseNotation(this.board, match, player);
    const capturedPiece = this.board[toY][toX] !== 0 ? this.board[toY][toX] : undefined;

    // Apply move
    this.board[toY][toX] = piece;
    this.board[fromY][fromX] = 0;

    const opponent = player === PLAYER_RED ? PLAYER_BLACK : PLAYER_RED;
    const isCheck = isKingInCheck(this.board, opponent);
    const opponentLegalMoves = getLegalMoves(this.board, opponent);
    const isCheckmate = isCheck && opponentLegalMoves.length === 0;
    const isStalemate = !isCheck && opponentLegalMoves.length === 0;
    const positionKey = xiangqiPositionKey(this.board, opponent);

    const moveRecord: GameMoveRecord = {
      actionId,
      x: toX,
      y: toY,
      fromX,
      fromY,
      toX,
      toY,
      piece,
      capturedPiece,
      chineseMove,
      capturedPieceName:
        capturedPiece !== undefined ? getPieceName(capturedPiece) : undefined,
      givesCheck: isCheck,
      checkmate: isCheckmate,
      positionKey,
      player,
      stepIndex: this.moveHistory.length + 1,
      timestamp: Date.now(),
      reason
    };
    this.moveHistory.push(moveRecord);
    this.positionHistory.push(positionKey);
    this.updatedAt = Date.now();

    const facts = {
      chineseMove,
      capturedPiece,
      capturedPieceName:
        capturedPiece !== undefined ? getPieceName(capturedPiece) : undefined,
      isCheck,
      isCheckmate,
      isStalemate
    };

    if (opponentLegalMoves.length === 0) {
      // Opponent is checkmated or stalemated
      this.status = player === this.playerSide ? "player_won" : "agent_won";
      this.winner = player;
      return { ok: true, winner: player, ...facts };
    }

    // Switch turn
    this.turn = opponent;
    const repetitions = this.positionHistory.filter((key) => key === positionKey).length;
    if (repetitions >= 3) {
      this.status = "draw";
      this.winner = null;
      return { ok: true, winner: null, draw: true, ...facts };
    }
    return { ok: true, ...facts };
  }

  public addChat(
    sender: "player" | "agent" | "system",
    message: string,
    mood?: "confident" | "mocking" | "nervous" | "calm" | "admiring"
  ): GameChatMessage {
    const chat: GameChatMessage = {
      sender,
      message: message.trim(),
      mood,
      timestamp: Date.now()
    };
    this.chatHistory.push(chat);
    this.updatedAt = Date.now();
    return chat;
  }

  public resign(player: number, reason?: string): { ok: boolean; winner: number } {
    if (this.status !== "playing") {
      return { ok: false, winner: this.winner || 0 };
    }
    const winningPlayer = player === PLAYER_RED ? PLAYER_BLACK : PLAYER_RED;
    this.status = winningPlayer === this.playerSide ? "player_won" : "agent_won";
    this.winner = winningPlayer;
    this.updatedAt = Date.now();
    this.addChat(
      player === this.playerSide ? "player" : "agent",
      reason ? `认输: ${reason}` : "我认输了，这一局你下得漂亮！",
      "calm"
    );
    return { ok: true, winner: winningPlayer };
  }
}
