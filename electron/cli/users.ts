import { randomUUID } from "node:crypto";
import type { Database as DB } from "better-sqlite3";

import { getDb as getGlobalDb } from "./db.js";
import {
  generateRandomPassword,
  hashPassword,
  verifyPassword
} from "../shared/passwordHash.js";
import { normalizeRoot } from "../shared/workspaceRoots.js";

let testDb: DB | null = null;
export function setDbForTest(db: DB | null): void {
  testDb = db;
}
function getDb(): DB {
  return testDb ?? getGlobalDb();
}

export interface RemoteUser {
  id: string;
  username: string;
  isOwner: boolean;
  createdAt: number;
}

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,32}$/;

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  is_owner: number;
  created_at: number;
}

function rowToUser(row: UserRow): RemoteUser {
  return {
    id: row.id,
    username: row.username,
    isOwner: row.is_owner === 1,
    createdAt: row.created_at
  };
}

const USER_COLUMNS = "id, username, password_hash, is_owner, created_at";

export function listUsers(): RemoteUser[] {
  return (getDb()
    .prepare(`SELECT ${USER_COLUMNS} FROM remote_users ORDER BY created_at ASC`)
    .all() as UserRow[]).map(rowToUser);
}

export function getUserById(id: string): RemoteUser | null {
  const row = getDb()
    .prepare(`SELECT ${USER_COLUMNS} FROM remote_users WHERE id = ?`)
    .get(id) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

export function getOwnerUser(): RemoteUser | null {
  const row = getDb()
    .prepare(`SELECT ${USER_COLUMNS} FROM remote_users WHERE is_owner = 1 LIMIT 1`)
    .get() as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

export function getLocalUserId(): string | null {
  return getOwnerUser()?.id ?? null;
}

export function createUser(input: {
  username: string;
  password?: string;
  isOwner?: boolean;
}): { user: RemoteUser; password: string } {
  const username = input.username.trim();
  if (!USERNAME_RE.test(username)) throw new Error("invalid_username");
  const existing = getDb()
    .prepare("SELECT 1 FROM remote_users WHERE username = ?")
    .get(username);
  if (existing) throw new Error("username_taken");
  const password = input.password ?? generateRandomPassword();
  if (password.length < 8) throw new Error("password_too_short");
  const isOwner =
    input.isOwner ??
    (
      getDb().prepare("SELECT COUNT(*) AS n FROM remote_users").get() as { n: number }
    ).n === 0
      ? 1
      : 0;
  const id = randomUUID();
  const createdAt = Date.now();
  getDb()
    .prepare(
      "INSERT INTO remote_users (id, username, password_hash, is_owner, created_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(id, username, hashPassword(password), isOwner, createdAt);
  return { user: { id, username, isOwner: isOwner === 1, createdAt }, password };
}

export function verifyUserLogin(username: string, password: string): RemoteUser | null {
  const row = getDb()
    .prepare(`SELECT ${USER_COLUMNS} FROM remote_users WHERE username = ?`)
    .get(username.trim()) as UserRow | undefined;
  if (!row) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  return rowToUser(row);
}

export function resetUserPassword(id: string): { user: RemoteUser; password: string } | null {
  const user = getUserById(id);
  if (!user) return null;
  const password = generateRandomPassword();
  getDb()
    .prepare("UPDATE remote_users SET password_hash = ? WHERE id = ?")
    .run(hashPassword(password), id);
  return { user, password };
}

export function setUserPassword(id: string, plain: string): boolean {
  if (plain.length < 8) throw new Error("password_too_short");
  const user = getUserById(id);
  if (!user) return false;
  getDb()
    .prepare("UPDATE remote_users SET password_hash = ? WHERE id = ?")
    .run(hashPassword(plain), id);
  return true;
}

export function ensureOwnerUser(options: { password?: string } = {}): {
  user: RemoteUser;
  password: string | null;
} {
  bootstrapOwnerFromLegacyPassword();
  const existing = getOwnerUser();
  if (existing) {
    if (options.password && options.password.length >= 8) {
      setUserPassword(existing.id, options.password);
    }
    return { user: existing, password: null };
  }
  const created = createUser({ username: "owner", password: options.password });
  return { user: created.user, password: created.password };
}

export function getUserRoots(userId: string): string[] {
  const rows = getDb()
    .prepare("SELECT root_path FROM remote_user_roots WHERE user_id = ? ORDER BY root_path ASC")
    .all(userId) as Array<{ root_path: string }>;
  return rows.map((r) => r.root_path);
}

export function setUserRoots(userId: string, roots: string[]): void {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of roots) {
    const n = normalizeRoot(raw);
    if (n && !seen.has(n)) {
      seen.add(n);
      normalized.push(n);
    }
  }
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM remote_user_roots WHERE user_id = ?").run(userId);
    const insert = db.prepare(
      "INSERT OR IGNORE INTO remote_user_roots (user_id, root_path) VALUES (?, ?)"
    );
    for (const root of normalized) insert.run(userId, root);
  });
  tx();
}

export function migrateGlobalRootsToOwner(ownerId: string): void {
  if (getUserRoots(ownerId).length > 0) return;
  const row = getDb()
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get("remote.workspaceRoots") as { value: string } | undefined;
  if (!row?.value) return;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    parsed = null;
  }
  if (!Array.isArray(parsed)) return;
  setUserRoots(
    ownerId,
    parsed.filter((r): r is string => typeof r === "string")
  );
}

export function deleteUser(id: string): boolean {
  const user = getUserById(id);
  if (!user) return false;
  if (user.isOwner) throw new Error("cannot_delete_owner");
  getDb().prepare("DELETE FROM remote_users WHERE id = ?").run(id);
  return true;
}

export function bootstrapOwnerFromLegacyPassword(): void {
  if (getOwnerUser()) return;
  if (listUsers().length > 0) return;
  const row = getDb()
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get("remote.password") as { value: string } | undefined;
  const legacyHash = row?.value;
  if (!legacyHash || !legacyHash.startsWith("scrypt:")) return;
  const id = randomUUID();
  getDb()
    .prepare(
      "INSERT INTO remote_users (id, username, password_hash, is_owner, created_at) VALUES (?, ?, ?, 1, ?)"
    )
    .run(id, "owner", legacyHash, Date.now());
}
