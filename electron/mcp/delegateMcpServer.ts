import path from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

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
      description:
        "List the teammates available to delegate to in the current delegation run (excluding yourself). Each entry has id, label, capability (what to delegate to it), and canWrite. Read-only.",
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
      description:
        "Asynchronously delegate a sub-task to a teammate. Returns IMMEDIATELY with {request_id, status:'pending'}. The teammate runs in the background. Poll check_delegate_result(request_id) every 3-5 seconds until status is 'done'/'failed'/'timeout', then use the returned result. Pick the teammate by matching its capability to the sub-task. Do not delegate trivial work you can do yourself, and do not bounce back to your caller.",
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
    "check_delegate_result",
    {
      title: "Check Delegate Result",
      description:
        "Poll a delegate call's result. Returns {status, result, request_id}. 'pending' = still running. Poll every 3-5 seconds until terminal (done/failed/timeout).",
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
