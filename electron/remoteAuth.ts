import { randomBytes } from "node:crypto";

import { getSetting, setSetting } from "./cli/settings.js";
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
  sessions.set(token, { token, userId, createdAt: now, expiresAt: now + SESSION_TTL_MS });
  while (sessions.size > MAX_SESSIONS) {
    const oldest = [...sessions.values()].sort(
      (a, b) => a.createdAt - b.createdAt
    )[0];
    if (oldest) sessions.delete(oldest.token);
    else break;
  }
  return token;
}

export function sessionUserId(token: string | null | undefined): string | null {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return session.userId;
}

export function checkSession(token: string | null | undefined): boolean {
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function invalidateAllSessions(): void {
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
