import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import type { WebContents } from "electron";

import { waitForActiveBridgePort } from "./agentBridge.js";
import type { AcpStdioMcpServer } from "./shared/draftToolProtocol.js";
import { sendJson, readJsonBody } from "./httpUtils.js";
import {
  dispatchDelegateAction,
  notifyDelegateYieldRequested,
  type DelegateToolBinding
} from "./cli/delegationDispatch.js";
import { runAsCaller } from "./cli/callerContext.js";

const DELEGATE_TOOL_PATH = "/freebuddy/delegate-tool";
const MAX_REQUEST_BYTES = 64 * 1024;

type DelegateToolBindingRecord = DelegateToolBinding;

const bindingsByToken = new Map<string, DelegateToolBindingRecord>();
const tokensByTaskSession = new Map<string, string>();

function createCapabilityToken(): string {
  return randomBytes(32).toString("base64url");
}

function delegateMcpServerPath(): string {
  return fileURLToPath(new URL("./mcp/delegateMcpServer.js", import.meta.url));
}

export async function registerDelegateToolSession(input: {
  taskSessionId: string;
  runId: string;
  parentEventId: string;
  depth: number;
  selfAgentId: string;
  selfLabel: string;
  ownerId?: string | null;
  webContents: WebContents | undefined;
}): Promise<AcpStdioMcpServer> {
  unregisterDelegateToolSession(input.taskSessionId);
  const port = await waitForActiveBridgePort();
  const token = createCapabilityToken();
  const binding: DelegateToolBindingRecord = {
    token,
    taskSessionId: input.taskSessionId,
    runId: input.runId,
    parentEventId: input.parentEventId,
    depth: input.depth,
    selfAgentId: input.selfAgentId,
    selfLabel: input.selfLabel,
    ...(input.ownerId ? { ownerId: input.ownerId } : {})
  };
  bindingsByToken.set(token, binding);
  tokensByTaskSession.set(input.taskSessionId, token);
  return {
    name: "freebuddy-delegate",
    command: process.execPath,
    args: [delegateMcpServerPath()],
    env: [
      { name: "ELECTRON_RUN_AS_NODE", value: "1" },
      { name: "FREEBUDDY_DELEGATE_ENDPOINT", value: `http://127.0.0.1:${port}${DELEGATE_TOOL_PATH}` },
      { name: "FREEBUDDY_DELEGATE_TOKEN", value: token },
      { name: "FREEBUDDY_DELEGATE_TIMEOUT_MS", value: String(30 * 60 * 1000) },
      { name: "FB_APP_VERSION", value: process.env.FB_APP_VERSION || "0.1.0" }
    ]
  };
}

export function unregisterDelegateToolSession(taskSessionId: string): void {
  const token = tokensByTaskSession.get(taskSessionId);
  if (token) {
    bindingsByToken.delete(token);
    tokensByTaskSession.delete(taskSessionId);
  }
}

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export async function handleDelegateToolHttpRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(req.url || "/", "http://127.0.0.1");
  } catch {
    return false;
  }
  if (url.pathname !== DELEGATE_TOOL_PATH) return false;

  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return true;
  }

  const token = bearerToken(req);
  const binding = token ? bindingsByToken.get(token) : undefined;
  if (!binding) {
    sendJson(res, 401, { ok: false, error: "invalid_capability_token" });
    return true;
  }

  try {
    const body = (await readJsonBody(req, MAX_REQUEST_BYTES)) as {
      action?: string;
      params?: Record<string, unknown>;
    } | null;
    const action = typeof body?.action === "string" ? body.action : "";
    const params =
      body?.params && typeof body.params === "object" && !Array.isArray(body.params)
        ? body.params
        : {};
    const result = binding.ownerId
      ? await runAsCaller(binding.ownerId, () =>
          dispatchDelegateAction(binding, action, params)
        )
      : await dispatchDelegateAction(binding, action, params);
    sendJson(res, 200, result);
    if (action === "yield_to_delegates" && result.ok && result.status === "running") {
      // Let the MCP response leave the socket before cancelling the ACP prompt;
      // otherwise the model may retry because it never observed acceptance.
      setImmediate(() => notifyDelegateYieldRequested(binding));
    }
  } catch (error) {
    sendJson(res, 500, { ok: false, error: (error as Error)?.message || String(error) });
  }
  return true;
}
