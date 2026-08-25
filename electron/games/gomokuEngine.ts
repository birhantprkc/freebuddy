import type {
  GameChatMessage,
  GameMoveRecord,
  GameStateSnapshot,
  GameStatus,
  LegalGameMove
} from "../shared/gameToolProtocol.js";

export const BOARD_SIZE = 15;
export const PLAYER_BLACK = 1;
export const PLAYER_WHITE = 2;

const COLS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O"];

export function coordToString(x: number, y: number): string {
  const col = COLS[x] || `${x}`;
  const row = BOARD_SIZE - y; // 1 to 15
  return `${col}${row}`;
}

export function stringToCoord(coord: string): { x: number; y: number } | null {
  const match = coord.trim().toUpperCase().match(/^([A-O])(\d{1,2})$/);
  if (!match) return null;
  const colLetter = match[1];
  const rowNum = parseInt(match[2], 10);
  const x = COLS.indexOf(colLetter);
  const y = BOARD_SIZE - rowNum;
  if (x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE) {
    return { x, y };
  }
  return null;
}

export function createEmptyBoard(): number[][] {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
}

export function checkWin(board: number[][], x: number, y: number, player: number): boolean {
  const directions = [
    [1, 0],  // Horizontal
    [0, 1],  // Vertical
    [1, 1],  // Diagonal \
    [1, -1]  // Diagonal /
  ];

  for (const [dx, dy] of directions) {
    let count = 1;

    // Positive direction
    let nx = x + dx;
    let ny = y + dy;
    while (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && board[ny][nx] === player) {
      count++;
      nx += dx;
      ny += dy;
    }

    // Negative direction
    nx = x - dx;
    ny = y - dy;
    while (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && board[ny][nx] === player) {
      count++;
      nx -= dx;
      ny -= dy;
    }

    if (count >= 5) {
      return true;
    }
  }

  return false;
}

export function countConsecutive(board: number[][], x: number, y: number, player: number): number {
  const directions = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1]
  ];
  let maxCount = 0;
  for (const [dx, dy] of directions) {
    let count = 1;
    let nx = x + dx;
    let ny = y + dy;
    while (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && board[ny][nx] === player) {
      count++;
      nx += dx;
      ny += dy;
    }
    nx = x - dx;
    ny = y - dy;
    while (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && board[ny][nx] === player) {
      count++;
      nx -= dx;
      ny -= dy;
    }
    if (count > maxCount) maxCount = count;
  }
  return maxCount;
}

export function evaluateThreat(
  board: number[][],
  x: number,
  y: number,
  turnPlayer: number
): "winning" | "critical_block" | "attack" | "normal" {
  const opponent = turnPlayer === PLAYER_BLACK ? PLAYER_WHITE : PLAYER_BLACK;

  // If this move completes 5 for current player -> winning move
  if (checkWin(board, x, y, turnPlayer)) {
    return "winning";
  }

  // If this move blocks an opponent's 5 -> critical block
  if (checkWin(board, x, y, opponent)) {
    return "critical_block";
  }

  // If this move forms 4 consecutive stones -> attack
  const selfCount = countConsecutive(board, x, y, turnPlayer);
  const oppCount = countConsecutive(board, x, y, opponent);
  if (selfCount >= 4 || oppCount >= 4) {
    return "attack";
  }

  return "normal";
}

export function getCandidateMoves(board: number[][], turnPlayer: number): LegalGameMove[] {
  const hasStones = board.some((row) => row.some((cell) => cell !== 0));
  if (!hasStones) {
    const center = Math.floor(BOARD_SIZE / 2);
    return [
      {
        actionId: coordToString(center, center),
        x: center,
        y: center,
        coord: coordToString(center, center),
        description: "天元落子 (H8·经典天元，掌控全盘中心) [天元争锋]",
        threatLevel: "normal",
        priority: 100
      },
      {
        actionId: coordToString(center + 1, center + 1),
        x: center + 1,
        y: center + 1,
        coord: coordToString(center + 1, center + 1),
        description: "斜指占位 (I9·斜向活络，浦月/花月意图) [斜指机变]",
        threatLevel: "normal",
        priority: 90
      },
      {
        actionId: coordToString(center, center + 1),
        x: center,
        y: center + 1,
        coord: coordToString(center, center + 1),
        description: "直指占位 (H9·纵向试探，寒星/溪月意图) [直指攻杀]",
        threatLevel: "normal",
        priority: 85
      },
      {
        actionId: coordToString(center - 1, center - 1),
        x: center - 1,
        y: center - 1,
        coord: coordToString(center - 1, center - 1),
        description: "侧翼星位 (G7·打破常规，灵活腾挪) [灵活求变]",
        threatLevel: "normal",
        priority: 80
      }
    ];
  }

  const occupied = new Set<string>();
  const candidates = new Map<string, { x: number; y: number; priority: number; threatLevel: "winning" | "critical_block" | "attack" | "normal" }>();

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] !== 0) {
        occupied.add(`${x},${y}`);
      }
    }
  }

  // Search neighbors within distance 2 of any existing stone
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] === 0) continue;

      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && board[ny][nx] === 0) {
            const key = `${nx},${ny}`;
            if (!candidates.has(key)) {
              const threat = evaluateThreat(board, nx, ny, turnPlayer);
              let priority = 10;
              if (threat === "winning") priority = 1000;
              else if (threat === "critical_block") priority = 800;
              else if (threat === "attack") priority = 200;
              else if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) priority = 30;

              candidates.set(key, { x: nx, y: ny, priority, threatLevel: threat });
            }
          }
        }
      }
    }
  }

  const sorted = Array.from(candidates.values())
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 30); // Top 30 candidate moves to keep token footprint ultra-clean

  return sorted.map((c) => {
    const coord = coordToString(c.x, c.y);
    let desc = `落子 ${coord}`;
    if (c.threatLevel === "winning") desc = `绝杀胜手 ${coord} (形成五连珠) [绝杀胜手]`;
    else if (c.threatLevel === "critical_block") desc = `关键封堵 ${coord} (拦截对方活四/连五) [关键封堵]`;
    else if (c.threatLevel === "attack") desc = `主动进攻 ${coord} (形成活三/冲四) [主动进攻]`;
    else if (c.priority >= 30) desc = `稳健扩展 ${coord} (邻近占位，蓄势待发) [稳健扩展]`;
    else desc = `空间占位 ${coord} (外围拓展) [空间占位]`;

    return {
      actionId: coord,
      x: c.x,
      y: c.y,
      coord,
      description: desc,
      threatLevel: c.threatLevel,
      priority: c.priority
    };
  });
}

export class GomokuGameInstance {
  public gameId: string;
  public status: GameStatus = "playing";
  public turn: number = PLAYER_BLACK; // Black moves first
  public playerSide: number;
  public agentSide: number;
  public board: number[][];
  public moveHistory: GameMoveRecord[] = [];
  public chatHistory: GameChatMessage[] = [];
  public winner: number | null = null;
  public updatedAt: number = Date.now();

  constructor(gameId: string, playerSide: number = PLAYER_BLACK) {
    this.gameId = gameId;
    this.playerSide = playerSide === 0 ? 0 : playerSide === PLAYER_WHITE ? PLAYER_WHITE : PLAYER_BLACK;
    this.agentSide = this.playerSide === PLAYER_BLACK ? PLAYER_WHITE : PLAYER_BLACK;
    this.board = createEmptyBoard();
  }

  public static fromSnapshot(
    snapshot: GameStateSnapshot,
    playerSide: number = snapshot.playerSide ?? PLAYER_BLACK
  ): GomokuGameInstance {
    const inst = new GomokuGameInstance(snapshot.gameId, playerSide);
    inst.status = snapshot.status;
    inst.turn = snapshot.turn;
    inst.winner = snapshot.winner ?? null;
    inst.board = snapshot.board ? snapshot.board.map((row) => [...row]) : createEmptyBoard();
    inst.moveHistory = [...(snapshot.moveHistory || [])];
    inst.chatHistory = [...(snapshot.chatHistory || [])];
    inst.updatedAt = snapshot.updatedAt || Date.now();
    return inst;
  }

  public getSnapshot(options?: { includeHistory?: boolean }): GameStateSnapshot {
    const includeHistory = options?.includeHistory ?? false;
    return {
      gameType: "gomoku",
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
      recentMoves: this.moveHistory.slice(-3),
      legalMoves: this.status === "playing" ? getCandidateMoves(this.board, this.turn) : [],
      chatHistory: includeHistory ? [...this.chatHistory] : this.chatHistory.slice(-3),
      updatedAt: this.updatedAt
    };
  }

  public applyMove(
    actionId: string,
    player: number,
    reason?: string
  ): { ok: boolean; error?: string; winner?: number | null } {
    if (this.status !== "playing") {
      return { ok: false, error: `Game is already over with status '${this.status}'.` };
    }

    if (this.turn !== player) {
      return { ok: false, error: `Not player ${player}'s turn. Current turn: ${this.turn}` };
    }

    const coord = stringToCoord(actionId);
    if (!coord) {
      return { ok: false, error: `Invalid coordinate actionId '${actionId}'. Format should be like 'H8' or 'D4'.` };
    }

    const { x, y } = coord;
    if (this.board[y][x] !== 0) {
      return { ok: false, error: `Position ${actionId} (${x}, ${y}) is already occupied.` };
    }

    // Apply move
    this.board[y][x] = player;
    const moveRecord: GameMoveRecord = {
      actionId,
      x,
      y,
      player,
      stepIndex: this.moveHistory.length + 1,
      timestamp: Date.now(),
      reason
    };
    this.moveHistory.push(moveRecord);
    this.updatedAt = Date.now();

    // Check win
    if (checkWin(this.board, x, y, player)) {
      this.status = player === this.playerSide ? "player_won" : "agent_won";
      this.winner = player;
      return { ok: true, winner: player };
    }

    // Check draw
    if (this.moveHistory.length >= BOARD_SIZE * BOARD_SIZE) {
      this.status = "draw";
      this.winner = null;
      return { ok: true, winner: null };
    }

    // Switch turn
    this.turn = player === PLAYER_BLACK ? PLAYER_WHITE : PLAYER_BLACK;
    return { ok: true };
  }

  public addChat(sender: "player" | "agent" | "system", message: string, mood?: "confident" | "mocking" | "nervous" | "calm" | "admiring"): GameChatMessage {
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
    const winningPlayer = player === PLAYER_BLACK ? PLAYER_WHITE : PLAYER_BLACK;
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
