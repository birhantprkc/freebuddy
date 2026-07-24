import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import { getSetting, setSetting } from "./cli/settings.js";

const PASSWORD_KEY = "remote.password";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 32;

interface Session {
  token: string;
  createdAt: number;
  expiresAt: number;
}

const sessions = new Map<string, Session>();

export function generateRandomPassword(length = 16): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, 64);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  try {
    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    const hash = scryptSync(plain, salt, expected.length);
    if (hash.length !== expected.length) return false;
    return timingSafeEqual(hash, expected);
  } catch {
    return false;
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

export function createSession(): string {
  pruneExpiredSessions();
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  sessions.set(token, { token, createdAt: now, expiresAt: now + SESSION_TTL_MS });
  while (sessions.size > MAX_SESSIONS) {
    const oldest = [...sessions.values()].sort(
      (a, b) => a.createdAt - b.createdAt
    )[0];
    if (oldest) sessions.delete(oldest.token);
    else break;
  }
  return token;
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
