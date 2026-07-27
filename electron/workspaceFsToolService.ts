import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { waitForActiveBridgePort } from "./agentBridge.js";
import type { AcpStdioMcpServer } from "./shared/draftToolProtocol.js";
import { resolveWithinRoots } from "./shared/workspacePathGuard.js";

const WORKSPACE_FS_TOOL_PATH = "/freebuddy/workspace-fs-tool";
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

export type WorkspaceFsAction = "list" | "read" | "write";

export interface WorkspaceFsBinding {
  roots: string[];
  primary: string;
}

interface WorkspaceFsSessionBinding extends WorkspaceFsBinding {
  taskSessionId: string;
}

const bindingsByToken = new Map<string, WorkspaceFsSessionBinding>();
const tokensByTaskSession = new Map<string, string>();

function workspaceFsMcpServerPath(): string {
  return fileURLToPath(new URL("./mcp/workspaceFsMcpServer.js", import.meta.url));
}

function isWorkspaceFsAction(value: unknown): value is WorkspaceFsAction {
  return value === "list" || value === "read" || value === "write";
}

function stringParam(params: Record<string, unknown>, name: string): string {
  const value = params[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${name}.`);
  }
  return value.trim();
}

export async function dispatchWorkspaceFs(
  binding: WorkspaceFsBinding,
  action: WorkspaceFsAction,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const inputPath =
    typeof params.path === "string" && params.path.trim()
      ? params.path.trim()
      : action === "list"
        ? "."
        : "";
  const resolved = resolveWithinRoots(inputPath, binding.roots, binding.primary);
  if (!resolved.ok) {
    return { ok: false, error: resolved.error };
  }

  if (action === "list") {
    const dirents = await fs.readdir(resolved.absolute, { withFileTypes: true });
    const entries = dirents
      .map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? ("directory" as const) : ("file" as const),
        path: path.join(resolved.absolute, entry.name)
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, path: resolved.absolute, entries };
  }

  if (action === "read") {
    const content = await fs.readFile(resolved.absolute, "utf8");
    return { ok: true, path: resolved.absolute, content };
  }

  const content = typeof params.content === "string" ? params.content : stringParam(params, "content");
  await fs.writeFile(resolved.absolute, content, "utf8");
  return { ok: true, path: resolved.absolute };
}

export async function registerWorkspaceFsToolSession(input: {
  taskSessionId: string;
  roots: string[];
  primary: string;
}): Promise<AcpStdioMcpServer> {
  unregisterWorkspaceFsToolSession(input.taskSessionId);

  const port = await waitForActiveBridgePort();
  const token = randomBytes(32).toString("base64url");
  bindingsByToken.set(token, {
    taskSessionId: input.taskSessionId,
    roots: input.roots,
    primary: input.primary
  });
  tokensByTaskSession.set(input.taskSessionId, token);

  return {
    name: "freebuddy-workspace-fs",
    command: process.execPath,
    args: [workspaceFsMcpServerPath()],
    env: [
      { name: "ELECTRON_RUN_AS_NODE", value: "1" },
      {
        name: "FREEBUDDY_WORKSPACE_FS_ENDPOINT",
        value: `http://127.0.0.1:${port}${WORKSPACE_FS_TOOL_PATH}`
      },
      { name: "FREEBUDDY_WORKSPACE_FS_TOKEN", value: token },
      {
        name: "FB_APP_VERSION",
        value: process.env.FB_APP_VERSION || "0.1.0"
      }
    ]
  };
}

export function unregisterWorkspaceFsToolSession(taskSessionId: string): void {
  const token = tokensByTaskSession.get(taskSessionId);
  if (token) bindingsByToken.delete(token);
  tokensByTaskSession.delete(taskSessionId);
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>
): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) {
      throw new Error("Workspace FS tool request is too large.");
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

export async function handleWorkspaceFsToolHttpRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(req.url || "/", "http://127.0.0.1");
  } catch {
    return false;
  }
  if (url.pathname !== WORKSPACE_FS_TOOL_PATH) return false;

  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return true;
  }

  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const binding = token ? bindingsByToken.get(token) : undefined;
  if (!binding) {
    sendJson(res, 401, { ok: false, error: "invalid_capability_token" });
    return true;
  }

  try {
    const body = await readJsonBody(req);
    if (!isWorkspaceFsAction(body.action)) {
      sendJson(res, 400, { ok: false, error: "invalid_action" });
      return true;
    }
    const params =
      body.params && typeof body.params === "object" && !Array.isArray(body.params)
        ? (body.params as Record<string, unknown>)
        : {};
    sendJson(res, 200, await dispatchWorkspaceFs(binding, body.action, params));
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: (error as Error)?.message || String(error)
    });
  }
  return true;
}
