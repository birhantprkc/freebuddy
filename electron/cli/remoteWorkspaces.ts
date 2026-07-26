import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { getDataDir, getDb } from "./db.js";
import { isPathWithinRoots } from "../shared/workspaceRoots.js";

export interface RemoteWorkspace {
  id: string;
  ownerId: string;
  sourcePath: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
}

const materializeLocks = new Map<string, Promise<void>>();

function rowToWorkspace(row: any): RemoteWorkspace {
  return {
    id: row.id,
    ownerId: row.owner_id,
    sourcePath: row.source_path,
    workspacePath: row.workspace_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listRemoteWorkspaces(userId: string): RemoteWorkspace[] {
  return (
    getDb()
      .prepare(
        `SELECT id, owner_id, source_path, workspace_path, created_at, updated_at
         FROM remote_workspaces
         WHERE owner_id = ?
         ORDER BY created_at ASC`
      )
      .all(userId) as any[]
  ).map(rowToWorkspace);
}

export function listRemoteWorkspacePaths(userId: string): string[] {
  return listRemoteWorkspaces(userId)
    .map((workspace) => workspace.workspacePath)
    .filter((workspacePath) => {
      try {
        return fs.statSync(workspacePath).isDirectory();
      } catch {
        return false;
      }
    });
}

function realDirectory(target: string): string {
  const real = fs.realpathSync.native(path.resolve(target));
  if (!fs.statSync(real).isDirectory()) {
    throw new Error("remote_workspace_not_a_directory");
  }
  return real;
}

function existingWorkspacePath(userId: string, requestedPath: string): string | null {
  let requestedReal: string;
  try {
    requestedReal = realDirectory(requestedPath);
  } catch {
    return null;
  }
  for (const workspace of listRemoteWorkspaces(userId)) {
    let workspaceReal: string;
    try {
      workspaceReal = realDirectory(workspace.workspacePath);
    } catch {
      continue;
    }
    if (isPathWithinRoots(requestedReal, [workspaceReal])) return requestedReal;
  }
  return null;
}

function authorizedSource(
  requestedPath: string,
  sourceRoots: string[]
): { requestedReal: string; allowedRoot: string } {
  const requestedReal = realDirectory(requestedPath);
  const canonicalRoots = sourceRoots
    .map((root) => {
      try {
        return realDirectory(root);
      } catch {
        return null;
      }
    })
    .filter((root): root is string => Boolean(root))
    .sort((a, b) => b.length - a.length);
  const allowedRoot = canonicalRoots.find((root) =>
    isPathWithinRoots(requestedReal, [root])
  );
  if (!allowedRoot) throw new Error("forbidden_path: cwd");
  return { requestedReal, allowedRoot };
}

function findGitRoot(start: string, allowedRoot: string): string {
  let cursor = start;
  while (isPathWithinRoots(cursor, [allowedRoot])) {
    if (fs.existsSync(path.join(cursor, ".git"))) return cursor;
    if (cursor === allowedRoot) break;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new Error("remote_workspace_requires_git_repository");
}

function safeWorkspaceName(sourcePath: string): string {
  const base =
    path.basename(sourcePath)
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "repository";
  const digest = createHash("sha256").update(sourcePath).digest("hex").slice(0, 12);
  return `${base}-${digest}`;
}

function runGit(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-8_000);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `remote_workspace_clone_failed${
              stderr.trim() ? `: ${stderr.trim()}` : ""
            }`
          )
        );
      }
    });
  });
}

async function cloneWorkspace(
  userId: string,
  sourcePath: string,
  workspacePath: string
): Promise<void> {
  const ownerDir = path.join(getDataDir(), "remote-workspaces", userId);
  fs.mkdirSync(ownerDir, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(
    ownerDir,
    `.${path.basename(workspacePath)}.tmp-${randomUUID()}`
  );
  try {
    await runGit(["clone", "--no-hardlinks", "--", sourcePath, temporaryPath]);
    await runGit([
      "-C",
      temporaryPath,
      "remote",
      "set-url",
      "--push",
      "origin",
      "disabled://freebuddy-managed-workspace"
    ]);
    fs.renameSync(temporaryPath, workspacePath);
  } catch (error) {
    fs.rmSync(temporaryPath, { recursive: true, force: true });
    throw error;
  }
}

async function materialize(
  userId: string,
  requestedPath: string,
  sourceRoots: string[]
): Promise<string> {
  const alreadyIsolated = existingWorkspacePath(userId, requestedPath);
  if (alreadyIsolated) return alreadyIsolated;

  const { requestedReal, allowedRoot } = authorizedSource(
    requestedPath,
    sourceRoots
  );
  const sourcePath = findGitRoot(requestedReal, allowedRoot);
  const relativePath = path.relative(sourcePath, requestedReal);
  const existing = getDb()
    .prepare(
      `SELECT id, owner_id, source_path, workspace_path, created_at, updated_at
       FROM remote_workspaces
       WHERE owner_id = ? AND source_path = ?`
    )
    .get(userId, sourcePath) as any;
  const workspacePath =
    existing?.workspace_path ??
    path.join(
      getDataDir(),
      "remote-workspaces",
      userId,
      safeWorkspaceName(sourcePath)
    );

  if (!fs.existsSync(workspacePath)) {
    await cloneWorkspace(userId, sourcePath, workspacePath);
  } else if (!fs.statSync(workspacePath).isDirectory()) {
    throw new Error("remote_workspace_path_unavailable");
  }

  const now = new Date().toISOString();
  if (existing) {
    getDb()
      .prepare("UPDATE remote_workspaces SET updated_at = ? WHERE id = ?")
      .run(now, existing.id);
  } else {
    getDb()
      .prepare(
        `INSERT INTO remote_workspaces
           (id, owner_id, source_path, workspace_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), userId, sourcePath, workspacePath, now, now);
  }

  const mapped = path.resolve(workspacePath, relativePath);
  if (!isPathWithinRoots(mapped, [workspacePath]) || !fs.existsSync(mapped)) {
    throw new Error("remote_workspace_subdirectory_unavailable");
  }
  return mapped;
}

/**
 * Return a stable, per-user clone for an assigned repository path.
 * Concurrent requests for the same user/path share one clone operation.
 */
export function ensureRemoteWorkspace(
  userId: string,
  requestedPath: string,
  sourceRoots: string[]
): Promise<string> {
  // Serialize materialization per user. Two simultaneous requests for
  // different subdirectories of the same repository must not race while
  // cloning the same destination.
  const key = userId;
  const previous = materializeLocks.get(key) ?? Promise.resolve();
  const result = previous
    .catch(() => undefined)
    .then(() => materialize(userId, requestedPath, sourceRoots));
  const tail = result.then(
    () => undefined,
    () => undefined
  );
  materializeLocks.set(key, tail);
  void tail.finally(() => {
    if (materializeLocks.get(key) === tail) materializeLocks.delete(key);
  });
  return result;
}

export function removeRemoteWorkspacesForUser(userId: string): number {
  const workspaces = listRemoteWorkspaces(userId);
  const managedRoot = path.join(getDataDir(), "remote-workspaces", userId);
  for (const workspace of workspaces) {
    if (isPathWithinRoots(workspace.workspacePath, [managedRoot])) {
      fs.rmSync(workspace.workspacePath, { recursive: true, force: true });
    }
  }
  getDb().prepare("DELETE FROM remote_workspaces WHERE owner_id = ?").run(userId);
  return workspaces.length;
}
