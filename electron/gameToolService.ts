import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import type { WebContents } from "electron";

import { waitForActiveBridgePort } from "./agentBridge.js";
import { safeSendToWebContents } from "./cli/ipcSend.js";
import { GomokuGameInstance, PLAYER_BLACK as GOMOKU_BLACK, PLAYER_WHITE as GOMOKU_WHITE } from "./games/gomokuEngine.js";
import { XiangqiGameInstance, PLAYER_RED as XIANGQI_RED, PLAYER_BLACK as XIANGQI_BLACK } from "./games/xiangqiEngine.js";
import type {
  GameAction,
  GameChatMessage,
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
  winner: number | null;
  getSnapshot(): GameStateSnapshot;
  applyMove(actionId: string, player: number, reason?: string): { ok: boolean; error?: string; winner?: number | null; chineseMove?: string };
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
      gameState: game.getSnapshot()
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

    if (effectiveType === "xiangqi") {
      if (saved && saved.board && Array.isArray(saved.board) && saved.board.length === 10) {
        game = XiangqiGameInstance.fromSnapshot(saved);
      } else {
        game = new XiangqiGameInstance(conversationId);
      }
    } else {
      if (saved && saved.board && Array.isArray(saved.board) && saved.board.length === 15) {
        game = GomokuGameInstance.fromSnapshot(saved);
      } else {
        game = new GomokuGameInstance(conversationId);
      }
    }
    activeGamesByConversation.set(conversationId, game);
  }
  return game;
}

export function broadcastGameUpdate(webContents: WebContents | undefined, snapshot: GameStateSnapshot): void {
  if (webContents && !webContents.isDestroyed()) {
    safeSendToWebContents(webContents, "freebuddy://game-event", {
      type: "GAME_STATE_UPDATE",
      payload: snapshot
    });
  }
  try {
    // Dynamic require so tests outside electron don't fail
    const electron = require("electron");
    const BrowserWindow = electron?.BrowserWindow;
    if (BrowserWindow && typeof BrowserWindow.getAllWindows === "function") {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && (!webContents || win.webContents !== webContents)) {
          safeSendToWebContents(win.webContents, "freebuddy://game-event", {
            type: "GAME_STATE_UPDATE",
            payload: snapshot
          });
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
      gameState: game.getSnapshot()
    };
  }

  if (action === "make_move") {
    const actionId = String(params.actionId || "").trim();
    const reason = typeof params.reason === "string" ? params.reason : undefined;
    if (!actionId) {
      return { ok: false, error: "Missing required 'actionId'." };
    }

    // Agent is player 2
    const res = game.applyMove(actionId, 2, reason);
    if (!res.ok) {
      return { ok: false, error: res.error };
    }

    persistGameState(binding.conversationId, game);
    const snapshot = game.getSnapshot();
    broadcastGameUpdate(binding.webContents, snapshot);

    const moveLabel = res.chineseMove ? `${res.chineseMove} (${actionId})` : actionId;
    return {
      ok: true,
      actionId,
      gameId: game.gameId,
      gameState: snapshot,
      message: res.winner
        ? `落子 ${moveLabel} 成功，并获得胜利！`
        : `落子 ${moveLabel} 成功，轮到玩家行动。`
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
    const snapshot = game.getSnapshot();
    broadcastGameUpdate(binding.webContents, snapshot);

    return {
      ok: true,
      chat,
      gameState: snapshot
    };
  }

  if (action === "resign") {
    const reason = typeof params.reason === "string" ? params.reason : undefined;
    const res = game.resign(2, reason);
    persistGameState(binding.conversationId, game);
    const snapshot = game.getSnapshot();
    broadcastGameUpdate(binding.webContents, snapshot);

    return {
      ok: true,
      gameState: snapshot,
      message: "你已认输，本局游戏结束。"
    };
  }

  if (action === "reset") {
    const newGame =
      binding.gameType === "xiangqi"
        ? new XiangqiGameInstance(binding.conversationId)
        : new GomokuGameInstance(binding.conversationId);
    activeGamesByConversation.set(binding.conversationId, newGame);
    persistGameState(binding.conversationId, newGame);
    const snapshot = newGame.getSnapshot();
    broadcastGameUpdate(binding.webContents, snapshot);

    return {
      ok: true,
      gameState: snapshot,
      message: "对局已重置。"
    };
  }

  return { ok: false, error: `Unknown game action '${action}'.` };
}

export function handlePlayerMove(
  conversationId: string,
  actionId: string,
  webContents?: WebContents
): GameToolResult {
  const game = getOrCreateGame(conversationId);
  if (game.turn === 2 && game.status === "playing") {
    game.turn = 1;
  }
  const res = game.applyMove(actionId, 1);
  if (!res.ok) {
    return { ok: false, error: res.error };
  }
  persistGameState(conversationId, game);
  const snapshot = game.getSnapshot();
  broadcastGameUpdate(webContents, snapshot);
  return {
    ok: true,
    actionId,
    gameId: game.gameId,
    gameState: snapshot
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
  const res = game.applyMove(actionId, 2, reason);
  if (!res.ok) {
    return { ok: false, error: res.error };
  }
  if (speech) {
    game.addChat("agent", speech, mood);
  }
  persistGameState(conversationId, game);
  const snapshot = game.getSnapshot();
  broadcastGameUpdate(webContents, snapshot);
  return {
    ok: true,
    actionId,
    gameId: game.gameId,
    gameState: snapshot
  };
}

export function handleResetGame(
  conversationId: string,
  webContents?: WebContents
): GameToolResult {
  const existing = activeGamesByConversation.get(conversationId);
  const isXiangqi = existing?.getSnapshot().gameType === "xiangqi";
  const newGame = isXiangqi
    ? new XiangqiGameInstance(conversationId)
    : new GomokuGameInstance(conversationId);
  activeGamesByConversation.set(conversationId, newGame);
  persistGameState(conversationId, newGame);
  const snapshot = newGame.getSnapshot();
  broadcastGameUpdate(webContents, snapshot);
  return {
    ok: true,
    gameId: newGame.gameId,
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
