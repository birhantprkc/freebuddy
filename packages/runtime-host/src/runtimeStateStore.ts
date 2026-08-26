import fs from "node:fs";
import path from "node:path";
import { ensureRuntimeRoot, statePath } from "./runtimePaths.js";

export interface RuntimeState {
  schemaVersion: 1;
  activeVersion: string | null;
  pendingVersion: string | null;
  lastKnownGoodVersion: string | null;
  channel: "stable" | "beta" | "development";
  lastCheckedAt: string | null;
  blockedVersions: Record<string, { reason: string; failedAt: string }>;
  crashCounts?: Record<string, number>;
}

const EMPTY: RuntimeState = {
  schemaVersion: 1,
  activeVersion: null,
  pendingVersion: null,
  lastKnownGoodVersion: null,
  channel: "stable",
  lastCheckedAt: null,
  blockedVersions: {},
  crashCounts: {}
};

export function readRuntimeState(dataDir: string): RuntimeState {
  ensureRuntimeRoot(dataDir);
  const file = statePath(dataDir);
  if (!fs.existsSync(file)) return { ...EMPTY, blockedVersions: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as RuntimeState;
    if (parsed.schemaVersion !== 1) return { ...EMPTY, blockedVersions: {} };
    return { ...EMPTY, ...parsed, blockedVersions: parsed.blockedVersions ?? {}, crashCounts: parsed.crashCounts ?? {} };
  } catch {
    return { ...EMPTY, blockedVersions: {} };
  }
}

export function writeRuntimeState(dataDir: string, state: RuntimeState): void {
  ensureRuntimeRoot(dataDir);
  const file = statePath(dataDir);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8" });
  const fd = fs.openSync(tmp, "r+");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

export function withInstallLock<T>(dataDir: string, fn: () => T): T {
  ensureRuntimeRoot(dataDir);
  const lock = path.join(path.dirname(statePath(dataDir)), "runtime.lock");
  const staleMs = 5 * 60 * 1000;
  if (fs.existsSync(lock)) {
    const stat = fs.statSync(lock);
    if (Date.now() - stat.mtimeMs > staleMs) fs.rmSync(lock, { force: true });
  }
  const fd = fs.openSync(lock, "wx");
  try {
    fs.writeFileSync(fd, String(process.pid));
    return fn();
  } finally {
    fs.closeSync(fd);
    fs.rmSync(lock, { force: true });
  }
}
