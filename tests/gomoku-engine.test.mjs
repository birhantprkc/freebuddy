import test from "node:test";
import assert from "node:assert/strict";

import {
  GomokuGameInstance,
  coordToString,
  stringToCoord,
  checkWin,
  evaluateThreat,
  getCandidateMoves,
  PLAYER_BLACK,
  PLAYER_WHITE
} from "../dist-electron/games/gomokuEngine.js";

test("Gomoku coordinate conversion", () => {
  // Center: (7, 7) -> H8
  assert.equal(coordToString(7, 7), "H8");
  assert.deepEqual(stringToCoord("H8"), { x: 7, y: 7 });

  // Top-left: (0, 0) -> A15
  assert.equal(coordToString(0, 0), "A15");
  assert.deepEqual(stringToCoord("A15"), { x: 0, y: 0 });

  // Bottom-right: (14, 14) -> O1
  assert.equal(coordToString(14, 14), "O1");
  assert.deepEqual(stringToCoord("O1"), { x: 14, y: 14 });

  // Case insensitive
  assert.deepEqual(stringToCoord("h8"), { x: 7, y: 7 });
  assert.equal(stringToCoord("Z99"), null);
});

test("Gomoku horizontal win detection", () => {
  const game = new GomokuGameInstance("test-game-1");
  assert.equal(game.status, "playing");
  assert.equal(game.turn, PLAYER_BLACK);

  // Black: H8, White: H9, Black: I8, White: I9, Black: J8, White: J9, Black: K8, White: K9, Black: L8 (Win!)
  assert.equal(game.applyMove("H8", PLAYER_BLACK).ok, true);
  assert.equal(game.applyMove("H9", PLAYER_WHITE).ok, true);
  assert.equal(game.applyMove("I8", PLAYER_BLACK).ok, true);
  assert.equal(game.applyMove("I9", PLAYER_WHITE).ok, true);
  assert.equal(game.applyMove("J8", PLAYER_BLACK).ok, true);
  assert.equal(game.applyMove("J9", PLAYER_WHITE).ok, true);
  assert.equal(game.applyMove("K8", PLAYER_BLACK).ok, true);
  assert.equal(game.applyMove("K9", PLAYER_WHITE).ok, true);

  const finalMove = game.applyMove("L8", PLAYER_BLACK);
  assert.equal(finalMove.ok, true);
  assert.equal(finalMove.winner, PLAYER_BLACK);
  assert.equal(game.status, "player_won");
});

test("Gomoku diagonal win detection", () => {
  const game = new GomokuGameInstance("test-game-2");
  // Black: D4, White: A1, Black: E5, White: A2, Black: F6, White: A3, Black: G7, White: A4, Black: H8 (Win!)
  game.applyMove("D4", PLAYER_BLACK);
  game.applyMove("A1", PLAYER_WHITE);
  game.applyMove("E5", PLAYER_BLACK);
  game.applyMove("A2", PLAYER_WHITE);
  game.applyMove("F6", PLAYER_BLACK);
  game.applyMove("A3", PLAYER_WHITE);
  game.applyMove("G7", PLAYER_BLACK);
  game.applyMove("A4", PLAYER_WHITE);

  const res = game.applyMove("H8", PLAYER_BLACK);
  assert.equal(res.ok, true);
  assert.equal(res.winner, PLAYER_BLACK);
  assert.equal(game.status, "player_won");
});

test("Gomoku threat evaluation & candidate moves", () => {
  const game = new GomokuGameInstance("test-game-3");
  // First move should suggest center H8
  const initialMoves = game.getSnapshot().legalMoves;
  assert.ok(initialMoves.length > 0);
  assert.equal(initialMoves[0].coord, "H8");

  // Place Black at H8, I8, J8, K8 (4 in a row)
  game.applyMove("H8", PLAYER_BLACK);
  game.applyMove("A1", PLAYER_WHITE);
  game.applyMove("I8", PLAYER_BLACK);
  game.applyMove("A2", PLAYER_WHITE);
  game.applyMove("J8", PLAYER_BLACK);
  game.applyMove("A3", PLAYER_WHITE);
  game.applyMove("K8", PLAYER_BLACK);

  // Now White's turn. White should see critical block needed at G8 or L8!
  const whiteCandidates = game.getSnapshot().legalMoves;
  const critical = whiteCandidates.filter(m => m.threatLevel === "critical_block");
  assert.ok(critical.length > 0);
  const coords = critical.map(c => c.coord);
  assert.ok(coords.includes("G8") || coords.includes("L8"));
});
