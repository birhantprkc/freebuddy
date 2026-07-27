import path from "node:path";
import { isPathWithinRoots } from "./workspaceRoots.js";

export function normalizeWorkspaceRoot(raw: string): string | null {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;
  try {
    return path.resolve(trimmed);
  } catch {
    return null;
  }
}

export function resolveWithinRoots(
  inputPath: string,
  roots: string[],
  primary: string
): { ok: true; absolute: string } | { ok: false; error: string } {
  const normalizedRoots = roots
    .map((r) => normalizeWorkspaceRoot(r))
    .filter((r): r is string => Boolean(r));
  const primaryAbs = normalizeWorkspaceRoot(primary) || normalizedRoots[0];
  if (!primaryAbs || normalizedRoots.length === 0) {
    return { ok: false, error: "No workspace roots configured." };
  }
  const raw = (inputPath || "").trim();
  if (!raw) return { ok: false, error: "Path is required." };

  const absolute = path.isAbsolute(raw)
    ? path.resolve(raw)
    : path.resolve(primaryAbs, raw);

  if (!isPathWithinRoots(absolute, normalizedRoots)) {
    return { ok: false, error: "Path is outside project workspace roots." };
  }
  return { ok: true, absolute };
}

export function assertWithinRoots(absolutePath: string, roots: string[]): boolean {
  const normalizedRoots = roots
    .map((r) => normalizeWorkspaceRoot(r))
    .filter((r): r is string => Boolean(r));
  return isPathWithinRoots(path.resolve(absolutePath), normalizedRoots);
}
