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

export function coordToString(x: number, y: number): string {
  const col = COL_LETTERS[x] || `${x}`;
  return `${col}${y}`;
}

export function moveToString(fromX: number, fromY: number, toX: number, toY: number): string {
  return `${coordToString(fromX, fromY)}${coordToString(toX, toY)}`;
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

export function getCandidateMoves(board: number[][], player: number): LegalGameMove[] {
  const legal = getLegalMoves(board, player);
  if (legal.length === 0) return [];

  const opponent = player === PLAYER_RED ? PLAYER_BLACK : PLAYER_RED;

  const scored = legal.map((move) => {
    const actionId = moveToString(move.fromX, move.fromY, move.toX, move.toY);
    const chineseDesc = toChineseNotation(board, move, player);

    // Simulate move
    const nextBoard = board.map((row) => [...row]);
    nextBoard[move.toY][move.toX] = move.piece;
    nextBoard[move.fromY][move.fromX] = 0;

    const oppInCheck = isKingInCheck(nextBoard, opponent);
    const oppLegalCount = oppInCheck ? getLegalMoves(nextBoard, opponent).length : 10;

    let priority = 10;
    let threatLevel: "winning" | "critical_block" | "attack" | "normal" = "normal";

    if (oppInCheck && oppLegalCount === 0) {
      threatLevel = "winning";
      priority = 10000;
    } else if (move.captured) {
      const capVal = PIECE_VALUES[Math.abs(move.captured)] || 100;
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

    let fullDesc = `${chineseDesc} (${coordToString(move.fromX, move.fromY)}->${coordToString(move.toX, move.toY)})`;
    if (threatLevel === "winning") fullDesc += " [绝杀将军]";
    else if (move.captured) fullDesc += ` [吃${getPieceName(move.captured)}]`;
    else if (oppInCheck) fullDesc += " [将军]";

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
      priority
    };
  });

  scored.sort((a, b) => b.priority - a.priority);

  return scored.slice(0, 30).map((s) => ({
    actionId: s.actionId,
    x: s.x,
    y: s.y,
    fromX: s.fromX,
    fromY: s.fromY,
    toX: s.toX,
    toY: s.toY,
    coord: s.coord,
    description: s.description,
    threatLevel: s.threatLevel
  }));
}

export class XiangqiGameInstance {
  public gameId: string;
  public status: GameStatus = "playing";
  public turn: number = PLAYER_RED; // Red moves first
  public board: number[][];
  public moveHistory: GameMoveRecord[] = [];
  public chatHistory: GameChatMessage[] = [];
  public winner: number | null = null;
  public updatedAt: number = Date.now();

  constructor(gameId: string) {
    this.gameId = gameId;
    this.board = createInitialBoard();
  }

  public static fromSnapshot(snapshot: GameStateSnapshot): XiangqiGameInstance {
    const inst = new XiangqiGameInstance(snapshot.gameId);
    inst.status = snapshot.status;
    inst.turn = snapshot.turn;
    inst.winner = snapshot.winner ?? null;
    inst.board = snapshot.board ? snapshot.board.map((row) => [...row]) : createInitialBoard();
    inst.moveHistory = [...(snapshot.moveHistory || [])];
    inst.chatHistory = [...(snapshot.chatHistory || [])];
    inst.updatedAt = snapshot.updatedAt || Date.now();
    return inst;
  }

  public getSnapshot(): GameStateSnapshot {
    return {
      gameType: "xiangqi",
      gameId: this.gameId,
      status: this.status,
      turn: this.turn,
      stepCount: this.moveHistory.length,
      winner: this.winner,
      board: this.board.map((row) => [...row]),
      lastMove: this.moveHistory.length > 0 ? this.moveHistory[this.moveHistory.length - 1] : null,
      moveHistory: [...this.moveHistory],
      legalMoves: this.status === "playing" ? getCandidateMoves(this.board, this.turn) : [],
      chatHistory: [...this.chatHistory],
      updatedAt: this.updatedAt
    };
  }

  public applyMove(
    actionId: string,
    player: number,
    reason?: string
  ): { ok: boolean; error?: string; winner?: number | null; chineseMove?: string } {
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

    const chineseMove = toChineseNotation(this.board, match, player);
    const capturedPiece = this.board[toY][toX] !== 0 ? this.board[toY][toX] : undefined;

    // Apply move
    this.board[toY][toX] = piece;
    this.board[fromY][fromX] = 0;

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
      player,
      stepIndex: this.moveHistory.length + 1,
      timestamp: Date.now(),
      reason
    };
    this.moveHistory.push(moveRecord);
    this.updatedAt = Date.now();

    // Check opponent status
    const opponent = player === PLAYER_RED ? PLAYER_BLACK : PLAYER_RED;
    const opponentLegalMoves = getLegalMoves(this.board, opponent);

    if (opponentLegalMoves.length === 0) {
      // Opponent is checkmated or stalemated
      this.status = player === PLAYER_RED ? "player_won" : "agent_won";
      this.winner = player;
      return { ok: true, winner: player, chineseMove };
    }

    // Switch turn
    this.turn = opponent;
    return { ok: true, chineseMove };
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
    this.status = winningPlayer === PLAYER_RED ? "player_won" : "agent_won";
    this.winner = winningPlayer;
    this.updatedAt = Date.now();
    this.addChat(
      player === PLAYER_RED ? "player" : "agent",
      reason ? `认输: ${reason}` : "我认输了，这一局你下得漂亮！",
      "calm"
    );
    return { ok: true, winner: winningPlayer };
  }
}
