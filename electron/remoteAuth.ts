import { createHash, randomBytes } from "node:crypto";

import { getSetting, setSetting } from "./cli/settings.js";
import { getDb } from "./cli/db.js";
import {
  generateRandomPassword,
  hashPassword,
  verifyPassword
} from "./shared/passwordHash.js";

export { generateRandomPassword } from "./shared/passwordHash.js";

const PASSWORD_KEY = "remote.password";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 32;

interface Session {
  token: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

const sessions = new Map<string, Session>();

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function persistSession(session: Session): void {
  try {
    getDb()
      .prepare(
        "INSERT OR REPLACE INTO remote_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
      )
      .run(hashToken(session.token), session.userId, session.createdAt, session.expiresAt);
  } catch {
    // DB may be unavailable very early in startup; the in-memory entry still works.
  }
}

function deletePersistedSession(token: string): void {
  try {
    getDb().prepare("DELETE FROM remote_sessions WHERE token_hash = ?").run(hashToken(token));
  } catch {
    /* ignore */
  }
}

function lookupSession(token: string): Session | null {
  const cached = sessions.get(token);
  if (cached) return cached;
  try {
    const row = getDb()
      .prepare("SELECT user_id, created_at, expires_at FROM remote_sessions WHERE token_hash = ?")
      .get(hashToken(token)) as { user_id: string; created_at: number; expires_at: number } | undefined;
    if (!row) return null;
    const session: Session = {
      token,
      userId: row.user_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at
    };
    sessions.set(token, session);
    return session;
  } catch {
    return null;
  }
}

export function getStoredPasswordHash(): string | null {
  const raw = getSetting(PASSWORD_KEY);
  return raw && raw.startsWith("scrypt:") ? raw : null;
}

export function hasRemotePassword(): boolean {
  return getStoredPasswordHash() !== null;
}

export function ensureRemotePassword(): { password: string; isNew: boolean } {
  const existing = getStoredPasswordHash();
  if (existing) {
    return { password: "", isNew: false };
  }
  const plain = generateRandomPassword();
  setSetting(PASSWORD_KEY, hashPassword(plain));
  return { password: plain, isNew: true };
}

export function setRemotePassword(plain: string): void {
  if (!plain || plain.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  setSetting(PASSWORD_KEY, hashPassword(plain));
  invalidateAllSessions();
}

export function authenticatePassword(plain: string): boolean {
  const stored = getStoredPasswordHash();
  if (!stored) return false;
  return verifyPassword(plain, stored);
}

export function createSession(userId: string): string {
  pruneExpiredSessions();
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const session: Session = { token, userId, createdAt: now, expiresAt: now + SESSION_TTL_MS };
  sessions.set(token, session);
  persistSession(session);
  while (sessions.size > MAX_SESSIONS) {
    const oldest = [...sessions.values()].sort(
      (a, b) => a.createdAt - b.createdAt
    )[0];
    if (oldest) {
      sessions.delete(oldest.token);
      deletePersistedSession(oldest.token);
    } else break;
  }
  return token;
}

export function sessionUserId(token: string | null | undefined): string | null {
  if (!token) return null;
  const session = lookupSession(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    deletePersistedSession(token);
    return null;
  }
  return session.userId;
}

export function checkSession(token: string | null | undefined): boolean {
  return sessionUserId(token) !== null;
}

export function invalidateAllSessions(): void {
  sessions.clear();
  try {
    getDb().prepare("DELETE FROM remote_sessions").run();
  } catch {
    /* ignore */
  }
}

/** Test-only: drop the in-memory cache so lookups fall through to the DB. */
export function __resetInMemorySessionsForTest(): void {
  sessions.clear();
}

export function extractBearerToken(
  auth: string | null | undefined
): string | null {
  if (!auth || !auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

export const SESSION_COOKIE_NAME = "fb_remote_token";
const SESSION_TTL_SECONDS = Math.floor(SESSION_TTL_MS / 1000);

export function buildSessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function readSessionCookie(
  cookieHeader: string | null | undefined
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE_NAME) {
      const value = part.slice(eq + 1).trim();
      if (value) return value;
    }
  }
  return null;
}

function pruneExpiredSessions(): void {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now > session.expiresAt) sessions.delete(token);
  }
  try {
    getDb().prepare("DELETE FROM remote_sessions WHERE expires_at < ?").run(now);
  } catch {
    /* ignore */
  }
}

const qrTokens = new Map<string, number>();
const QR_TTL_MS = 5 * 60 * 1000;

export function generateQrToken(): string {
  pruneQrTokens();
  const token = randomBytes(32).toString("hex");
  qrTokens.set(token, Date.now() + QR_TTL_MS);
  return token;
}

export function consumeQrToken(token: string | null | undefined): boolean {
  if (!token) return false;
  const expiresAt = qrTokens.get(token);
  if (!expiresAt) return false;
  qrTokens.delete(token);
  return Date.now() <= expiresAt;
}

function pruneQrTokens(): void {
  const now = Date.now();
  for (const [token, expiresAt] of qrTokens) {
    if (now > expiresAt) qrTokens.delete(token);
  }
}
