import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { WebContents } from "electron";

import { waitForActiveBridgePort } from "./agentBridge.js";
import { safeSendToWebContents } from "./cli/ipcSend.js";
import { GomokuGameInstance } from "./games/gomokuEngine.js";
import { renderGomokuBoardAscii, renderXiangqiBoardAscii } from "./games/boardDisplay.js";
import { XiangqiGameInstance } from "./games/xiangqiEngine.js";
import type {
  GameAction,
  GameChatMessage,
  GameMoveRecord,
  GameStateSnapshot,
  GameStatus,
  GameToolBinding,
  GameToolResult,
  GameType
} from "./shared/gameToolProtocol.js";
import type { AcpStdioMcpServer } from "./shared/browserToolProtocol.js";

const GAME_TOOL_PATH = "/freebuddy/game-tool";
const MAX_REQUEST_BYTES = 256 * 1024;

export interface GameInstance {
  gameId: string;
  status: GameStatus;
  turn: number;
  playerSide: number;
  agentSide: number;
  winner: number | null;
  moveHistory: GameMoveRecord[];
  chatHistory: GameChatMessage[];
  getSnapshot(options?: { includeHistory?: boolean }): GameStateSnapshot;
  applyMove(
    actionId: string,
    player: number,
    reason?: string,
    options?: { rejectAvoidableMate?: boolean }
  ): {
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
  };
  addChat(sender: "player" | "agent" | "system", message: string, mood?: any): GameChatMessage;
  resign(player: number, reason?: string): { ok: boolean; winner: number };
}

interface GameSessionBinding extends GameToolBinding {
  taskSessionId: string;
  conversationId: string;
  gameType: GameType;
  webContents?: WebContents;
}

let getConversationFn: ((id: string) => any) | null = null;
let updateMetadataFn: ((id: string, patch: Record<string, unknown>) => void) | null = null;

export function initGamePersistence(
  getConv: (id: string) => any,
  updateMeta: (id: string, patch: Record<string, unknown>) => void
): void {
  getConversationFn = getConv;
  updateMetadataFn = updateMeta;
}

const bindingsByToken = new Map<string, GameSessionBinding>();
const tokensByTaskSession = new Map<string, string>();
const activeGamesByConversation = new Map<string, GameInstance>();

interface PendingAutoMove {
  timer: NodeJS.Timeout;
  worker?: Worker;
}

interface EngineSuggestion {
  actionId: string;
  reason?: string;
}

const pendingAutoMoves = new Map<string, PendingAutoMove>();

export const ENGINE_AUTO_MOVE_DELAY_MS = 550;

function withAsciiBoard(game: GameInstance, options?: { includeHistory?: boolean }): GameStateSnapshot {
  const snapshot = game.getSnapshot(options);
  snapshot.asciiBoard =
    snapshot.gameType === "xiangqi"
      ? renderXiangqiBoardAscii(snapshot.board)
      : renderGomokuBoardAscii(snapshot.board);
  return snapshot;
}

export function enrichSnapshot(game: GameInstance, conversationId?: string): GameStateSnapshot {
  const snapshot = withAsciiBoard(game, { includeHistory: true });
  if (!conversationId) return snapshot;
  const conv = getConversationFn ? getConversationFn(conversationId) : undefined;
  const meta = conv?.metadata;
  if (meta) {
    snapshot.gameMode = (meta.gameMode as any) || "player_vs_agent";
    if (typeof meta.engineSide === "number") {
      snapshot.engineSide = meta.engineSide;
    }
    if (meta.gameMode === "agent_vs_agent") {
      snapshot.participants = {
        side1: {
          id: String(meta.agent1Id || "agent1"),
          name: String(meta.agent1Name || "AI 1"),
          model: meta.agent1Model ? String(meta.agent1Model) : undefined,
          side: 1,
          kind: "agent"
        },
        side2: {
          id: String(meta.agent2Id || "agent2"),
          name: String(meta.agent2Name || "AI 2"),
          model: meta.agent2Model ? String(meta.agent2Model) : undefined,
          side: 2,
          kind: "agent"
        }
      };
    } else if (meta.gameMode === "agent_vs_engine") {
      const agentSide = meta.agentSide === 2 ? 2 : 1;
      const engSide = meta.engineSide === 1 ? 1 : 2;
      snapshot.participants = {
        side1: agentSide === 1
          ? {
              id: String(meta.opponentAgentId || conv.agentId || "agent"),
              name: String(conv.agentName || "AI Agent"),
              model: meta.opponentModel ? String(meta.opponentModel) : undefined,
              side: 1,
              kind: "agent"
            }
          : { id: "engine", name: "极智引擎", side: 1, kind: "engine" },
        side2: agentSide === 2
          ? {
              id: String(meta.opponentAgentId || conv.agentId || "agent"),
              name: String(conv.agentName || "AI Agent"),
              model: meta.opponentModel ? String(meta.opponentModel) : undefined,
              side: 2,
              kind: "agent"
            }
          : { id: "engine", name: "极智引擎", side: 2, kind: "engine" }
      };
    }
  }
  return snapshot;
}

function gameMcpServerPath(): string {
  return fileURLToPath(new URL("./mcp/gameMcpServer.js", import.meta.url));
}

function createCapabilityToken(): string {
  return randomBytes(32).toString("base64url");
}

export function persistGameState(conversationId: string, game: GameInstance): void {
  if (!updateMetadataFn) return;
  try {
    updateMetadataFn(conversationId, {
      gameState: game.getSnapshot({ includeHistory: true })
    });
  } catch (err) {
    console.warn(`[FreeBuddy] Failed to persist game state for ${conversationId}:`, err);
  }
}

export function getOrCreateGame(conversationId: string, gameType: GameType = "gomoku"): GameInstance {
  let game = activeGamesByConversation.get(conversationId);
  if (!game) {
    const conv = getConversationFn ? getConversationFn(conversationId) : undefined;
    const saved = conv?.metadata?.gameState as GameStateSnapshot | undefined;
    const effectiveType = (saved?.gameType || conv?.metadata?.gameType || gameType) as GameType;
    const isSpectator =
      conv?.metadata?.gameMode === "agent_vs_agent" ||
      conv?.metadata?.gameMode === "agent_vs_engine" ||
      conv?.metadata?.playerSide === 0;

    const configuredPlayerSide = isSpectator
      ? 0
      : saved?.playerSide === 1 || saved?.playerSide === 2
        ? saved.playerSide
        : conv?.metadata?.hand === "agent_first"
          ? 2
          : 1;

    if (effectiveType === "xiangqi") {
      if (saved && saved.board && Array.isArray(saved.board) && saved.board.length === 10) {
        game = XiangqiGameInstance.fromSnapshot(saved, configuredPlayerSide);
      } else {
        game = new XiangqiGameInstance(conversationId, configuredPlayerSide);
      }
    } else {
      if (saved && saved.board && Array.isArray(saved.board) && saved.board.length === 15) {
        game = GomokuGameInstance.fromSnapshot(saved, configuredPlayerSide);
      } else {
        game = new GomokuGameInstance(conversationId, configuredPlayerSide);
      }
    }
    activeGamesByConversation.set(conversationId, game);
  }
  return game;
}

export function broadcastGameUpdate(
  webContents: WebContents | undefined,
  snapshot: GameStateSnapshot,
  conversationId?: string
): void {
  const event = {
    type: "GAME_STATE_UPDATE",
    conversationId: conversationId || snapshot.gameId,
    payload: snapshot
  };
  if (webContents && !webContents.isDestroyed()) {
    safeSendToWebContents(webContents, "freebuddy://game-event", event);
  }
  try {
    // Dynamic require so tests outside electron don't fail
    const electron = require("electron");
    const BrowserWindow = electron?.BrowserWindow;
    if (BrowserWindow && typeof BrowserWindow.getAllWindows === "function") {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && (!webContents || win.webContents !== webContents)) {
          safeSendToWebContents(win.webContents, "freebuddy://game-event", event);
        }
      }
    }
  } catch {
    /* best effort */
  }
}

export async function dispatchGameAction(
  binding: GameSessionBinding,
  action: GameAction,
  params: Record<string, unknown>
): Promise<GameToolResult> {
  const game = getOrCreateGame(binding.conversationId, binding.gameType);

  if (action === "get_state") {
    return {
      ok: true,
      gameId: game.gameId,
      gameState: withAsciiBoard(game)
    };
  }

  if (action === "get_history") {
    const limit = typeof params.limit === "number" && params.limit > 0 ? params.limit : undefined;
    const moves = limit ? game.moveHistory.slice(-limit) : [...game.moveHistory];
    const chats = limit ? game.chatHistory.slice(-limit) : [...game.chatHistory];
    return {
      ok: true,
      gameId: game.gameId,
      gameType: game.getSnapshot().gameType,
      stepCount: game.moveHistory.length,
      moveHistory: moves,
      chatHistory: chats
    };
  }

  if (action === "make_move") {
    const actionId = String(params.actionId || "").trim();
    const reason = typeof params.reason === "string" ? params.reason : undefined;
    if (!actionId) {
      return { ok: false, error: "Missing required 'actionId'." };
    }

    const conv = getConversationFn ? getConversationFn(binding.conversationId) : undefined;
    const mode = conv?.metadata?.gameMode;
    const movingSide = (mode === "agent_vs_agent" || mode === "agent_vs_engine")
      ? game.turn
      : game.agentSide;

    const res = game.applyMove(actionId, movingSide, reason, {
      rejectAvoidableMate: true
    });
    if (!res.ok) {
      return { ok: false, error: res.error };
    }
    cancelAgentAutoMove(binding.conversationId);

    const trimmedReason = reason?.trim();
    const chat =
      trimmedReason && trimmedReason.length > 0
        ? game.addChat("agent", trimmedReason)
        : undefined;

    persistGameState(binding.conversationId, game);
    const snapshot = enrichSnapshot(game, binding.conversationId);
    broadcastGameUpdate(binding.webContents, snapshot, binding.conversationId);

    const moveLabel = res.chineseMove ? `${res.chineseMove} (${actionId})` : actionId;
    const factParts: string[] = [];
    if (res.capturedPieceName) factParts.push(`吃${res.capturedPieceName}`);
    if (res.isCheckmate) factParts.push("绝杀");
    else if (res.isCheck) factParts.push("将军");
    if (res.draw) factParts.push("三次重复，和棋");
    const factSuffix = factParts.length > 0 ? `；${factParts.join("，")}` : "";

    // If game continues and next turn belongs to engine, schedule auto-move
    scheduleAgentAutoMove(binding.conversationId, binding.webContents);

    return {
      ok: true,
      actionId,
      gameId: game.gameId,
      gameType: snapshot.gameType,
      status: snapshot.status,
      winner: snapshot.winner,
      stepCount: snapshot.stepCount,
      chat,
      moveFacts: {
        chineseMove: res.chineseMove,
        capturedPiece: res.capturedPiece,
        capturedPieceName: res.capturedPieceName,
        isCheck: res.isCheck ?? false,
        isCheckmate: res.isCheckmate ?? false,
        isStalemate: res.isStalemate ?? false,
        draw: res.draw ?? false
      },
      message: res.winner
        ? `落子 ${moveLabel} 成功${factSuffix}，本局获胜。`
        : res.draw
          ? `落子 ${moveLabel} 成功${factSuffix}。`
          : `落子 ${moveLabel} 成功${factSuffix}，轮到下一方行动。`
    };
  }

  if (action === "send_chat") {
    const message = String(params.message || "").trim();
    const mood = params.mood as any;
    if (!message) {
      return { ok: false, error: "Missing required 'message'." };
    }

    const chat = game.addChat("agent", message, mood);
    persistGameState(binding.conversationId, game);
    const snapshot = enrichSnapshot(game, binding.conversationId);
    broadcastGameUpdate(binding.webContents, snapshot, binding.conversationId);

    return {
      ok: true,
      chat,
      gameId: game.gameId,
      gameType: snapshot.gameType,
      status: snapshot.status,
      stepCount: snapshot.stepCount
    };
  }

  if (action === "resign") {
    const reason = typeof params.reason === "string" ? params.reason : undefined;
    const res = game.resign(game.agentSide, reason);
    if (!res.ok) {
      return { ok: false, error: "Game is already over." };
    }
    persistGameState(binding.conversationId, game);
    const snapshot = enrichSnapshot(game, binding.conversationId);
    broadcastGameUpdate(binding.webContents, snapshot, binding.conversationId);

    return {
      ok: true,
      gameState: snapshot,
      message: "你已认输，本局游戏结束。"
    };
  }

  if (action === "reset") {
    const newGame =
      binding.gameType === "xiangqi"
        ? new XiangqiGameInstance(binding.conversationId, game.playerSide)
        : new GomokuGameInstance(binding.conversationId, game.playerSide);
    activeGamesByConversation.set(binding.conversationId, newGame);
    persistGameState(binding.conversationId, newGame);
    const snapshot = enrichSnapshot(newGame, binding.conversationId);
    broadcastGameUpdate(binding.webContents, snapshot, binding.conversationId);
    const autoPlayScheduled = scheduleAgentAutoMove(
      binding.conversationId,
      binding.webContents
    );

    return {
      ok: true,
      gameState: snapshot,
      agentAutoPlayScheduled: autoPlayScheduled,
      message: "对局已重置。"
    };
  }

  return { ok: false, error: `Unknown game action '${action}'.` };
}

function conversationDifficulty(conversationId: string): string | undefined {
  const conv = getConversationFn ? getConversationFn(conversationId) : undefined;
  return conv?.metadata?.gameDifficulty;
}

export function cancelAgentAutoMove(conversationId: string): void {
  const pending = pendingAutoMoves.get(conversationId);
  if (pending) {
    clearTimeout(pending.timer);
    if (pending.worker) void pending.worker.terminate();
    pendingAutoMoves.delete(conversationId);
  }
}

function shouldScheduleEngineMove(conversationId: string, game: GameInstance): boolean {
  if (game.status !== "playing") return false;
  const conv = getConversationFn ? getConversationFn(conversationId) : undefined;
  const meta = conv?.metadata;
  if (meta?.gameMode === "agent_vs_engine") {
    const engineSide = typeof meta.engineSide === "number"
      ? meta.engineSide
      : (meta.hand === "agent_first" ? 2 : 1);
    return game.turn === engineSide;
  }
  return conversationDifficulty(conversationId) === "hard" && game.turn === game.agentSide;
}

function searchInWorker(
  conversationId: string,
  pending: PendingAutoMove,
  snapshot: GameStateSnapshot,
  positionHistory?: string[],
  recentMoves?: GameMoveRecord[]
): Promise<EngineSuggestion | null> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./games/gameSearchWorker.js", import.meta.url));
    } catch (err) {
      console.warn(`[FreeBuddy] Failed to start engine worker for ${conversationId}:`, err);
      resolve(null);
      return;
    }
    pending.worker = worker;
    let settled = false;
    const finish = (suggestion: EngineSuggestion | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(safetyTimer);
      void worker.terminate();
      resolve(suggestion);
    };
    const safetyTimer = setTimeout(() => finish(null), 1_500);
    worker.once("message", (message: { ok?: boolean; suggestion?: EngineSuggestion }) => {
      finish(message?.ok ? message.suggestion ?? null : null);
    });
    worker.once("error", (err) => {
      console.warn(`[FreeBuddy] Engine worker failed for ${conversationId}:`, err);
      finish(null);
    });
    try {
      worker.postMessage({
        gameType: snapshot.gameType,
        board: snapshot.board,
        player: snapshot.turn,
        maxDepth: 6,
        timeBudgetMs: 700,
        positionHistory,
        recentMoves
      });
    } catch (err) {
      console.warn(`[FreeBuddy] Failed to dispatch engine search for ${conversationId}:`, err);
      finish(null);
    }
  });
}

function applyEngineSuggestion(
  conversationId: string,
  game: GameInstance,
  suggestion: EngineSuggestion | null,
  webContents?: WebContents
): boolean {
  const snapshot = game.getSnapshot();
  const safeFallbackIds = snapshot.legalMoves
    .filter((move) => move.allowsMate !== true)
    .map((move) => move.actionId);
  const allFallbackIds = snapshot.legalMoves.map((move) => move.actionId);
  const actionIds = [suggestion?.actionId, ...safeFallbackIds, ...allFallbackIds].filter(
    (actionId, index, all): actionId is string =>
      Boolean(actionId) && all.indexOf(actionId) === index
  );

  for (const actionId of actionIds) {
    const reason = actionId === suggestion?.actionId ? suggestion.reason : "选择安全合法着法";
    const movingSide = game.turn;
    const result = game.applyMove(actionId, movingSide, reason, {
      rejectAvoidableMate: true
    });
    if (!result.ok) continue;
    if (reason && reason.trim()) {
      game.addChat("agent", reason.trim());
    }
    persistGameState(conversationId, game);
    broadcastGameUpdate(webContents, enrichSnapshot(game, conversationId), conversationId);
    return true;
  }
  return false;
}

function scheduleAgentAutoMove(
  conversationId: string,
  webContents?: WebContents
): boolean {
  const game = activeGamesByConversation.get(conversationId);
  if (!game || !shouldScheduleEngineMove(conversationId, game)) {
    return false;
  }

  if (pendingAutoMoves.has(conversationId)) return true;
  let pending: PendingAutoMove;
  const expectedGameId = game.gameId;
  const expectedStepCount = game.moveHistory.length;
  const timer = setTimeout(() => {
    void (async () => {
      try {
        const inst = getOrCreateGame(conversationId);
        if (
          inst.gameId !== expectedGameId ||
          inst.status !== "playing" ||
          !shouldScheduleEngineMove(conversationId, inst) ||
          inst.moveHistory.length !== expectedStepCount
        ) return;

        const boardSnapshot = inst.getSnapshot();
        const suggestion = await searchInWorker(
          conversationId,
          pending,
          boardSnapshot,
          inst instanceof XiangqiGameInstance ? inst.positionHistory : undefined,
          inst.moveHistory
        );
        const current = getOrCreateGame(conversationId);
        if (
          current.gameId !== expectedGameId ||
          current.status !== "playing" ||
          !shouldScheduleEngineMove(conversationId, current) ||
          current.moveHistory.length !== expectedStepCount
        ) return;
        if (!applyEngineSuggestion(conversationId, current, suggestion, webContents)) {
          console.warn(`[FreeBuddy] Engine found no acceptable move for ${conversationId}.`);
        }
      } catch (err) {
        console.warn(`[FreeBuddy] Engine auto move failed for ${conversationId}:`, err);
      } finally {
        if (pendingAutoMoves.get(conversationId) === pending) {
          pendingAutoMoves.delete(conversationId);
        }
      }
    })();
  }, ENGINE_AUTO_MOVE_DELAY_MS);
  pending = { timer };
  pendingAutoMoves.set(conversationId, pending);
  return true;
}

export function handleGetGameState(
  conversationId: string,
  webContents?: WebContents
): GameStateSnapshot {
  const game = getOrCreateGame(conversationId);
  scheduleAgentAutoMove(conversationId, webContents);
  return enrichSnapshot(game, conversationId);
}

export function handlePlayerMove(
  conversationId: string,
  actionId: string,
  webContents?: WebContents
): GameToolResult {
  const game = getOrCreateGame(conversationId);
  const movingSide = game.playerSide || game.turn;
  const res = game.applyMove(actionId, movingSide);
  if (!res.ok) {
    return { ok: false, error: res.error };
  }
  persistGameState(conversationId, game);
  const snapshot = enrichSnapshot(game, conversationId);
  broadcastGameUpdate(webContents, snapshot, conversationId);
  const autoPlayScheduled = scheduleAgentAutoMove(conversationId, webContents);
  return {
    ok: true,
    actionId,
    gameId: game.gameId,
    gameState: snapshot,
    agentAutoPlayScheduled: autoPlayScheduled
  };
}

export function handleAgentMove(
  conversationId: string,
  actionId: string,
  reason?: string,
  speech?: string,
  mood?: "confident" | "mocking" | "nervous" | "calm" | "admiring",
  webContents?: WebContents
): GameToolResult {
  const game = getOrCreateGame(conversationId);
  const movingSide = game.turn;
  const res = game.applyMove(actionId, movingSide, reason, {
    rejectAvoidableMate: true
  });
  if (!res.ok) {
    return { ok: false, error: res.error };
  }
  cancelAgentAutoMove(conversationId);
  if (speech) {
    game.addChat("agent", speech, mood);
  }
  persistGameState(conversationId, game);
  const snapshot = enrichSnapshot(game, conversationId);
  broadcastGameUpdate(webContents, snapshot, conversationId);
  scheduleAgentAutoMove(conversationId, webContents);
  return {
    ok: true,
    actionId,
    gameId: game.gameId,
    gameState: snapshot
  };
}

export function handleSendChat(
  conversationId: string,
  message: string,
  mood?: "confident" | "mocking" | "nervous" | "calm" | "admiring",
  webContents?: WebContents
): GameToolResult {
  const game = getOrCreateGame(conversationId);
  const trimmed = message.trim();
  if (!trimmed) {
    return { ok: false, error: "Missing required 'message'." };
  }
  const chat = game.addChat("agent", trimmed, mood);
  persistGameState(conversationId, game);
  const snapshot = enrichSnapshot(game, conversationId);
  broadcastGameUpdate(webContents, snapshot, conversationId);
  return {
    ok: true,
    chat,
    gameState: snapshot
  };
}

export function handleResetGame(
  conversationId: string,
  webContents?: WebContents
): GameToolResult {
  cancelAgentAutoMove(conversationId);
  const existing = getOrCreateGame(conversationId);
  const isXiangqi = existing.getSnapshot().gameType === "xiangqi";
  const newGame = isXiangqi
    ? new XiangqiGameInstance(conversationId, existing.playerSide)
    : new GomokuGameInstance(conversationId, existing.playerSide);
  activeGamesByConversation.set(conversationId, newGame);
  persistGameState(conversationId, newGame);
  const snapshot = enrichSnapshot(newGame, conversationId);
  broadcastGameUpdate(webContents, snapshot, conversationId);
  const autoPlayScheduled = scheduleAgentAutoMove(conversationId, webContents);
  return {
    ok: true,
    gameId: newGame.gameId,
    gameState: snapshot,
    agentAutoPlayScheduled: autoPlayScheduled
  };
}

export function handlePlayerResign(
  conversationId: string,
  webContents?: WebContents
): GameToolResult {
  cancelAgentAutoMove(conversationId);
  const game = getOrCreateGame(conversationId);
  const result = game.resign(game.playerSide);
  if (!result.ok) {
    return { ok: false, error: "Game is already over." };
  }
  persistGameState(conversationId, game);
  const snapshot = enrichSnapshot(game, conversationId);
  broadcastGameUpdate(webContents, snapshot, conversationId);
  return {
    ok: true,
    gameId: game.gameId,
    gameState: snapshot
  };
}

export async function registerGameToolSession(input: {
  taskSessionId: string;
  conversationId: string;
  gameType?: GameType;
  webContents?: WebContents;
}): Promise<AcpStdioMcpServer> {
  const { taskSessionId, conversationId, gameType = "gomoku", webContents } = input;
  unregisterGameToolSession(taskSessionId);

  const token = createCapabilityToken();
  const binding: GameSessionBinding = {
    token,
    taskSessionId,
    conversationId,
    gameType,
    webContents
  };

  bindingsByToken.set(token, binding);
  tokensByTaskSession.set(taskSessionId, token);

  const port = await waitForActiveBridgePort();
  return {
    name: "freebuddy-game",
    command: process.execPath,
    args: [gameMcpServerPath()],
    env: [
      { name: "ELECTRON_RUN_AS_NODE", value: "1" },
      { name: "FREEBUDDY_GAME_ENDPOINT", value: `http://127.0.0.1:${port}${GAME_TOOL_PATH}` },
      { name: "FREEBUDDY_GAME_TOKEN", value: token },
      { name: "FB_APP_VERSION", value: process.env.FB_APP_VERSION || "0.8.7" }
    ]
  };
}

export function unregisterGameToolSession(taskSessionId: string): void {
  const token = tokensByTaskSession.get(taskSessionId);
  if (!token) return;
  tokensByTaskSession.delete(taskSessionId);
  bindingsByToken.delete(token);
}

export async function handleGameToolHttpRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const url = req.url || "";
  if (!url.startsWith(GAME_TOOL_PATH)) {
    return false;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Method Not Allowed" }));
    return true;
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  const binding = bindingsByToken.get(token);
  if (!binding) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Unauthorized game tool session token" }));
    return true;
  }

  const chunks: Buffer[] = [];
  let bytesRead = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytesRead += buffer.length;
    if (bytesRead > MAX_REQUEST_BYTES) {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Payload too large" }));
      return true;
    }
    chunks.push(buffer);
  }

  let body: { action?: unknown; params?: unknown } = {};
  try {
    const raw = Buffer.concat(chunks).toString("utf8");
    body = raw ? JSON.parse(raw) : {};
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Invalid JSON payload" }));
    return true;
  }

  const action = String(body.action || "") as GameAction;
  const params = (body.params && typeof body.params === "object"
    ? body.params
    : {}) as Record<string, unknown>;

  try {
    const result = await dispatchGameAction(binding, action, params);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: false,
        error: (error as Error)?.message || String(error)
      })
    );
  }

  return true;
}
