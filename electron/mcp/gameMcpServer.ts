import path from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import type { GameAction, GameToolResult } from "../shared/gameToolProtocol.js";

function bridgeEnvironment(): { endpoint: string; token: string } {
  const endpoint = process.env.FREEBUDDY_GAME_ENDPOINT?.trim();
  const token = process.env.FREEBUDDY_GAME_TOKEN?.trim();
  if (!endpoint || !token) {
    throw new Error("FreeBuddy Game tool environment is incomplete. Missing FREEBUDDY_GAME_ENDPOINT or TOKEN.");
  }
  return { endpoint, token };
}

export async function invokeGameBridge(
  action: GameAction,
  params: Record<string, unknown>
): Promise<GameToolResult> {
  const { endpoint, token } = bridgeEnvironment();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ action, params }),
    signal: AbortSignal.timeout(20_000)
  });

  const result = (await response.json().catch(() => ({
    ok: false,
    error: `Game bridge returned HTTP ${response.status}`
  }))) as GameToolResult;

  if (!response.ok) {
    throw new Error(result.error || `Game bridge returned HTTP ${response.status}`);
  }
  return result;
}

function toolResult(result: GameToolResult) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result, null, 2)
      }
    ],
    structuredContent: result,
    ...(result.ok === false ? { isError: true } : {})
  };
}

function toolError(error: unknown) {
  return toolResult({
    ok: false,
    error: (error as Error)?.message || String(error)
  });
}

export function createGameMcpServer(): McpServer {
  const server = new McpServer({
    name: "freebuddy-game",
    version: process.env.FB_APP_VERSION || "0.8.7"
  });

  // Tool 1: Get live board state & legal moves
  server.registerTool(
    "game_get_state",
    {
      title: "Get Board State",
      description:
        "获取当前棋盘/牌局最新局势。返回当前执子方、手牌/棋盘矩阵、上一步着法，以及按战术威胁排序的合法候选走法列表 (legalMoves)。",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true
      }
    },
    async () => {
      try {
        return toolResult(await invokeGameBridge("get_state", {}));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  // Tool 2: Submit a move
  server.registerTool(
    "game_make_move",
    {
      title: "Make Game Move",
      description:
        "在当前对局中执行落子或出牌。必须传入合法的 actionId (如 'H8'、'E5' 等)。若落子非法将返回错误信息供你调整。",
      inputSchema: {
        actionId: z
          .string()
          .trim()
          .min(1)
          .describe("合法候选走法列表中的唯一 ID/坐标，如 'H8', 'D4'"),
        reason: z
          .string()
          .trim()
          .optional()
          .describe("简要阐明本步落子的战术意图（进攻/防守/封堵）")
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false
      }
    },
    async ({ actionId, reason }) => {
      try {
        return toolResult(await invokeGameBridge("make_move", { actionId, reason }));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  // Tool 3: In-game trash talk & roleplay chat
  server.registerTool(
    "game_send_chat",
    {
      title: "Send In-Game Chat",
      description:
        "在棋盘上方和聊天流中向对手发送一句心理战垃圾话、性格台词或局势评价，增加对局趣味性。",
      inputSchema: {
        message: z
          .string()
          .trim()
          .min(1)
          .max(300)
          .describe("要对玩家说的台词内容（短小精炼，符合你的人设）"),
        mood: z
          .enum(["confident", "mocking", "nervous", "calm", "admiring"])
          .optional()
          .describe("台词对应的情绪基调")
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false
      }
    },
    async ({ message, mood }) => {
      try {
        return toolResult(await invokeGameBridge("send_chat", { message, mood }));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  // Tool 4: Resign
  server.registerTool(
    "game_resign",
    {
      title: "Resign Match",
      description: "当确定大势已去无法挽回时，主动认输投降，体面结束本局对弈。",
      inputSchema: {
        reason: z.string().trim().optional().describe("认输感言或局势说明")
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true
      }
    },
    async ({ reason }) => {
      try {
        return toolResult(await invokeGameBridge("resign", { reason }));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  return server;
}

export async function runGameMcpServer(): Promise<void> {
  const server = createGameMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isDirectEntry =
  process.argv[1] &&
  fileURLToPath(import.meta.url).toLowerCase() ===
    path.resolve(process.argv[1]).toLowerCase();

if (isDirectEntry) {
  runGameMcpServer().catch((error) => {
    console.error("[FreeBuddy] Game MCP server failed:", error);
    process.exit(1);
  });
}
