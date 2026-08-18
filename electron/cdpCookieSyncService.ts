import fs from "node:fs";
import { spawn } from "node:child_process";
import * as electronModule from "electron";
import WebSocket from "ws";

const electronSession = (electronModule as any)?.session || (electronModule as any)?.default?.session;

export interface CdpCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  expires?: number;
  size?: number;
  httpOnly?: boolean;
  secure?: boolean;
  session?: boolean;
  sameSite?: "Strict" | "Lax" | "None" | string;
}

export interface CdpStatusResult {
  connected: boolean;
  browser?: string;
  webSocketDebuggerUrl?: string;
}

export interface CdpSyncResult {
  success: boolean;
  count: number;
  domains: string[];
  error?: string;
}

export interface CdpLaunchResult {
  success: boolean;
  launched: boolean;
  browserPath?: string;
  error?: string;
}

export function findChromeExecutable(): string | null {
  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";
  const isLinux = process.platform === "linux";

  const candidates: string[] = [];

  if (isWin) {
    const localAppData = process.env.LOCALAPPDATA || "";
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

    candidates.push(
      `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`,
      `${localAppData}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFilesX86}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${programFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${localAppData}\\Microsoft\\Edge\\Application\\msedge.exe`
    );
  } else if (isMac) {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Chromium.app/Contents/MacOS/Chromium"
    );
  } else if (isLinux) {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
      "/usr/bin/microsoft-edge",
      "/usr/bin/microsoft-edge-stable"
    );
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function checkCdpStatus(port = 9222): Promise<CdpStatusResult> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1800);
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      return { connected: false };
    }

    const data = (await res.json()) as {
      Browser?: string;
      webSocketDebuggerUrl?: string;
    };

    return {
      connected: true,
      browser: data.Browser || "Chromium",
      webSocketDebuggerUrl: data.webSocketDebuggerUrl
    };
  } catch {
    return { connected: false };
  }
}

export async function launchDebugChrome(
  port = 9222,
  targetUrl = "https://www.baidu.com"
): Promise<CdpLaunchResult> {
  const currentStatus = await checkCdpStatus(port);
  if (currentStatus.connected) {
    return { success: true, launched: false, browserPath: "Already running" };
  }

  const exePath = findChromeExecutable();
  if (!exePath) {
    return {
      success: false,
      launched: false,
      error: "CHROME_NOT_FOUND"
    };
  }

  try {
    const child = spawn(
      exePath,
      [`--remote-debugging-port=${port}`, "--restore-last-session", targetUrl],
      {
        detached: true,
        stdio: "ignore"
      }
    );
    child.unref();

    // Poll up to 6 seconds for CDP to become ready
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const status = await checkCdpStatus(port);
      if (status.connected) {
        return { success: true, launched: true, browserPath: exePath };
      }
    }

    return {
      success: false,
      launched: false,
      browserPath: exePath,
      error: "CHROME_RUNNING_WITHOUT_DEBUG_PORT"
    };
  } catch (err: any) {
    return {
      success: false,
      launched: false,
      error: err?.message || "FAILED_TO_LAUNCH"
    };
  }
}

async function queryCookiesOverCdpWs(wsUrl: string): Promise<CdpCookie[]> {
  return new Promise<CdpCookie[]>((resolve, reject) => {
    let ws: WebSocket | null = null;
    const timeout = setTimeout(() => {
      if (ws) ws.close();
      reject(new Error("CDP_TIMEOUT"));
    }, 6000);

    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      clearTimeout(timeout);
      return reject(err);
    }

    ws.on("open", () => {
      ws?.send(JSON.stringify({ id: 1, method: "Storage.getCookies" }));
      ws?.send(JSON.stringify({ id: 2, method: "Network.getAllCookies" }));
    });

    let resolved = false;

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.result && Array.isArray(msg.result.cookies) && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          ws?.close();
          resolve(msg.result.cookies);
        }
      } catch {
        // ignore message parse error
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

const sameSiteMap: Record<string, "unspecified" | "no_restriction" | "lax" | "strict"> = {
  Strict: "strict",
  strict: "strict",
  Lax: "lax",
  lax: "lax",
  None: "no_restriction",
  no_restriction: "no_restriction",
  unspecified: "unspecified"
};

export async function injectCookiesIntoElectron(cookies: CdpCookie[]): Promise<{ count: number; domains: string[] }> {
  if (!cookies || !Array.isArray(cookies) || cookies.length === 0) {
    return { count: 0, domains: [] };
  }

  let injectedCount = 0;
  const domainSet = new Set<string>();
  const ses = electronSession?.defaultSession;

  for (const c of cookies) {
    try {
      if (!c.name || !c.domain) continue;
      const isDomainCookie = c.domain.startsWith(".");
      const cleanDomain = isDomainCookie ? c.domain.slice(1) : c.domain;
      const protocol = c.secure ? "https:" : "http:";
      const url = `${protocol}//${cleanDomain}${c.path || "/"}`;

      domainSet.add(cleanDomain);

      if (ses) {
        await ses.cookies.set({
          url,
          name: c.name,
          value: c.value,
          domain: isDomainCookie ? c.domain : undefined,
          path: c.path || "/",
          secure: Boolean(c.secure),
          httpOnly: Boolean(c.httpOnly),
          expirationDate: c.expires && c.expires > 0 ? c.expires : undefined,
          sameSite: c.sameSite ? sameSiteMap[c.sameSite] || "unspecified" : "unspecified"
        });
      }
      injectedCount++;
    } catch {
      // ignore malformed cookie entry
    }
  }

  if (ses) {
    await ses.cookies.flushStore();
  }

  return {
    count: injectedCount,
    domains: Array.from(domainSet)
  };
}

export async function syncCookiesFromCdp(port = 9222): Promise<CdpSyncResult> {
  const status = await checkCdpStatus(port);
  if (!status.connected || !status.webSocketDebuggerUrl) {
    return {
      success: false,
      count: 0,
      domains: [],
      error: "CDP_NOT_RUNNING"
    };
  }

  try {
    let cookies: CdpCookie[] = [];
    try {
      cookies = await queryCookiesOverCdpWs(status.webSocketDebuggerUrl);
    } catch {
      // If browser target fails, try active page target from /json/list
      const listRes = await fetch(`http://127.0.0.1:${port}/json/list`).catch(() => null);
      if (listRes && listRes.ok) {
        const pages = (await listRes.json()) as Array<{ webSocketDebuggerUrl?: string }>;
        for (const page of pages) {
          if (page.webSocketDebuggerUrl) {
            try {
              cookies = await queryCookiesOverCdpWs(page.webSocketDebuggerUrl);
              if (cookies.length > 0) break;
            } catch {
              // try next page
            }
          }
        }
      }
    }

    const { count, domains } = await injectCookiesIntoElectron(cookies);

    return {
      success: true,
      count,
      domains
    };
  } catch (err: any) {
    return {
      success: false,
      count: 0,
      domains: [],
      error: err?.message || "SYNC_FAILED"
    };
  }
}

export async function importCookiesFromJson(jsonString: string): Promise<CdpSyncResult> {
  try {
    const parsed = JSON.parse(jsonString);
    const cookies: CdpCookie[] = Array.isArray(parsed)
      ? parsed
      : parsed.cookies && Array.isArray(parsed.cookies)
        ? parsed.cookies
        : [];

    if (cookies.length === 0) {
      return { success: false, count: 0, domains: [], error: "NO_COOKIES_FOUND" };
    }

    const { count, domains } = await injectCookiesIntoElectron(cookies);
    return {
      success: true,
      count,
      domains
    };
  } catch {
    return {
      success: false,
      count: 0,
      domains: [],
      error: "INVALID_JSON"
    };
  }
}
