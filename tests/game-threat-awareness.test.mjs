import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

import {
  XiangqiGameInstance,
  PLAYER_RED,
  PLAYER_BLACK,
  PIECE_ROOK,
  PIECE_CANNON,
  PIECE_BISHOP,
  PIECE_ADVISOR,
  PIECE_KNIGHT,
  PIECE_PAWN,
  createInitialBoard,
  getCandidateMoves,
  getLegalMoves,
  getPseudoLegalMoves,
  isKingInCheck,
  moveToString,
  xiangqiPositionKey
} from "../dist-electron/games/xiangqiEngine.js";
import { getOpponentCaptureThreats } from "../dist-electron/games/xiangqiEngine.js";
import { formatGameStateText } from "../dist-electron/games/boardDisplay.js";

function blankBoard() {
  return Array.from({ length: 10 }, () => Array(9).fill(0));
}

function replay(actions) {
  const game = new XiangqiGameInstance("replay");
  for (const actionId of actions) {
    const result = game.applyMove(actionId, game.turn);
    assert.equal(result.ok, true, `${actionId}: ${result.error ?? "failed"}`);
  }
  return game;
}

test("opponent capture threats lists attacked pieces with defense status", () => {
  const board = blankBoard();
  // Kings on DIFFERENT files (avoid flying-general face-off)
  board[0][4] = 1; // red K e0
  board[8][3] = -1; // black K d8
  // Black advisor on f9 attacked by red rook f2, no defender
  board[9][5] = -PIECE_ADVISOR;
  board[2][5] = PIECE_ROOK;

  const threats = getOpponentCaptureThreats(board, PLAYER_BLACK);

  assert.equal(threats.length, 1);
  const t = threats[0];
  assert.equal(t.attackerCoord, "f2");
  assert.equal(t.targetCoord, "f9");
  assert.equal(t.defended, false);
});

test("opponent capture threats marks defended targets", () => {
  const board = blankBoard();
  board[0][4] = 1; // red K e0
  board[8][3] = -1; // black K d8, orthogonally adjacent to d9 -> can recapture
  board[9][3] = -PIECE_ADVISOR; // advisor d9
  board[7][4] = PIECE_KNIGHT; // red knight e8 attacks d9 (and does NOT check K d8)

  const threats = getOpponentCaptureThreats(board, PLAYER_BLACK);
  const d9 = threats.find((t) => t.targetCoord === "d9");
  assert.ok(d9, "should detect d9 threat");
  assert.equal(d9.defended, true);
});

test("candidate moves get lose tags when landing on attacked squares", () => {
  const board = blankBoard();
  board[0][4] = 1; // red K e0
  board[8][3] = -1; // black K d8 (not attacked by the knight below)
  board[9][0] = -PIECE_ROOK; // black rook a9
  board[8][6] = PIECE_KNIGHT; // red knight g8 attacks e9 (and does NOT check K d8)

  const moves = new XiangqiGameInstance("t");
  moves.board = board;
  moves.turn = PLAYER_BLACK;
  const cands = moves.getSnapshot().legalMoves;
  const byId = new Map(cands.map((m) => [m.actionId, m]));

  const hangMove = byId.get("a9e9");
  assert.ok(hangMove, "a9e9 should be among candidates");
  assert.equal(hangMove.safety, "lose", `expected lose tag, got ${hangMove.safety}`);
  assert.match(hangMove.description ?? "", /丢/, "description should mention loss");

  const safeMove = byId.get("a9b9");
  assert.ok(safeMove, "a9b9 should be among candidates");
  assert.notEqual(safeMove.safety, "lose", "safe retreat should not be tagged lose");
});

test("formatGameStateText renders opponent threat warnings", () => {
  const inst = new XiangqiGameInstance("t-threat");
  inst.board = blankBoard();
  inst.board[0][4] = 1;
  inst.board[8][3] = -1;
  inst.board[9][5] = -PIECE_ADVISOR; // f9 advisor
  inst.board[2][5] = PIECE_ROOK; // f2 rook attacks it
  inst.turn = PLAYER_BLACK;
  const snap = inst.getSnapshot();

  const text = formatGameStateText(snap);

  assert.match(text, /对方威胁/);
  assert.match(text, /f9/);
  assert.match(text, /f2/);
  assert.match(text, /无保护/);
});

test("candidate safety uses relative baseline (no noisy trade tags)", () => {
  const board = blankBoard();
  board[0][4] = 1; // red K e0
  board[8][3] = -1; // black K d8
  board[9][0] = -PIECE_ROOK; // black rook a9
  board[8][6] = PIECE_KNIGHT; // red knight g8 attacks e9

  const inst = new XiangqiGameInstance("t");
  inst.board = board;
  inst.turn = PLAYER_BLACK;
  const cands = inst.getSnapshot().legalMoves;
  const byId = new Map(cands.map((m) => [m.actionId, m]));

  // Quiet retreat creates no NEW loss -> untagged.
  const quiet = byId.get("a9b9");
  assert.ok(quiet);
  assert.notEqual(quiet.safety, "lose");
});

test("candidates that allow opponent mate-in-1 get the doomed tag", () => {
  // Reconstructed from a real lost game: black cannon sits on e3 guarding
  // the middle; e3i3 abandons the file and allows b4e4 double-cannon mate.
  const board = blankBoard();
  board[9] = [-7, -5, -3, -2, -1, -2, -3, -5, -7]; // black back rank
  board[8] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  board[7] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  board[6] = [7, 0, 7, 0, 6, 7, 0, 7, 0]; // red cannon e6
  board[5] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  board[4] = [0, 6, 0, 0, 0, 0, 0, 0, 0]; // red cannon b4
  board[3] = [7, 0, 7, 0, -6, 0, 7, 0, 7]; // black cannon e3 + pawns a3/c3/g3/i3
  board[2] = [0, 0, 0, 0, 0, 0, 0, 0, 4]; // red knight i2
  board[1] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  board[0] = [0, 5, 3, 2, 1, 2, 3, 0, 5]; // red back rank (rook b0)

  const inst = new XiangqiGameInstance("t");
  inst.board = board;
  inst.turn = PLAYER_BLACK;
  const cands = inst.getSnapshot().legalMoves;
  const greedy = cands.find((m) => m.actionId === "e3i3");
  assert.ok(greedy, "e3i3 should be among candidates");

  assert.equal(greedy.safety, "lose");
  assert.match(greedy.description ?? "", /招致绝杀/, "should flag incoming mate");
});

test("real-game cannon raid is a loss, not a trade", () => {
  const game = replay(["b2e2", "b7e7", "b0c2"]);
  const move = getCandidateMoves(game.board, PLAYER_BLACK, game.moveHistory, 100)
    .find((candidate) => candidate.actionId === "e7e3");

  assert.ok(move, "e7e3 should still be assessable below the displayed candidates");
  assert.equal(move.safety, "lose");
  assert.equal(move.lossPiece, "砲");
  assert.match(move.description ?? "", /丢砲/);
  assert.doesNotMatch(move.description ?? "", /兑子/);

  const result = game.applyMove("e7e3", PLAYER_BLACK);
  assert.equal(result.ok, true);
  assert.equal(result.capturedPieceName, "兵");
  assert.equal(result.isCheck, true, "the server should report the cannon check factually");
  assert.equal(game.moveHistory.at(-1)?.capturedPieceName, "兵");
});

test("blocking check by sacrificing a Rook is tagged as a Rook loss", () => {
  const game = replay([
    "b2e2", "b7e7", "b0c2", "e7e3", "c2e3", "h7g7", "e2e6", "g7g3",
    "e3f5", "g3e3", "f5e3", "b9c7", "e6e4", "a9b9", "e3g4", "b9b0",
    "a0b0", "e9e8", "h2e2", "e8f8", "b0b7", "c7e6", "e2e6", "f9e8",
    "e6a6", "i9i8", "g4f6", "e8f7", "f6d7", "f8f9", "e4f4"
  ]);
  const move = getCandidateMoves(game.board, PLAYER_BLACK, game.moveHistory, 100)
    .find((candidate) => candidate.actionId === "i8f8");

  assert.ok(move);
  assert.equal(move.safety, "lose");
  assert.equal(move.lossPiece, "車");
  assert.match(move.description ?? "", /丢車/);
});

test("agent guard rejects avoidable mate-in-one moves", () => {
  const game = replay([
    "b2e2", "b7e7", "b0c2", "e7e3", "c2e3", "h7g7", "e2e6", "g7g3",
    "e3f5", "g3e3", "f5e3", "b9c7", "e6e4", "a9b9", "e3g4"
  ]);

  const result = game.applyMove("b9b0", PLAYER_BLACK, undefined, {
    rejectAvoidableMate: true
  });
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /mate in one/);
  assert.equal(game.turn, PLAYER_BLACK, "a rejected move must not mutate the turn");
  assert.equal(game.board[9][1], -PIECE_ROOK, "a rejected move must not mutate the board");
});

test("three repetitions finish Xiangqi as a draw", () => {
  const game = new XiangqiGameInstance("repetition");
  game.board = blankBoard();
  game.board[0][4] = 1;
  game.board[9][4] = -1;
  game.board[4][4] = PIECE_PAWN;
  game.board[0][0] = PIECE_ROOK;
  game.board[9][0] = -PIECE_ROOK;
  game.turn = PLAYER_RED;
  game.positionHistory = [xiangqiPositionKey(game.board, game.turn)];

  for (const actionId of [
    "a0b0", "a9b9", "b0a0", "b9a9",
    "a0b0", "a9b9", "b0a0", "b9a9"
  ]) {
    const result = game.applyMove(actionId, game.turn);
    assert.equal(result.ok, true, `${actionId}: ${result.error ?? "failed"}`);
  }

  assert.equal(game.status, "draw");
  assert.equal(game.winner, null);
});

test("skill mandates winning as primary objective", () => {
  const skill = fs.readFileSync(
    new URL("../assets/skills/game-arena/SKILL.md", import.meta.url),
    "utf8"
  );
  assert.match(skill, /首要目标|primary objective/i);
  assert.match(skill, /送子|hanging|不要白白丢/i);
});

test("browser canvas queues turn prompts across the generation race", () => {
  const canvas = fs.readFileSync(
    new URL("../src/components/Browser/BrowserCanvas.tsx", import.meta.url),
    "utf8"
  );
  // Player moves while agent is still streaming -> prompt must be queued and
  // flushed when generation ends, not silently dropped by sendMessage guard.
  assert.match(canvas, /pendingGameTurnPromptRef\.current = \{/);
  assert.match(canvas, /pendingGameTurnPromptRef\.current = null/);
  // Stall detector escalates to an automatic single remind.
  assert.match(canvas, /autoRemindCount/);
});

test("rejected player moves bounce back to the board without prompting the agent", () => {
  const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

  const canvas = read("../src/components/Browser/BrowserCanvas.tsx");
  assert.match(canvas, /MOVE_REJECTED/, "canvas must notify the board on rejection");
  assert.match(
    canvas,
    /ok === false/,
    "canvas must not send an agent prompt for failed moves"
  );
  assert.match(canvas, /RUN_END_RESYNC/, "canvas must resync board when a run ends");

  assert.match(read("../public/games/gomoku/game.js"), /MOVE_REJECTED/);
  assert.match(read("../public/games/xiangqi/game.js"), /MOVE_REJECTED/);
});

test("xiangqi client filters pseudo moves that do not answer check", () => {
  // Reconstruct the reported position: black rook moved e5->f5, uncovering
  // the e7 cannon's check through red advisor e1 onto red king e0.
  const board = blankBoard();
  board[9] = [-PIECE_ROOK, -PIECE_KNIGHT, -PIECE_BISHOP, -PIECE_ADVISOR, -1, -PIECE_ADVISOR, 0, 0, 0];
  board[7][4] = -PIECE_CANNON;
  board[7][8] = -PIECE_BISHOP;
  board[6][0] = -7;
  board[6][2] = 7;
  board[6][8] = -7;
  board[5][5] = -PIECE_ROOK;
  board[3][0] = 7;
  board[3][1] = PIECE_CANNON;
  board[3][2] = 7;
  board[3][8] = 7;
  board[1][4] = PIECE_ADVISOR;
  board[0][0] = PIECE_ROOK;
  board[0][1] = PIECE_KNIGHT;
  board[0][2] = PIECE_BISHOP;
  board[0][4] = 1;
  board[0][5] = PIECE_ADVISOR;

  assert.equal(isKingInCheck(board, PLAYER_RED), true, "red should be in cannon check");
  const legalIds = getLegalMoves(board, PLAYER_RED).map((move) =>
    moveToString(move.fromX, move.fromY, move.toX, move.toY)
  );
  assert.deepEqual(legalIds, ["c0e2", "e0d0", "e1f2", "e1d2", "e1d0"]);

  const client = fs.readFileSync(
    new URL("../public/games/xiangqi/game.js", import.meta.url),
    "utf8"
  );
  assert.match(client, /你已将军/, "the board should also announce when the player checks the Agent");
  const rulesStart = client.indexOf("function isSameSide");
  const rulesEnd = client.indexOf("function handleCanvasClick");
  assert.ok(rulesStart >= 0 && rulesEnd > rulesStart, "client rules block should exist");

  const sandbox = {
    BOARD_COLS: 9,
    BOARD_ROWS: 10,
    board: board.map((row) => [...row]),
    playerSide: PLAYER_RED,
    legalIds: [],
    clientInCheck: false
  };
  vm.runInNewContext(
    `${client.slice(rulesStart, rulesEnd)}
     const cols = "abcdefghi";
     clientInCheck = isClientKingInCheck(true);
     legalIds = [];
     for (let y = 0; y < BOARD_ROWS; y++) {
       for (let x = 0; x < BOARD_COLS; x++) {
         if (board[y][x] <= 0) continue;
         for (const move of getClientLegalMoves(x, y)) {
           legalIds.push(cols[x] + y + cols[move.toX] + move.toY);
         }
       }
     }`,
    sandbox
  );
  assert.equal(sandbox.clientInCheck, true, "client should detect the check immediately");
  assert.deepEqual(
    [...sandbox.legalIds],
    legalIds,
    "instant client targets should exactly match authoritative legal replies"
  );

  assert.match(client, /将军！请立即应将/);
  assert.match(client, /playCheckSound\(\)/);
  const styles = fs.readFileSync(
    new URL("../public/games/xiangqi/style.css", import.meta.url),
    "utf8"
  );
  assert.match(styles, /\.turn-indicator\.in-check/);
});

test("crossed pawn explains sideways moves rejected by a cannon pin", () => {
  // This is the central tactic from the reported game: the crossed red pawn
  // on e5 is the second screen between the black cannon and red king. Moving
  // sideways would leave the advisor on e1 as the cannon's only screen.
  const board = blankBoard();
  board[0][4] = 1;
  board[1][4] = PIECE_ADVISOR;
  board[5][4] = PIECE_PAWN;
  board[5][5] = -PIECE_KNIGHT;
  board[7][4] = -PIECE_CANNON;
  board[9][3] = -1;

  const pawnPseudoIds = getPseudoLegalMoves(board, 4, 5).map((move) =>
    moveToString(4, 5, move.toX, move.toY)
  );
  assert.deepEqual(pawnPseudoIds, ["e5e6", "e5d5", "e5f5"]);

  const pawnLegalIds = getLegalMoves(board, PLAYER_RED)
    .filter((move) => move.fromX === 4 && move.fromY === 5)
    .map((move) => moveToString(move.fromX, move.fromY, move.toX, move.toY));
  assert.deepEqual(
    pawnLegalIds,
    ["e5e6"],
    "sideways pawn moves must stay illegal when they expose a cannon check"
  );

  board[7][4] = 0;
  const unpinnedIds = getLegalMoves(board, PLAYER_RED)
    .filter((move) => move.fromX === 4 && move.fromY === 5)
    .map((move) => moveToString(move.fromX, move.fromY, move.toX, move.toY));
  assert.deepEqual(
    unpinnedIds,
    ["e5e6", "e5d5", "e5f5"],
    "the crossed pawn may move sideways when the cannon pin is removed"
  );

  const client = fs.readFileSync(
    new URL("../public/games/xiangqi/game.js", import.meta.url),
    "utf8"
  );
  assert.match(client, /兵的横走会让己方\$\{kingName\}被将军，不能走/);
  assert.match(client, /if \(pseudoTarget\)[\s\S]*这步会让己方\$\{kingName\}被将军，不能走/);
});

test("auto-remind counter only resets on real progress and carries turn facts", () => {
  const canvas = fs.readFileSync(
    new URL("../src/components/Browser/BrowserCanvas.tsx", import.meta.url),
    "utf8"
  );
  // The reset must live in the turn!==2 branch (real progress), never in the
  // isRunning branch - otherwise every run clears it and reminds loop forever.
  const stallBlock = canvas.slice(
    canvas.indexOf("const checkStall"),
    canvas.indexOf("void checkStall()")
  );
  assert.ok(stallBlock.length > 100, "stall detector block should exist");
  assert.match(stallBlock, /autoRemindCountRef\.current = 0/);
  const resetIdx = stallBlock.indexOf("autoRemindCountRef.current = 0");
  const runningBranchIdx = stallBlock.indexOf("if (!isRunning)");
  const turnCheckIdx = stallBlock.indexOf("state.turn === state.agentSide");
  assert.ok(turnCheckIdx >= 0, "Agent-side turn gate should exist");
  // reset must appear AFTER the turn gate (i.e. in the turn!==2 else path)
  // and the auto-remind send must be gated behind !isRunning.
  assert.ok(resetIdx > turnCheckIdx, "counter reset belongs to the progress branch");

  // Remind prompt must carry step/side facts so replayed history cannot
  // convince the agent it is not its turn.
  assert.match(canvas, /promptRemindAgentWithTurn/);
  const en = fs.readFileSync(new URL("../src/locales/en.json", import.meta.url), "utf8");
  const zh = fs.readFileSync(new URL("../src/locales/zh-CN.json", import.meta.url), "utf8");
  assert.match(en, /promptRemindAgentWithTurn/);
  assert.match(zh, /promptRemindAgentWithTurn/);
});

test("browser game prompt state is reset per active conversation", () => {
  const canvas = fs.readFileSync(
    new URL("../src/components/Browser/BrowserCanvas.tsx", import.meta.url),
    "utf8"
  );
  assert.match(canvas, /pendingGameTurnPromptRef\.current = null/);
  assert.match(canvas, /processedMessageIdsRef\.current\.clear\(\)/);
  assert.match(canvas, /state\.stepCount !== pending\.stepCount/);
  assert.match(canvas, /state\.turn !== state\.agentSide/);
});

test("rejected fallback Agent moves are resynced and retried", () => {
  const canvas = fs.readFileSync(
    new URL("../src/components/Browser/BrowserCanvas.tsx", import.meta.url),
    "utf8"
  );
  assert.match(canvas, /moveRes\?\.ok !== false/);
  assert.match(canvas, /promptAgentMoveRejected/);
  assert.match(canvas, /Failed to recover rejected Agent move/);
});

test("Xiangqi search does not discard legal moves by a fixed branch cap", () => {
  const search = fs.readFileSync(
    new URL("../electron/games/xiangqiSearch.ts", import.meta.url),
    "utf8"
  );
  const ordered = search.slice(
    search.indexOf("function orderedMoves"),
    search.indexOf("interface SearchState")
  );
  assert.doesNotMatch(ordered, /\.slice\(/);
  assert.doesNotMatch(search, /captured \* 20 - mover \+/);
});
