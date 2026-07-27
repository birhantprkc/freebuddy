import path from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

type WorkspaceFsAction = "list" | "read" | "write" | "roots";

interface WorkspaceFsToolResponse {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
}

function bridgeEnvironment(): { endpoint: string; token: string } {
  const endpoint = process.env.FREEBUDDY_WORKSPACE_FS_ENDPOINT?.trim();
  const token = process.env.FREEBUDDY_WORKSPACE_FS_TOKEN?.trim();
  if (!endpoint || !token) {
    throw new Error("FreeBuddy Workspace FS tool environment is incomplete.");
  }
  return { endpoint, token };
}

export async function invokeWorkspaceFsBridge(
  action: WorkspaceFsAction,
  params: Record<string, unknown>
): Promise<WorkspaceFsToolResponse> {
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
    error: `Workspace FS bridge returned HTTP ${response.status}`
  }))) as WorkspaceFsToolResponse;
  if (!response.ok) {
    throw new Error(
      result.error || `Workspace FS bridge returned HTTP ${response.status}`
    );
  }
  return result;
}

function toolResult(result: WorkspaceFsToolResponse) {
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

export function createWorkspaceFsMcpServer(): McpServer {
  const server = new McpServer({
    name: "freebuddy-workspace-fs",
    version: process.env.FB_APP_VERSION || "0.1.0"
  });

  server.registerTool(
    "workspace_roots",
    {
      title: "List Workspace Roots",
      description:
        "Return every mounted workspace root and which one is primary. Call this before assuming the project has only one folder — multi-folder projects mount several absolute roots.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => {
      try {
        return toolResult(await invokeWorkspaceFsBridge("roots", {}));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "workspace_list",
    {
      title: "List Workspace Directory",
      description:
        "List files and directories inside the multi-folder project workspace. Relative paths resolve against the primary root only — listing \".\" does NOT mean there is only one root. Responses include roots[] and primary; use absolute paths under any root, or call workspace_roots first.",
      inputSchema: {
        path: z
          .string()
          .trim()
          .optional()
          .default(".")
          .describe(
            "Directory to list. Relative to the primary workspace root, or absolute within any configured root."
          )
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (args) => {
      try {
        return toolResult(await invokeWorkspaceFsBridge("list", args));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "workspace_read",
    {
      title: "Read Workspace File",
      description:
        "Read a UTF-8 text file from the multi-folder project workspace. Relative paths resolve against the primary root; absolute paths must stay within configured workspace roots (see workspace_roots / roots[] in responses).",
      inputSchema: {
        path: z
          .string()
          .trim()
          .min(1)
          .describe(
            "File to read. Relative to the primary workspace root, or absolute within any configured root."
          )
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (args) => {
      try {
        return toolResult(await invokeWorkspaceFsBridge("read", args));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "workspace_write",
    {
      title: "Write Workspace File",
      description:
        "Write a UTF-8 text file inside the multi-folder project workspace. Relative paths resolve against the primary root; absolute paths must stay within configured workspace roots (see workspace_roots / roots[] in responses).",
      inputSchema: {
        path: z
          .string()
          .trim()
          .min(1)
          .describe(
            "File to write. Relative to the primary workspace root, or absolute within any configured root."
          ),
        content: z.string().describe("UTF-8 file contents to write.")
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (args) => {
      try {
        return toolResult(await invokeWorkspaceFsBridge("write", args));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  return server;
}

export async function runWorkspaceFsMcpServer(): Promise<void> {
  const server = createWorkspaceFsMcpServer();
  await server.connect(new StdioServerTransport());
}

const isMainModule =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  runWorkspaceFsMcpServer().catch((error) => {
    console.error("[FreeBuddy Workspace FS MCP]", error);
    process.exitCode = 1;
  });
}
