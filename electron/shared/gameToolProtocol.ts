export type GameType = "gomoku" | "xiangqi" | "doudizhu";

export type GameAction =
  | "get_state"
  | "make_move"
  | "send_chat"
  | "resign"
  | "reset"
  | "get_history";

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
  /** Engine-derived Xiangqi notation and tactical facts. */
  chineseMove?: string;
  capturedPieceName?: string;
  givesCheck?: boolean;
  checkmate?: boolean;
  /** Position after this move, including the side to move. */
  positionKey?: string;
  /** Board side that moved: Gomoku 1=Black/2=White, Xiangqi 1=Red/2=Black. */
  player: number;
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
  /** Static-exchange result of playing this move (xiangqi). */
  safety?: "lose" | "trade" | "gain";
  /** Playing this move lets the opponent deliver mate in one. */
  allowsMate?: boolean;
  /** Piece we would hang when safety === "lose". */
  lossPiece?: string;
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
  /** Board side to move: Gomoku 1=Black/2=White, Xiangqi 1=Red/2=Black. */
  turn: number;
  /** Board side controlled by the human player. */
  playerSide: number;
  /** Board side controlled by the Agent. */
  agentSide: number;
  stepCount: number;
  winner?: number | null;
  board: number[][]; // 15x15 for Gomoku, 10x9 for Xiangqi
  asciiBoard?: string;
  lastMove?: GameMoveRecord | null;
  moveHistory?: GameMoveRecord[];
  /** Persisted only with full history; used for repetition detection/search. */
  positionHistory?: string[];
  recentMoves?: GameMoveRecord[];
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
  gameType?: GameType;
  status?: GameStatus;
  turn?: number;
  winner?: number | null;
  gameState?: GameStateSnapshot;
  message?: string;
  error?: string;
  actionId?: string;
  chat?: GameChatMessage;
  moveHistory?: GameMoveRecord[];
  chatHistory?: GameChatMessage[];
  stepCount?: number;
  lastMove?: GameMoveRecord | null;
  candidateMoveCount?: number;
  moveFacts?: {
    chineseMove?: string;
    capturedPiece?: number;
    capturedPieceName?: string;
    isCheck: boolean;
    isCheckmate: boolean;
    isStalemate: boolean;
    draw: boolean;
  };
  [key: string]: unknown;
}

export interface GameToolBinding {
  token: string;
  taskSessionId: string;
  conversationId?: string;
  gameType: GameType;
}
