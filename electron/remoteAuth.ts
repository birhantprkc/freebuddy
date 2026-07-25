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
  ip?: string | null;
  userAgent?: string | null;
}

export interface SessionRecord {
  tokenHash: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number | null;
  ip: string | null;
  userAgent: string | null;
}

const sessions = new Map<string, Session>();

/**
 * Lets the WebUI server drop live sockets when a session is revoked. Without
 * it a kicked device keeps receiving events over its existing connection.
 */
export interface SessionRevocation {
  all?: boolean;
  userIds?: string[];
  tokens?: string[];
}

type SessionRevocationListener = (revocation: SessionRevocation) => void;

let revocationListener: SessionRevocationListener | null = null;

export function setSessionRevocationListener(
  listener: SessionRevocationListener | null
): void {
  revocationListener = listener;
}

function notifyRevoked(revocation: SessionRevocation): void {
  try {
    revocationListener?.(revocation);
  } catch {
    /* a broken listener must not block the revocation itself */
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Exposed so live sockets can be matched against admin-visible session ids. */
export function hashSessionToken(token: string): string {
  return hashToken(token);
}

/**
 * Sessions outlive the account they belong to unless we check: the row keeps
 * authenticating, and an empty root list then falls back to the host home
 * directory, so deleting a restricted user would widen their access.
 */
function userIsActive(userId: string): boolean {
  try {
    const row = getDb()
      .prepare("SELECT disabled FROM remote_users WHERE id = ?")
      .get(userId) as { disabled?: number } | undefined;
    if (!row) return false;
    return row.disabled !== 1;
  } catch {
    return false;
  }
}

function persistSession(session: Session): void {
  try {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO remote_sessions
           (token_hash, user_id, created_at, expires_at, ip, user_agent, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        hashToken(session.token),
        session.userId,
        session.createdAt,
        session.expiresAt,
        session.ip ?? null,
        session.userAgent ?? null,
        session.createdAt
      );
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
      .prepare(
        "SELECT user_id, created_at, expires_at, ip, user_agent FROM remote_sessions WHERE token_hash = ?"
      )
      .get(hashToken(token)) as
      | {
          user_id: string;
          created_at: number;
          expires_at: number;
          ip: string | null;
          user_agent: string | null;
        }
      | undefined;
    if (!row) return null;
    const session: Session = {
      token,
      userId: row.user_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      ip: row.ip,
      userAgent: row.user_agent
    };
    sessions.set(token, session);
    return session;
  } catch {
    return null;
  }
}

export function listSessionRecords(): SessionRecord[] {
  try {
    const rows = getDb()
      .prepare(
        `SELECT token_hash, user_id, created_at, expires_at, last_seen_at, ip, user_agent
           FROM remote_sessions ORDER BY created_at DESC`
      )
      .all() as Array<{
      token_hash: string;
      user_id: string;
      created_at: number;
      expires_at: number;
      last_seen_at: number | null;
      ip: string | null;
      user_agent: string | null;
    }>;
    return rows.map((row) => ({
      tokenHash: row.token_hash,
      userId: row.user_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      lastSeenAt: row.last_seen_at,
      ip: row.ip,
      userAgent: row.user_agent
    }));
  } catch {
    return [];
  }
}

/** Sessions are identified by their hash in the admin UI; the raw token never leaves the device. */
export function revokeSessionByHash(tokenHash: string): boolean {
  let removedToken: string | null = null;
  for (const [token, session] of sessions) {
    if (hashToken(token) === tokenHash) {
      sessions.delete(token);
      removedToken = token;
      break;
    }
  }
  let removed = removedToken !== null;
  try {
    const result = getDb()
      .prepare("DELETE FROM remote_sessions WHERE token_hash = ?")
      .run(tokenHash);
    removed = removed || result.changes > 0;
  } catch {
    /* ignore */
  }
  if (removed) notifyRevoked({ tokens: [tokenHash] });
  return removed;
}

export function invalidateUserSessions(userId: string): void {
  for (const [token, session] of sessions) {
    if (session.userId === userId) sessions.delete(token);
  }
  try {
    getDb().prepare("DELETE FROM remote_sessions WHERE user_id = ?").run(userId);
  } catch {
    /* ignore */
  }
  notifyRevoked({ userIds: [userId] });
}

export function destroySession(token: string): void {
  const hash = hashToken(token);
  sessions.delete(token);
  deletePersistedSession(token);
  notifyRevoked({ tokens: [hash] });
}

function touchSession(token: string): void {
  try {
    getDb()
      .prepare("UPDATE remote_sessions SET last_seen_at = ? WHERE token_hash = ?")
      .run(Date.now(), hashToken(token));
  } catch {
    /* ignore */
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

export function createSession(
  userId: string,
  device: { ip?: string | null; userAgent?: string | null } = {}
): string {
  pruneExpiredSessions();
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const session: Session = {
    token,
    userId,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    ip: device.ip ?? null,
    userAgent: device.userAgent ?? null
  };
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
  if (!userIsActive(session.userId)) {
    sessions.delete(token);
    deletePersistedSession(token);
    return null;
  }
  touchSession(token);
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
  notifyRevoked({ all: true });
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

/**
 * The cookie is HttpOnly, so the page cannot clear it. Logging out has to
 * expire it from the server or the next request is still authenticated.
 */
export function buildExpiredSessionCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
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

