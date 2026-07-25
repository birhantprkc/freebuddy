import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

import { sendJson, readJsonBody } from "./httpUtils.js";
import {
  resolveWorkspaceRoots,
  isPathWithinRoots,
  parentWithinRoots
} from "./shared/workspaceRoots.js";
import {
  consumeQrToken,
  buildSessionCookieHeader,
  readSessionCookie,
  createSession,
  checkSession,
  extractBearerToken,
  sessionUserId
} from "./remoteAuth.js";
import { verifyUserLogin, getOwnerUser, listUsers, getUserRoots } from "./cli/users.js";
import { runAsCaller } from "./cli/callerContext.js";
import { getSessionOwner } from "./cli/sessionOwners.js";
import { classifyWsChannel } from "./shared/wsChannelPolicy.js";
import { localInvoke } from "./invokeRegistry.js";
import { setEventBroadcaster } from "./eventBus.js";
import {
  isManagedAttachmentPath,
  prepareAttachmentFiles,
  type PrepareAttachmentPayload
} from "./cli/attachments.js";

const WEBUI_DEFAULT_PORT = 18080;

let webuiServer: http.Server | null = null;
let wss: WebSocketServer | null = null;
const authedClients = new Set<WebSocket>();
const clientUsers = new Map<WebSocket, string>();
let currentPort = WEBUI_DEFAULT_PORT;
let currentHost = "127.0.0.1";
let currentAllowRemote = false;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm"
};

let indexHtmlCache: string | null = null;
let indexHtmlDistDir = "";

function getIndexHtml(distDir: string): string | null {
  if (indexHtmlCache !== null && indexHtmlDistDir === distDir) return indexHtmlCache;
  try {
    const raw = fs.readFileSync(path.join(distDir, "index.html"), "utf8");
    indexHtmlDistDir = distDir;
    indexHtmlCache = raw.includes("/web-preload.js")
      ? raw
      : raw.replace("</head>", '<script src="/web-preload.js"></script></head>');
    return indexHtmlCache;
  } catch {
    return null;
  }
}

function serveFile(res: ServerResponse, filePath: string): void {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}

function serveSpaIndex(res: ServerResponse, distDir: string): void {
  const html = getIndexHtml(distDir);
  if (html === null) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function serveStatic(
  res: ServerResponse,
  distDir: string,
  pathname: string
): boolean {
  if (!fs.existsSync(distDir)) return false;

  if (pathname === "/" || pathname === "/index.html") {
    serveSpaIndex(res, distDir);
    return true;
  }

  const decoded = decodeURIComponent(pathname);
  const filePath = path.resolve(path.join(distDir, decoded));
  const normalizedDist = path.resolve(distDir);
  if (filePath !== normalizedDist && !filePath.startsWith(normalizedDist + path.sep)) {
    sendJson(res, 403, { ok: false, error: "forbidden" });
    return true;
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.isFile()) {
      serveFile(res, filePath);
      return true;
    }
    if (stat.isDirectory()) {
      const indexPath = path.join(filePath, "index.html");
      if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
        serveSpaIndex(res, distDir);
        return true;
      }
    }
  } catch {
    // fall through to SPA fallback
  }

  serveSpaIndex(res, distDir);
  return true;
}

function isAuthed(req: IncomingMessage): boolean {
  return (
    checkSession(extractBearerToken(req.headers.authorization)) ||
    checkSession(readSessionCookie(req.headers.cookie))
  );
}

async function handleLogin(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (url.pathname !== "/api/login" || req.method !== "POST") return false;
  const body = (await readJsonBody(req)) as { username?: string; password?: string } | null;
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (listUsers().length === 0) {
    sendJson(res, 200, { ok: false, error: "remote_not_initialized" });
    return true;
  }
  const user = verifyUserLogin(username, password);
  if (user) {
    const token = createSession(user.id);
    res.setHeader("Set-Cookie", buildSessionCookieHeader(token));
    sendJson(res, 200, { ok: true, token });
  } else {
    sendJson(res, 200, { ok: false, error: "invalid_credentials" });
  }
  return true;
}

async function handleQrLogin(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (url.pathname !== "/api/qr-login" || req.method !== "POST") return false;
  const body = (await readJsonBody(req)) as { token?: string } | null;
  if (!consumeQrToken(typeof body?.token === "string" ? body.token : null)) {
    sendJson(res, 200, { ok: false, error: "invalid_or_expired_qr_token" });
    return true;
  }
  const owner = getOwnerUser();
  if (!owner) {
    sendJson(res, 200, { ok: false, error: "remote_not_initialized" });
    return true;
  }
  const token = createSession(owner.id);
  res.setHeader("Set-Cookie", buildSessionCookieHeader(token));
  sendJson(res, 200, { ok: true, token });
  return true;
}

function handleStatus(res: ServerResponse): void {
  sendJson(res, 200, {
    ok: true,
    webui: true,
    hasPassword: listUsers().length > 0
  });
}

async function handleInvoke(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (url.pathname !== "/api/invoke" || req.method !== "POST") return false;
  if (!isAuthed(req)) {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return true;
  }
  const body = (await readJsonBody(req)) as
    | { channel?: unknown; args?: unknown }
    | null;
  const channel = body?.channel;
  if (typeof channel !== "string" || !channel) {
    sendJson(res, 200, { ok: false, error: "invalid_request" });
    return true;
  }
  const args = Array.isArray(body?.args) ? body.args : [];
  const userId =
    sessionUserId(extractBearerToken(req.headers.authorization)) ||
    sessionUserId(readSessionCookie(req.headers.cookie));
  try {
    const result = userId
      ? await runAsCaller(userId, () => localInvoke(channel, ...args))
      : await localInvoke(channel, ...args);
    sendJson(res, 200, { ok: true, result });
  } catch (error) {
    sendJson(res, 200, {
      ok: false,
      error: (error as Error)?.message || String(error)
    });
  }
  return true;
}

function handleAttachment(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (url.pathname !== "/api/attachment" || req.method !== "GET") return false;
  if (!isAuthed(req)) {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return true;
  }
  const filePath = url.searchParams.get("path");
  if (!filePath) {
    sendJson(res, 400, { ok: false, error: "missing_path" });
    return true;
  }
  if (!isManagedAttachmentPath(filePath)) {
    sendJson(res, 403, { ok: false, error: "forbidden" });
    return true;
  }
  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600"
    });
    res.end(data);
  } catch {
    sendJson(res, 404, { ok: false, error: "not_found" });
  }
  return true;
}

async function handleUpload(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (url.pathname !== "/api/upload" || req.method !== "POST") return false;
  if (!isAuthed(req)) {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return true;
  }
  const body = (await readJsonBody(req, 80 * 1024 * 1024)) as
    | { files?: unknown }
    | null;
  const files = Array.isArray(body?.files) ? body.files : [];
  const payloads: PrepareAttachmentPayload[] = [];
  for (const entry of files) {
    if (!entry || typeof entry !== "object") continue;
    const f = entry as { name?: unknown; mimeType?: unknown; data?: unknown };
    if (typeof f.data !== "string") continue;
    try {
      const buffer = Buffer.from(f.data, "base64");
      payloads.push({
        kind: "buffer",
        name: typeof f.name === "string" ? f.name : "file",
        mimeType:
          typeof f.mimeType === "string" ? f.mimeType : "application/octet-stream",
        size: buffer.length,
        data: buffer
      });
    } catch {
      // skip invalid entry
    }
  }
  try {
    const result = prepareAttachmentFiles(payloads);
    sendJson(res, 200, { ok: true, result });
  } catch (error) {
    sendJson(res, 200, {
      ok: false,
      error: (error as Error)?.message || String(error)
    });
  }
  return true;
}

function handleListDirs(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (url.pathname !== "/api/listDirs" || req.method !== "GET") return false;
  if (!isAuthed(req)) {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return true;
  }
  const callerUserId =
    sessionUserId(extractBearerToken(req.headers.authorization)) ||
    sessionUserId(readSessionCookie(req.headers.cookie));
  const roots = resolveWorkspaceRoots(callerUserId ? getUserRoots(callerUserId) : []);
  const requested = url.searchParams.get("path");
  const target = path.resolve(requested || roots[0] || os.homedir());
  if (!isPathWithinRoots(target, roots)) {
    sendJson(res, 403, { ok: false, error: "forbidden" });
    return true;
  }
  try {
    if (!fs.statSync(target).isDirectory()) {
      sendJson(res, 400, { ok: false, error: "not_a_directory" });
      return true;
    }
    const entries: { name: string }[] = [];
    for (const dirent of fs.readdirSync(target, { withFileTypes: true })) {
      if (!dirent.isDirectory() || dirent.name.startsWith(".")) continue;
      entries.push({ name: dirent.name });
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    sendJson(res, 200, {
      ok: true,
      result: {
        path: target,
        parent: parentWithinRoots(target, roots),
        roots,
        entries
      }
    });
  } catch {
    sendJson(res, 400, { ok: false, error: "read_failed" });
  }
  return true;
}

function proxyToDevServer(
  req: IncomingMessage,
  res: ServerResponse,
  devServerUrl: string
): void {
  let target: URL;
  try {
    target = new URL(devServerUrl);
  } catch {
    sendJson(res, 502, { ok: false, error: "invalid_dev_server_url" });
    return;
  }
  const proxyReq = http.request(
    {
      hostname: target.hostname,
      port: target.port,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: target.host,
        "accept-encoding": "identity"
      }
    },
    (proxyRes) => {
      const contentType = String(proxyRes.headers["content-type"] || "");
      if (contentType.includes("text/html")) {
        let body = "";
        proxyRes.setEncoding("utf8");
        proxyRes.on("data", (chunk: string) => {
          body += chunk;
        });
        proxyRes.on("end", () => {
          const injected = body.includes("/web-preload.js")
            ? body
            : body.replace(
                "</head>",
                '<script src="/web-preload.js"></script></head>'
              );
          const headers = { ...proxyRes.headers };
          delete headers["content-length"];
          delete headers["content-encoding"];
          res.writeHead(proxyRes.statusCode || 200, headers);
          res.end(injected);
        });
      } else {
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(res);
      }
    }
  );
  proxyReq.on("error", () => {
    if (!res.headersSent) {
      sendJson(res, 502, { ok: false, error: "dev_server_unreachable" });
    }
  });
  req.pipe(proxyReq);
}

function proxyUpgradeToDevServer(
  req: IncomingMessage,
  socket: import("node:stream").Duplex,
  head: Buffer,
  devServerUrl: string
): void {
  let target: URL;
  try {
    target = new URL(devServerUrl);
  } catch {
    socket.destroy();
    return;
  }
  const proxyReq = http.request({
    hostname: target.hostname,
    port: target.port,
    path: req.url,
    headers: { ...req.headers, host: target.host }
  });
  proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
        Object.entries(proxyRes.headers)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\r\n") +
        "\r\n\r\n"
    );
    if (proxyHead.length) socket.write(proxyHead);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
    proxySocket.on("error", () => {
      try { socket.destroy(); } catch { /* ignore */ }
    });
    socket.on("error", () => {
      try { proxySocket.destroy(); } catch { /* ignore */ }
    });
  });
  proxyReq.on("error", () => socket.destroy());
  proxyReq.end();
}

function setupWebSocket(server: http.Server, devServerUrl = ""): void {
  wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname === "/ws") {
      wss?.handleUpgrade(req, socket, head, (ws) => {
        wss?.emit("connection", ws, req);
      });
      return;
    }
    if (devServerUrl) {
      proxyUpgradeToDevServer(req, socket, head, devServerUrl);
      return;
    }
    socket.destroy();
  });

  wss.on("connection", (ws: WebSocket) => {
    let authed = false;
    ws.on("message", (data: Buffer) => {
      if (authed) return;
      try {
        const msg = JSON.parse(data.toString()) as {
          type?: unknown;
          token?: unknown;
        };
        const token =
          msg.type === "auth"
            ? extractBearerToken(`Bearer ${msg.token}`)
            : null;
        const userId = token ? sessionUserId(token) : null;
        if (userId) {
          authed = true;
          authedClients.add(ws);
          clientUsers.set(ws, userId);
          ws.send(JSON.stringify({ type: "authed" }));
        } else {
          ws.close(1008);
        }
      } catch {
        ws.close(1008);
      }
    });
    ws.on("close", () => {
      authedClients.delete(ws);
      clientUsers.delete(ws);
    });
    ws.on("error", () => {
      authedClients.delete(ws);
      clientUsers.delete(ws);
    });
  });

  setEventBroadcaster((channel: string, payload: unknown) => {
    if (authedClients.size === 0) return;
    const classified = classifyWsChannel(channel);
    if (classified.kind === "drop") return;
    const message = JSON.stringify({ channel, payload });
    for (const client of authedClients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      if (classified.kind === "session") {
        const owner = getSessionOwner(classified.sessionId);
        if (owner !== clientUsers.get(client)) continue;
      }
      try {
        client.send(message);
      } catch {
        authedClients.delete(client);
        clientUsers.delete(client);
      }
    }
  });
}

function getLanIp(): string {
  const interfaces = os.networkInterfaces();
  for (const list of Object.values(interfaces)) {
    if (!list) continue;
    for (const iface of list) {
      if (iface && iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

export interface WebUIServerOptions {
  allowRemote?: boolean;
  distDir?: string;
  port?: number;
  devServerUrl?: string;
}

export interface WebUIStatus {
  running: boolean;
  enabled: boolean;
  port: number;
  host: string;
  lanIp: string;
  accessUrl: string;
  hasPassword: boolean;
}

export function getWebUIStatus(): WebUIStatus {
  const lanIp = getLanIp();
  return {
    running: webuiServer !== null,
    enabled: currentAllowRemote,
    port: currentPort,
    host: currentHost,
    lanIp,
    accessUrl: `http://${currentAllowRemote ? lanIp : "127.0.0.1"}:${currentPort}`,
    hasPassword: listUsers().length > 0
  };
}

export function startWebUIServer(options: WebUIServerOptions = {}): Promise<void> {
  return new Promise((resolve) => {
    if (webuiServer) {
      resolve();
      return;
    }

    const allowRemote = options.allowRemote === true;
    const distDir = options.distDir ? path.resolve(options.distDir) : "";
    const devServerUrl = options.devServerUrl || "";
    const host = allowRemote ? "0.0.0.0" : "127.0.0.1";
    const basePort = options.port ?? WEBUI_DEFAULT_PORT;

    currentAllowRemote = allowRemote;
    currentHost = host;

    let port = basePort;
    const maxPort = basePort + 20;

    function tryListen(p: number): void {
      if (p > maxPort) {
        console.error("[FreeBuddy] WebUI Server: Could not bind to any port in range.");
        resolve();
        return;
      }

      const server = http.createServer((req, res) => {
        void (async () => {
          if (await handleLogin(req, res)) return;
          if (await handleQrLogin(req, res)) return;

          const url = new URL(req.url || "/", "http://127.0.0.1");
          if (url.pathname === "/api/status" && req.method === "GET") {
            handleStatus(res);
            return;
          }

          if (await handleInvoke(req, res)) return;
          if (handleAttachment(req, res)) return;
          if (await handleUpload(req, res)) return;
          if (handleListDirs(req, res)) return;

          if (req.method === "GET" && !url.pathname.startsWith("/api")) {
            if (devServerUrl) {
              proxyToDevServer(req, res, devServerUrl);
              return;
            }
            if (distDir && serveStatic(res, distDir, url.pathname)) return;
          }

          sendJson(res, 404, { ok: false, error: "not_found" });
        })().catch((error) => {
          if (res.headersSent) return;
          sendJson(res, 500, { ok: false, error: (error as Error)?.message || String(error) });
        });
      });

      server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          server.close();
          tryListen(p + 1);
        } else {
          console.error(`[FreeBuddy] WebUI Server error on port ${p}:`, err);
          resolve();
        }
      });

      server.listen(p, host, () => {
        webuiServer = server;
        currentPort = p;
        setupWebSocket(server, devServerUrl);
        console.log(
          `[FreeBuddy] WebUI Server listening on ${host}:${p}` +
            (allowRemote ? " (remote access enabled)" : "")
        );
        resolve();
      });
    }

    tryListen(port);
  });
}

export function stopWebUIServer(): Promise<void> {
  return new Promise((resolve) => {
    if (wss) {
      try {
        wss.close();
      } catch {
        // ignore
      }
      wss = null;
    }
    authedClients.clear();
    clientUsers.clear();
    const server = webuiServer;
    webuiServer = null;
    if (server) {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      server.close(finish);
      setTimeout(finish, 1500);
    } else {
      resolve();
    }
  });
}

export async function restartWebUIServer(
  options: WebUIServerOptions
): Promise<WebUIStatus> {
  await stopWebUIServer();
  await startWebUIServer(options);
  return getWebUIStatus();
}
