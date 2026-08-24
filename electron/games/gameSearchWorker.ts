import { parentPort } from "node:worker_threads";

import type { GameMoveRecord, GameType } from "../shared/gameToolProtocol.js";
import { findBestMove } from "./gomokuSearch.js";
import { findBestXiangqiMove } from "./xiangqiSearch.js";

interface SearchRequest {
  gameType: GameType;
  board: number[][];
  player: number;
  maxDepth: number;
  timeBudgetMs: number;
  positionHistory?: string[];
  recentMoves?: GameMoveRecord[];
}

parentPort?.on("message", (request: SearchRequest) => {
  try {
    const suggestion =
      request.gameType === "xiangqi"
        ? findBestXiangqiMove(request.board, request.player, {
            maxDepth: request.maxDepth,
            timeBudgetMs: request.timeBudgetMs,
            positionHistory: request.positionHistory,
            recentMoves: request.recentMoves
          })
        : findBestMove(request.board, request.player, {
            maxDepth: request.maxDepth,
            timeBudgetMs: request.timeBudgetMs
          });
    parentPort?.postMessage({ ok: true, suggestion });
  } catch (error) {
    parentPort?.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
