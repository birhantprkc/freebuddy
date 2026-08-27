import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { ensureRuntimeRoot, lockPath, statePath } from "./runtimePaths.js";

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

type InstallLockStore = { root: string; signal: AbortSignal };

const installLockContext = new AsyncLocalStorage<InstallLockStore>();
const STEAL_MUTEX_STALE_MS = 5_000;
const OWNERSHIP_WATCH_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isErrno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code;
}

function readLockToken(file: string): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { token?: string };
    return typeof parsed.token === "string" ? parsed.token : null;
  } catch {
    return null;
  }
}

function lockAgeMs(file: string): number | null {
  try {
    return Date.now() - fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

function discardPath(file: string): void {
  const discarded = `${file}.${randomUUID()}`;
  try {
    fs.renameSync(file, discarded);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return;
    throw error;
  }
  try {
    fs.rmSync(discarded, { force: true });
  } catch {
    /* leftover discarded file is harmless */
  }
}

function tryStealStaleLock(lock: string, staleMs: number): void {
  const steal = `${lock}.steal`;
  let stealFd: number | undefined;
  try {
    stealFd = fs.openSync(steal, "wx");
  } catch (error) {
    if (!isErrno(error, "EEXIST")) throw error;
    const stealAge = lockAgeMs(steal);
    if (stealAge !== null && stealAge > STEAL_MUTEX_STALE_MS) {
      try {
        discardPath(steal);
      } catch {
        /* another recoverer won the rename */
      }
    }
    return;
  }
  try {
    const age = lockAgeMs(lock);
    if (age === null || age <= staleMs) return;
    discardPath(lock);
  } finally {
    try {
      fs.closeSync(stealFd);
    } catch {
      /* already closed */
    }
    try {
      fs.rmSync(steal, { force: true });
    } catch {
      /* steal mutex already recovered or released */
    }
  }
}

export async function withInstallLock<T>(
  dataDir: string,
  fn: (signal: AbortSignal) => Promise<T> | T,
  options?: { timeoutMs?: number; staleMs?: number; heartbeatMs?: number }
): Promise<T> {
  ensureRuntimeRoot(dataDir);
  const root = path.dirname(statePath(dataDir));
  const existing = installLockContext.getStore();
  if (existing?.root === root) return await fn(existing.signal);

  const lock = lockPath(dataDir);
  const staleMs = options?.staleMs ?? 15 * 60 * 1000;
  const timeoutMs = options?.timeoutMs ?? 60_000;
  const heartbeatMs = options?.heartbeatMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;
  let fd: number | undefined;
  const token = randomUUID();

  const stillOwns = (): boolean => {
    if (fd === undefined) return false;
    try {
      if (fs.fstatSync(fd).ino !== fs.statSync(lock).ino) return false;
      return readLockToken(lock) === token;
    } catch {
      return false;
    }
  };

  const writePayload = (): void => {
    if (fd === undefined) return;
    const body = Buffer.from(
      `${JSON.stringify({ token, pid: process.pid, heartbeatAt: Date.now() })}\n`
    );
    fs.ftruncateSync(fd, 0);
    fs.writeSync(fd, body, 0, body.length, 0);
  };

  while (fd === undefined) {
    try {
      fd = fs.openSync(lock, "wx");
      writePayload();
      if (stillOwns()) break;
      try {
        fs.closeSync(fd);
      } catch {
        /* replaced before we could close */
      }
      fd = undefined;
    } catch (error) {
      if (!isErrno(error, "EEXIST")) throw error;
      const age = lockAgeMs(lock);
      if (age !== null && age > staleMs) tryStealStaleLock(lock, staleMs);
    }
    if (Date.now() >= deadline) throw new Error("runtime install lock timeout");
    await sleep(25);
  }

  const lost = new AbortController();
  const markLost = (): void => {
    if (!stillOwns() && !lost.signal.aborted) lost.abort();
  };

  return installLockContext.run({ root, signal: lost.signal }, async () => {
    const heartbeat =
      heartbeatMs > 0
        ? setInterval(() => {
            try {
              markLost();
              if (!stillOwns()) return;
              writePayload();
              fs.utimesSync(lock, new Date(), new Date());
            } catch {
              /* lock stolen or already released */
            }
          }, heartbeatMs)
        : undefined;
    const watch = setInterval(markLost, OWNERSHIP_WATCH_MS);
    heartbeat?.unref?.();
    watch.unref?.();
    try {
      if (!stillOwns()) throw new Error("runtime install lock lost");
      const result = await fn(lost.signal);
      if (lost.signal.aborted || !stillOwns()) throw new Error("runtime install lock lost");
      return result;
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      clearInterval(watch);
      try {
        if (stillOwns()) fs.rmSync(lock, { force: true });
      } finally {
        if (fd !== undefined) fs.closeSync(fd);
      }
    }
  });
}
