import test from "node:test";
import assert from "node:assert/strict";

import {
  GomokuGameInstance,
  PLAYER_BLACK,
  PLAYER_WHITE
} from "../dist-electron/games/gomokuEngine.js";
import {
  dispatchGameAction,
  getOrCreateGame,
  handlePlayerMove
} from "../dist-electron/gameToolService.js";
import { createGameMcpServer } from "../dist-electron/mcp/gameMcpServer.js";

test("Game MCP server creates properly with expected tools", () => {
  const server = createGameMcpServer();
  assert.ok(server);
});

test("Game tool service dispatches actions correctly", async () => {
  const conversationId = `conv-test-${Date.now()}`;
  const binding = {
    token: "test-token",
    taskSessionId: "session-1",
    conversationId,
    gameType: "gomoku"
  };

  // 1. Get initial state
  const stateRes = await dispatchGameAction(binding, "get_state", {});
  assert.equal(stateRes.ok, true);
  assert.ok(stateRes.gameState);
  assert.equal(stateRes.gameState.gameType, "gomoku");
  assert.equal(stateRes.gameState.turn, PLAYER_BLACK);
  assert.equal(stateRes.gameState.legalMoves.length > 0, true);

  // 2. Player makes a move: H8
  const playerRes = handlePlayerMove(conversationId, "H8");
  assert.equal(playerRes.ok, true);
  assert.equal(playerRes.gameState.turn, PLAYER_WHITE);
  assert.equal(playerRes.gameState.board[7][7], PLAYER_BLACK);

  // 3. Agent attempts illegal move on occupied H8
  const illegalRes = await dispatchGameAction(binding, "make_move", {
    actionId: "H8"
  });
  assert.equal(illegalRes.ok, false);
  assert.match(illegalRes.error, /already occupied/i);

  // 4. Agent makes legal move: H9
  const legalMoveRes = await dispatchGameAction(binding, "make_move", {
    actionId: "H9",
    reason: "抢占中路邻近要点"
  });
  assert.equal(legalMoveRes.ok, true);
  assert.equal(legalMoveRes.actionId, "H9");
  assert.equal(legalMoveRes.gameState.turn, PLAYER_BLACK);
  assert.equal(legalMoveRes.gameState.board[6][7], PLAYER_WHITE);

  // 5. Agent sends in-game chat
  const chatRes = await dispatchGameAction(binding, "send_chat", {
    message: "这一步走得不错，不过我的白子已经盯紧你了！",
    mood: "confident"
  });
  assert.equal(chatRes.ok, true);
  assert.equal(chatRes.chat.sender, "agent");
  assert.equal(chatRes.chat.message, "这一步走得不错，不过我的白子已经盯紧你了！");
  assert.equal(chatRes.chat.mood, "confident");

  // 6. Agent resigns
  const resignRes = await dispatchGameAction(binding, "resign", {
    reason: "局势不妙，甘拜下风"
  });
  assert.equal(resignRes.ok, true);
  assert.equal(resignRes.gameState.status, "player_won");
  assert.equal(resignRes.gameState.winner, PLAYER_BLACK);
});
