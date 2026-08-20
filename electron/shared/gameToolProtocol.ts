export type GameType = "gomoku" | "xiangqi" | "doudizhu";

export type GameAction =
  | "get_state"
  | "make_move"
  | "send_chat"
  | "resign"
  | "reset";

export type GameStatus =
  | "waiting"
  | "playing"
  | "player_won"
  | "agent_won"
  | "draw"
  | "resigned";

export interface GameMoveRecord {
  actionId: string;
  x: number;
  y: number;
  fromX?: number;
  fromY?: number;
  toX?: number;
  toY?: number;
  piece?: number;
  capturedPiece?: number;
  player: number; // 1: Player, 2: Agent
  stepIndex: number;
  timestamp: number;
  reason?: string;
}

export interface LegalGameMove {
  actionId: string;
  x: number;
  y: number;
  fromX?: number;
  fromY?: number;
  toX?: number;
  toY?: number;
  coord: string; // e.g. "H8" or "b2e2"
  description?: string;
  threatLevel?: "winning" | "critical_block" | "attack" | "normal";
}

export interface GameChatMessage {
  sender: "player" | "agent" | "system";
  message: string;
  mood?: "confident" | "mocking" | "nervous" | "calm" | "admiring";
  timestamp: number;
}

export interface GameStateSnapshot {
  gameType: GameType;
  gameId: string;
  status: GameStatus;
  turn: number; // 1: Player, 2: Agent
  stepCount: number;
  winner?: number | null;
  board: number[][]; // 15x15 for Gomoku (0: empty, 1: player, 2: agent)
  lastMove?: GameMoveRecord | null;
  moveHistory: GameMoveRecord[];
  legalMoves: LegalGameMove[];
  chatHistory: GameChatMessage[];
  updatedAt: number;
}

export interface GameToolEvent {
  conversationId: string;
  gameType: GameType;
  action: GameAction;
  params: Record<string, unknown>;
}

export interface GameToolResult {
  ok: boolean;
  gameId?: string;
  gameState?: GameStateSnapshot;
  message?: string;
  error?: string;
  actionId?: string;
  chat?: GameChatMessage;
  [key: string]: unknown;
}

export interface GameToolBinding {
  token: string;
  taskSessionId: string;
  conversationId?: string;
  gameType: GameType;
}
