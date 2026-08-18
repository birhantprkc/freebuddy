import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import * as electronModule from "electron";
import Database from "better-sqlite3";

const electronSession = (electronModule as any)?.session || (electronModule as any)?.default?.session;

export interface ImportedCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "unspecified" | "no_restriction" | "lax" | "strict";
}

export interface BrowserImportResult {
  success: boolean;
  count: number;
  domains: string[];
  browserName?: string;
  error?: string;
}

interface BrowserLocation {
  name: string;
  userDataDir: string;
}

function getCandidateBrowserLocations(): BrowserLocation[] {
  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";
  const isLinux = process.platform === "linux";

  const locations: BrowserLocation[] = [];

  if (isWin) {
    const localAppData = process.env.LOCALAPPDATA || "";
    const appData = process.env.APPDATA || "";

    if (localAppData) {
      locations.push(
        { name: "Google Chrome", userDataDir: path.join(localAppData, "Google", "Chrome", "User Data") },
        { name: "Microsoft Edge", userDataDir: path.join(localAppData, "Microsoft", "Edge", "User Data") },
        { name: "Brave Browser", userDataDir: path.join(localAppData, "BraveSoftware", "Brave-Browser", "User Data") }
      );
    }
  } else if (isMac) {
    const home = os.homedir();
    locations.push(
      { name: "Google Chrome", userDataDir: path.join(home, "Library", "Application Support", "Google", "Chrome") },
      { name: "Microsoft Edge", userDataDir: path.join(home, "Library", "Application Support", "Microsoft Edge") },
      { name: "Brave Browser", userDataDir: path.join(home, "Library", "Application Support", "BraveSoftware", "Brave-Browser") }
    );
  } else if (isLinux) {
    const home = os.homedir();
    locations.push(
      { name: "Google Chrome", userDataDir: path.join(home, ".config", "google-chrome") },
      { name: "Chromium", userDataDir: path.join(home, ".config", "chromium") },
      { name: "Microsoft Edge", userDataDir: path.join(home, ".config", "microsoft-edge") }
    );
  }

  return locations.filter((loc) => fs.existsSync(loc.userDataDir));
}

async function unprotectWindowsDpapi(dpapiBuffer: Buffer): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const b64 = dpapiBuffer.toString("base64");
    const script = `
Add-Type -AssemblyName System.Security
$b64 = "${b64}"
$bytes = [Convert]::FromBase64String($b64)
$unprotected = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Convert]::ToBase64String($unprotected)
`;
    execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(stderr || err.message || "DPAPI_UNPROTECT_FAILED"));
      }
      const outB64 = stdout.trim();
      if (!outB64) {
        return reject(new Error("EMPTY_DPAPI_OUTPUT"));
      }
      resolve(Buffer.from(outB64, "base64"));
    });
  });
}

async function getWindowsMasterKey(userDataDir: string): Promise<Buffer | null> {
  const localStatePath = path.join(userDataDir, "Local State");
  if (!fs.existsSync(localStatePath)) return null;

  try {
    const content = fs.readFileSync(localStatePath, "utf8");
    const json = JSON.parse(content);
    const encryptedKeyB64 = json?.os_crypt?.encrypted_key;
    if (!encryptedKeyB64) return null;

    const encryptedKey = Buffer.from(encryptedKeyB64, "base64");
    // Strip leading 5 bytes ('DPAPI')
    const dpapiBlob = encryptedKey.subarray(5);
    return await unprotectWindowsDpapi(dpapiBlob);
  } catch {
    return null;
  }
}

async function getMacMasterKey(browserName: string): Promise<Buffer | null> {
  return new Promise<Buffer | null>((resolve) => {
    const service = browserName.includes("Edge")
      ? "Microsoft Edge Safe Storage"
      : "Chrome Safe Storage";
    execFile("security", ["find-generic-password", "-w", "-s", service], (err, stdout) => {
      if (err || !stdout.trim()) {
        return resolve(null);
      }
      const password = stdout.trim();
      const salt = "saltysalt";
      const key = crypto.pbkdf2Sync(password, salt, 1003, 16, "sha1");
      resolve(key);
    });
  });
}

function decryptCookieValue(encrypted: Buffer, masterKey: Buffer, isMac = false): string | null {
  if (!encrypted || encrypted.length === 0) return null;

  try {
    if (isMac) {
      // macOS AES-128-CBC
      const prefix = encrypted.subarray(0, 3).toString("utf8");
      if (prefix === "v10" || prefix === "v11") {
        const iv = Buffer.alloc(16, " ");
        const ciphertext = encrypted.subarray(3);
        const decipher = crypto.createDecipheriv("aes-128-cbc", masterKey, iv);
        decipher.setAutoPadding(true);
        const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return decrypted.subarray(32).toString("utf8"); // strip 32-byte hash prefix
      }
      return null;
    }

    // Windows AES-256-GCM
    const prefix = encrypted.subarray(0, 3).toString("utf8");
    if (prefix === "v10" || prefix === "v20") {
      const iv = encrypted.subarray(3, 15);
      const tag = encrypted.subarray(encrypted.length - 16);
      const ciphertext = encrypted.subarray(15, encrypted.length - 16);

      const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return decrypted.toString("utf8");
    }

    return null;
  } catch {
    return null;
  }
}

function getProfileCookieDatabases(userDataDir: string): string[] {
  const profileNames = ["Default", "Profile 1", "Profile 2", "Profile 3", "Profile 4"];
  const dbPaths: string[] = [];

  for (const p of profileNames) {
    const candidates = [
      path.join(userDataDir, p, "Network", "Cookies"),
      path.join(userDataDir, p, "Cookies")
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        dbPaths.push(c);
      }
    }
  }

  return dbPaths;
}

const sameSiteMap: Record<number, "unspecified" | "no_restriction" | "lax" | "strict"> = {
  [-1]: "unspecified",
  0: "unspecified",
  1: "lax",
  2: "strict"
};

export async function importCookiesFromLocalBrowser(targetBrowser?: string): Promise<BrowserImportResult> {
  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";

  const locations = getCandidateBrowserLocations();
  if (locations.length === 0) {
    return {
      success: false,
      count: 0,
      domains: [],
      error: "NO_SUPPORTED_BROWSER_FOUND"
    };
  }

  const chosenLocation = targetBrowser
    ? locations.find((l) => l.name.toLowerCase().includes(targetBrowser.toLowerCase())) || locations[0]
    : locations[0];

  let masterKey: Buffer | null = null;
  if (isWin) {
    masterKey = await getWindowsMasterKey(chosenLocation.userDataDir);
  } else if (isMac) {
    masterKey = await getMacMasterKey(chosenLocation.name);
  }

  if (!masterKey) {
    // Try fallback locations
    for (const loc of locations) {
      if (loc === chosenLocation) continue;
      if (isWin) {
        masterKey = await getWindowsMasterKey(loc.userDataDir);
      } else if (isMac) {
        masterKey = await getMacMasterKey(loc.name);
      }
      if (masterKey) {
        break;
      }
    }
  }

  if (!masterKey) {
    return {
      success: false,
      count: 0,
      domains: [],
      error: "MASTER_KEY_DECRYPT_FAILED"
    };
  }

  const cookieDbs = getProfileCookieDatabases(chosenLocation.userDataDir);
  if (cookieDbs.length === 0) {
    return {
      success: false,
      count: 0,
      domains: [],
      error: "COOKIE_DATABASE_NOT_FOUND"
    };
  }

  const domainSet = new Set<string>();
  let totalInjected = 0;
  const ses = electronSession?.defaultSession;

  for (const originalDbPath of cookieDbs) {
    const tempDbPath = path.join(os.tmpdir(), `freebuddy-cookies-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
    try {
      fs.copyFileSync(originalDbPath, tempDbPath);
      const db = new Database(tempDbPath, { readonly: true, fileMustExist: true });

      const rows = db.prepare(`
        SELECT host_key, name, path, is_secure, is_httponly, expires_utc, same_site, value, encrypted_value
        FROM cookies
      `).all() as Array<{
        host_key: string;
        name: string;
        path: string;
        is_secure: number;
        is_httponly: number;
        expires_utc: number;
        same_site: number;
        value: string;
        encrypted_value: Buffer;
      }>;

      db.close();

      for (const row of rows) {
        try {
          let cookieValue = row.value;
          if (!cookieValue && row.encrypted_value && row.encrypted_value.length > 0) {
            const dec = decryptCookieValue(row.encrypted_value, masterKey, isMac);
            if (dec) cookieValue = dec;
          }

          if (!cookieValue || !row.name || !row.host_key) continue;

          const hostKey = row.host_key;
          const isDomainCookie = hostKey.startsWith(".");
          const cleanDomain = isDomainCookie ? hostKey.slice(1) : hostKey;
          const protocol = row.is_secure ? "https:" : "http:";
          const cookiePath = row.path || "/";
          const url = `${protocol}//${cleanDomain}${cookiePath}`;

          domainSet.add(cleanDomain);

          // Convert Chromium Windows epoch (microseconds since 1601-01-01) to Unix epoch (seconds)
          let expirationDate: number | undefined;
          if (row.expires_utc && row.expires_utc > 11644473600000000) {
            expirationDate = Math.floor((row.expires_utc - 11644473600000000) / 1000000);
          }

          if (ses) {
            await ses.cookies.set({
              url,
              name: row.name,
              value: cookieValue,
              domain: isDomainCookie ? hostKey : undefined,
              path: cookiePath,
              secure: Boolean(row.is_secure),
              httpOnly: Boolean(row.is_httponly),
              expirationDate,
              sameSite: sameSiteMap[row.same_site] || "unspecified"
            });
          }

          totalInjected++;
        } catch {
          // ignore individual invalid cookie
        }
      }
    } catch {
      // ignore db open error and continue
    } finally {
      if (fs.existsSync(tempDbPath)) {
        try {
          fs.unlinkSync(tempDbPath);
        } catch {
          // ignore cleanup error
        }
      }
    }
  }

  if (ses) {
    await ses.cookies.flushStore();
  }

  return {
    success: true,
    count: totalInjected,
    domains: Array.from(domainSet),
    browserName: chosenLocation.name
  };
}

export async function importCookiesFromJson(jsonString: string): Promise<BrowserImportResult> {
  try {
    const parsed = JSON.parse(jsonString);
    const cookies: Array<{
      name?: string;
      value?: string;
      domain?: string;
      path?: string;
      secure?: boolean;
      httpOnly?: boolean;
      expirationDate?: number;
      expires?: number;
      sameSite?: string;
    }> = Array.isArray(parsed)
      ? parsed
      : parsed.cookies && Array.isArray(parsed.cookies)
        ? parsed.cookies
        : [];

    if (cookies.length === 0) {
      return { success: false, count: 0, domains: [], error: "NO_COOKIES_FOUND" };
    }

    const domainSet = new Set<string>();
    let totalInjected = 0;
    const ses = electronSession?.defaultSession;

    const sameSiteJsonMap: Record<string, "unspecified" | "no_restriction" | "lax" | "strict"> = {
      Strict: "strict",
      strict: "strict",
      Lax: "lax",
      lax: "lax",
      None: "no_restriction",
      no_restriction: "no_restriction",
      unspecified: "unspecified"
    };

    for (const c of cookies) {
      try {
        if (!c.name || !c.domain || c.value === undefined) continue;
        const isDomainCookie = c.domain.startsWith(".");
        const cleanDomain = isDomainCookie ? c.domain.slice(1) : c.domain;
        const protocol = c.secure ? "https:" : "http:";
        const cookiePath = c.path || "/";
        const url = `${protocol}//${cleanDomain}${cookiePath}`;

        domainSet.add(cleanDomain);

        const exp = c.expirationDate || c.expires;

        if (ses) {
          await ses.cookies.set({
            url,
            name: c.name,
            value: String(c.value),
            domain: isDomainCookie ? c.domain : undefined,
            path: cookiePath,
            secure: Boolean(c.secure),
            httpOnly: Boolean(c.httpOnly),
            expirationDate: exp && exp > 0 ? exp : undefined,
            sameSite: c.sameSite ? sameSiteJsonMap[c.sameSite] || "unspecified" : "unspecified"
          });
        }
        totalInjected++;
      } catch {
        // ignore entry
      }
    }

    if (ses) {
      await ses.cookies.flushStore();
    }

    return {
      success: true,
      count: totalInjected,
      domains: Array.from(domainSet)
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
