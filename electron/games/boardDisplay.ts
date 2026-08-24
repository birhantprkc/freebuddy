import { BOARD_SIZE } from "./gomokuEngine.js";
import {
  getOpponentCaptureThreats,
  getPieceName,
  isKingInCheck
} from "./xiangqiEngine.js";
import type { GameStateSnapshot, LegalGameMove } from "../shared/gameToolProtocol.js";

const GOMOKU_COL_LETTERS = "ABCDEFGHIJKLMNO";

const XIANGQI_LETTERS: Record<number, string> = {
  1: "K",
  2: "A",
  3: "B",
  4: "N",
  5: "R",
  6: "C",
  7: "P"
};

export function renderGomokuBoardAscii(board: number[][]): string {
  const header = `   ${GOMOKU_COL_LETTERS.split("").join(" ")}`;
  const rows: string[] = [header];
  for (let y = 0; y < BOARD_SIZE; y++) {
    const label = String(BOARD_SIZE - y).padStart(2, " ");
    const cells = board[y]
      .map((v) => (v === 1 ? "X" : v === 2 ? "O" : "."))
      .join(" ");
    rows.push(`${label} ${cells}`);
  }
  return rows.join("\n");
}

export function renderXiangqiBoardAscii(board: number[][]): string {
  const header = "   a b c d e f g h i";
  const rows: string[] = [header];
  for (let y = 9; y >= 0; y--) {
    const label = String(y).padStart(2, " ");
    const cells = board[y]
      .map((piece) => {
        if (piece === 0) return ".";
        const letter = XIANGQI_LETTERS[Math.abs(piece)] ?? "?";
        return piece > 0 ? letter : letter.toLowerCase();
      })
      .join(" ");
    rows.push(`${label} ${cells}`);
  }
  return rows.join("\n");
}

function senderLabel(snapshot: GameStateSnapshot, side: number): string {
  return side === snapshot.playerSide ? "玩家" : "AI";
}

export function formatGameStateText(snapshot: GameStateSnapshot): string {
  const isXiangqi = snapshot.gameType === "xiangqi";
  const lines: string[] = [];

  lines.push(isXiangqi ? "【中国象棋】" : "【五子棋】");

  const turnPiece = isXiangqi
    ? snapshot.turn === 1
      ? "红"
      : "黑"
    : snapshot.turn === 1
      ? "黑"
      : "白";
  const statusText: Record<string, string> = {
    waiting: "等待开始",
    playing: "进行中",
    player_won: "玩家获胜",
    agent_won: "AI 获胜",
    draw: "平局",
    resigned: "已认输"
  };
  const status = statusText[snapshot.status] ?? snapshot.status;
  lines.push(
    snapshot.status === "playing"
      ? `第 ${snapshot.stepCount} 手 | 轮到 ${senderLabel(snapshot, snapshot.turn)} 执${turnPiece} | 状态：${status}`
      : `第 ${snapshot.stepCount} 手 | 状态：${status}`
  );

  if (isXiangqi) {
    lines.push(
      `图例：大写=红方(${snapshot.playerSide === 1 ? "玩家" : "AI"})，小写=黑方(${snapshot.playerSide === 2 ? "玩家" : "AI"})；K帅/将 A仕/士 B相/象 N马 R俥/车 C炮 P兵/卒 .=空位；行号9在上(黑方底线) 0在下(红方底线)`
    );
    lines.push(renderXiangqiBoardAscii(snapshot.board));
  } else {
    lines.push(
      `图例：X=黑棋(${snapshot.playerSide === 1 ? "玩家" : "AI"}) O=白棋(${snapshot.playerSide === 2 ? "玩家" : "AI"}) .=空位；行号15在上，列A在左`
    );
    lines.push(renderGomokuBoardAscii(snapshot.board));
  }

  const lastMove = snapshot.lastMove;
  if (lastMove) {
    let desc = `${senderLabel(snapshot, lastMove.player)} 落子 ${
      lastMove.chineseMove
        ? `${lastMove.chineseMove}（${lastMove.actionId}）`
        : lastMove.actionId
    }`;
    if (typeof lastMove.piece === "number" && lastMove.piece !== 0) {
      desc += `（${getPieceName(lastMove.piece)}）`;
    }
    if (lastMove.capturedPieceName) desc += `，吃${lastMove.capturedPieceName}`;
    if (lastMove.checkmate) desc += "，绝杀";
    else if (lastMove.givesCheck) desc += "，将军";
    lines.push(`上一步：${desc}`);
  }

  if (snapshot.status === "playing") {
    const winning = snapshot.legalMoves.filter((m) => m.threatLevel === "winning");
    const blocking = snapshot.legalMoves.filter((m) => m.threatLevel === "critical_block");
    if (winning.length > 0) {
      lines.push(
        `⚠ 存在直接取胜点：${winning.map((m) => m.actionId).join("、")} —— 强烈建议立即执行！`
      );
    } else if (blocking.length > 0) {
      lines.push(
        `⚠ 对方下一手即可连五取胜，必须封堵威胁点：${blocking.map((m) => m.actionId).join("、")}`
      );
    }
    if (isXiangqi && isKingInCheck(snapshot.board, snapshot.turn)) {
      lines.push("⚠ 你正被将军，必须应将！");
    }

    if (isXiangqi) {
      const threats = getOpponentCaptureThreats(snapshot.board, snapshot.turn)
        .filter((t) => t.value >= 200 || !t.defended)
        .slice(0, 4);
      for (const t of threats) {
        lines.push(
          `⚠ 对方威胁：你的 ${t.targetCoord}${t.targetName} 正被 ${t.attackerCoord}${t.attackerName} 盯住（${
            t.defended ? "有保护，兑子需算清" : "无保护，会被白吃"
          }）`
        );
      }
    }

    if (snapshot.legalMoves.length > 0) {
      lines.push(
        "候选走法（按战术价值排序；[丢X]=白丢该子；[招致绝杀!]=走完对方一步杀，绝不可选）："
      );
      const top = snapshot.legalMoves.slice(0, 8);
      top.forEach((move, index) => {
        const parts: string[] = [];
        if (move.allowsMate) parts.push("🚨[招致绝杀!]");
        else if (move.safety === "lose" && move.lossPiece) parts.push(`⚠[丢${move.lossPiece}!]`);
        else if (move.threatLevel === "winning") parts.push("[绝杀胜手]");
        else if (move.threatLevel === "critical_block") parts.push("[关键封堵]");
        else if (move.safety === "gain") parts.push("[得子]");
        else if (move.threatLevel === "attack") parts.push("[进攻]");
        const tag = isXiangqi ? "" : parts.join("");
        lines.push(
          ` ${index + 1}. ${tag ? `${tag} ` : ""}${move.actionId}${
            move.description ? ` ${move.description}` : ""
          }`
        );
      });
      lines.push("请从候选走法中选择 actionId 调用 game_make_move。优先选择无 [丢X] 标记的着法。");
    }
  }

  return lines.join("\n");
}
