import test from "node:test";
import assert from "node:assert/strict";

import {
  createInitialBoard,
  coordToString,
  moveToString,
  stringToMove,
  getPseudoLegalMoves,
  getLegalMoves,
  isKingInCheck,
  getCandidateMoves,
  XiangqiGameInstance,
  PIECE_KING,
  PIECE_ADVISOR,
  PIECE_BISHOP,
  PIECE_KNIGHT,
  PIECE_ROOK,
  PIECE_CANNON,
  PIECE_PAWN,
  PLAYER_RED,
  PLAYER_BLACK
} from "../dist-electron/games/xiangqiEngine.js";

test("Xiangqi initial board layout and coordinate conversion", () => {
  const board = createInitialBoard();
  assert.equal(board.length, 10, "Should have 10 rows");
  assert.equal(board[0].length, 9, "Should have 9 columns");

  // Red pieces
  assert.equal(board[0][4], PIECE_KING, "Red King at (4,0)");
  assert.equal(board[0][0], PIECE_ROOK, "Red left Rook at (0,0)");
  assert.equal(board[0][8], PIECE_ROOK, "Red right Rook at (8,0)");
  assert.equal(board[2][1], PIECE_CANNON, "Red left Cannon at (1,2)");
  assert.equal(board[3][4], PIECE_PAWN, "Red central Pawn at (4,3)");

  // Black pieces
  assert.equal(board[9][4], -PIECE_KING, "Black King at (4,9)");
  assert.equal(board[7][1], -PIECE_CANNON, "Black left Cannon at (1,7)");
  assert.equal(board[6][4], -PIECE_PAWN, "Black central Pawn at (4,6)");

  // Coordinate string conversions
  assert.equal(coordToString(1, 2), "b2");
  assert.equal(coordToString(4, 2), "e2");
  assert.equal(moveToString(1, 2, 4, 2), "b2e2");

  const parsed = stringToMove("b2e2");
  assert.deepEqual(parsed, { fromX: 1, fromY: 2, toX: 4, toY: 2 });
});

test("Xiangqi piece rules: Knight leg block and Cannon jump", () => {
  const board = Array.from({ length: 10 }, () => Array(9).fill(0));

  // 1. Knight at (4, 4)
  board[4][4] = PIECE_KNIGHT;
  let knightMoves = getPseudoLegalMoves(board, 4, 4);
  assert.equal(knightMoves.length, 8, "Free knight in center should have 8 moves");

  // Block top horse leg at (4, 5)
  board[5][4] = PIECE_PAWN;
  knightMoves = getPseudoLegalMoves(board, 4, 4);
  assert.equal(knightMoves.length, 6, "Knight with one leg blocked should have 6 moves");

  // 2. Cannon at (1, 2) with screen at (4, 2) and black target at (7, 2)
  const cBoard = Array.from({ length: 10 }, () => Array(9).fill(0));
  cBoard[2][1] = PIECE_CANNON;
  cBoard[2][4] = PIECE_PAWN; // Screen (炮架)
  cBoard[2][7] = -PIECE_KNIGHT; // Target
  const cannonMoves = getPseudoLegalMoves(cBoard, 1, 2);

  // Should contain normal moves up to screen (x=2, 3), and jump capture at (7, 2)
  const canCapture = cannonMoves.some((m) => m.toX === 7 && m.toY === 2);
  assert.equal(canCapture, true, "Cannon should jump over 1 screen to capture target");
});

test("Xiangqi piece rules: Elephant eye block and river limit", () => {
  const board = Array.from({ length: 10 }, () => Array(9).fill(0));

  // Red Elephant at (2, 0)
  board[0][2] = PIECE_BISHOP;
  let moves = getPseudoLegalMoves(board, 2, 0);
  assert.equal(moves.length, 2, "Opening elephant should have 2 moves ((0,2), (4,2))");

  // Block elephant eye at (1, 1)
  board[1][1] = PIECE_PAWN;
  moves = getPseudoLegalMoves(board, 2, 0);
  assert.equal(moves.length, 1, "Blocked elephant eye removes diagonal move");
  assert.deepEqual(moves[0], { toX: 4, toY: 2 });
});

test("Xiangqi piece rules: Pawn river crossing", () => {
  const board = Array.from({ length: 10 }, () => Array(9).fill(0));

  // Red pawn before river (y=3)
  board[3][4] = PIECE_PAWN;
  let moves = getPseudoLegalMoves(board, 4, 3);
  assert.equal(moves.length, 1, "Pawn before river can only move forward 1 step");
  assert.deepEqual(moves[0], { toX: 4, toY: 4 });

  // Red pawn after crossing river (y=6)
  board[6][4] = PIECE_PAWN;
  moves = getPseudoLegalMoves(board, 4, 6);
  assert.equal(moves.length, 3, "Pawn after river can move forward and sideways");
});

test("Xiangqi Flying General check (对将 / 飞将)", () => {
  const board = Array.from({ length: 10 }, () => Array(9).fill(0));
  board[0][4] = PIECE_KING;   // Red King
  board[9][4] = -PIECE_KING;  // Black King (same column, no pieces in between)

  const isChecked = isKingInCheck(board, PLAYER_RED);
  assert.equal(isChecked, true, "Direct line of sight between Kings should trigger check");

  // Place a piece in between
  board[4][4] = PIECE_PAWN;
  const isCheckedAfterBlock = isKingInCheck(board, PLAYER_RED);
  assert.equal(isCheckedAfterBlock, false, "Piece between Kings blocks Flying General");
});

test("Xiangqi Game Instance execution and candidate generation", () => {
  const game = new XiangqiGameInstance("test-game-1");
  assert.equal(game.status, "playing");
  assert.equal(game.turn, PLAYER_RED);

  // Legal candidate moves should exist for opening
  const candidates = getCandidateMoves(game.board, PLAYER_RED);
  assert.ok(candidates.length > 0, "Should generate candidate legal opening moves");

  // Execute standard opening: Central Cannon (炮二平五 / b2e2)
  const res = game.applyMove("b2e2", PLAYER_RED, "当头炮架中路控局");
  assert.equal(res.ok, true, "Move b2e2 should be accepted");
  assert.equal(game.turn, PLAYER_BLACK, "Turn should switch to Black");
  assert.equal(game.board[2][4], PIECE_CANNON, "Cannon should now be at (4,2)");
  assert.equal(game.board[2][1], 0, "Original square (1,2) should now be empty");

  // Snapshot integrity
  const snapshot = game.getSnapshot();
  assert.equal(snapshot.gameType, "xiangqi");
  assert.equal(snapshot.stepCount, 1);
  assert.equal(snapshot.lastMove?.actionId, "b2e2");
});
