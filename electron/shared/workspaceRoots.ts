import path from "node:path";
import os from "node:os";

export const WORKSPACE_ROOTS_SETTING_KEY = "remote.workspaceRoots";

/**
 * Normalize a configured workspace root.
 *
 * `~` expands to the account home. On macOS, a bare `/home` entry is treated as
 * the real user home — Apple's `/home` symlink is not the login home directory,
 * and using it as a remote root silently blocks every path under `/Users/...`.
 */
export function normalizeRoot(
  raw: string,
  homedir: string = os.homedir()
): string | null {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;
  try {
    if (trimmed === "~") return path.resolve(homedir);
    if (trimmed.startsWith("~/")) {
      return path.resolve(homedir, trimmed.slice(2));
    }
    if ((trimmed === "/home" || trimmed === "/home/") && process.platform === "darwin") {
      return path.resolve(homedir);
    }
    return path.resolve(trimmed);
  } catch {
    return null;
  }
}

export function resolveWorkspaceRoots(
  rawRoots: unknown,
  homedir: string = os.homedir()
): string[] {
  const arr = Array.isArray(rawRoots) ? rawRoots : [];
  const seen = new Set<string>();
  for (const entry of arr) {
    const normalized =
      typeof entry === "string" ? normalizeRoot(entry, homedir) : null;
    if (normalized && !seen.has(normalized)) seen.add(normalized);
  }
  if (seen.size === 0) {
    const home = normalizeRoot(homedir, homedir);
    if (home) seen.add(home);
  }
  return [...seen];
}

export function isPathWithinRoots(target: string, roots: string[]): boolean {
  const resolved = path.resolve(target);
  for (const root of roots) {
    const r = path.resolve(root);
    if (resolved === r) return true;
    if (resolved.startsWith(r + path.sep)) return true;
  }
  return false;
}

export function parentWithinRoots(target: string, roots: string[]): string | null {
  const parent = path.dirname(path.resolve(target));
  return isPathWithinRoots(parent, roots) ? parent : null;
}
