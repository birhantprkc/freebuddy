import path from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  mcpCheckResultDescription,
  mcpDelegateDescription,
  mcpDelegateManyDescription,
  mcpListTeammatesDescription,
  mcpSubmitVerdictDescription,
  mcpYieldToDelegatesDescription
} from "../cli/delegation/protocol/text.js";

interface DelegateToolResponse {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
}

function bridgeEnvironment(): { endpoint: string; token: string } {
  const endpoint = process.env.FREEBUDDY_DELEGATE_ENDPOINT?.trim();
  const token = process.env.FREEBUDDY_DELEGATE_TOKEN?.trim();
  if (!endpoint || !token) {
    throw new Error("FreeBuddy Delegate tool environment is incomplete.");
  }
  return { endpoint, token };
}

function clientTimeoutMs(): number {
  const raw = Number(process.env.FREEBUDDY_DELEGATE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 30 * 60 * 1000;
}

async function invokeDelegateBridge(
  action: string,
  params: Record<string, unknown> = {}
): Promise<DelegateToolResponse> {
  const { endpoint, token } = bridgeEnvironment();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ action, params }),
    signal: AbortSignal.timeout(clientTimeoutMs())
  });
  const result = (await response.json().catch(() => ({
    ok: false,
    error: `Delegate bridge returned HTTP ${response.status}`
  }))) as DelegateToolResponse;
  if (!response.ok) {
    throw new Error(result.error || `Delegate bridge returned HTTP ${response.status}`);
  }
  return result;
}

function toolResult(result: DelegateToolResponse) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    ...(result.ok === false ? { isError: true } : {})
  };
}

function toolError(error: unknown) {
  return toolResult({ ok: false, error: (error as Error)?.message || String(error) });
}

export function createDelegateMcpServer(): McpServer {
  const server = new McpServer({
    name: "freebuddy-delegate",
    version: process.env.FB_APP_VERSION || "0.1.0"
  });

  server.registerTool(
    "list_teammates",
    {
      title: "List Delegation Teammates",
      description: mcpListTeammatesDescription(),
      inputSchema: {}
    },
    async () => {
      try {
        return toolResult(await invokeDelegateBridge("list_teammates", {}));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "delegate",
    {
      title: "Delegate a Sub-task to a Teammate",
      description: mcpDelegateDescription(),
      inputSchema: {
        teammate_id: z.string().describe("The roster entry id from list_teammates."),
        task: z.string().describe("A self-contained description of the sub-task to delegate.")
      }
    },
    async (args) => {
      try {
        return toolResult(await invokeDelegateBridge("delegate", args));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "delegate_many",
    {
      title: "Atomically Delegate Multiple Sub-tasks",
      description: mcpDelegateManyDescription(),
      inputSchema: {
        delegations: z.array(z.object({
          teammate_id: z.string().describe("The roster entry id from list_teammates."),
          task: z.string().describe("A self-contained description of the sub-task.")
        })).min(1).max(8)
      }
    },
    async (args) => {
      try {
        return toolResult(await invokeDelegateBridge("delegate_many", args));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "yield_to_delegates",
    {
      title: "Yield to Accepted Delegates",
      description: mcpYieldToDelegatesDescription(),
      inputSchema: {
        request_ids: z.array(z.string()).min(1).describe(
          "Accepted request handles returned by delegate or delegate_many."
        )
      }
    },
    async (args) => {
      try {
        return toolResult(await invokeDelegateBridge("yield_to_delegates", args));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "check_delegate_result",
    {
      title: "Check Delegate Result",
      description: mcpCheckResultDescription(),
      inputSchema: {
        request_id: z.string().describe("The request_id from delegate.")
      }
    },

    async (args) => {
      try {
        return toolResult(await invokeDelegateBridge("check_delegate_result", args));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "submit_verdict",
    {
      title: "Submit Delegation Verdict",
      description: mcpSubmitVerdictDescription(),
      inputSchema: {
        verdict: z.enum(["pass", "needs_changes", "fail"]),
        summary: z.string().optional().describe("Optional short summary.")
      }
    },
    async (args) => {
      try {
        return toolResult(await invokeDelegateBridge("submit_verdict", args));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  return server;
}

export async function runDelegateMcpServer(): Promise<void> {
  const server = createDelegateMcpServer();
  await server.connect(new StdioServerTransport());
}

const isMainModule =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  runDelegateMcpServer().catch((error) => {
    console.error("[FreeBuddy Delegate MCP]", error);
    process.exitCode = 1;
  });
}
