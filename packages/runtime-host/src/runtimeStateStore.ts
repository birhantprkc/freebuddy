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

const installLockContext = new AsyncLocalStorage<string>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readLockToken(file: string): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { token?: string };
    return typeof parsed.token === "string" ? parsed.token : null;
  } catch {
    return null;
  }
}

export async function withInstallLock<T>(
  dataDir: string,
  fn: () => Promise<T> | T,
  options?: { timeoutMs?: number; staleMs?: number; heartbeatMs?: number }
): Promise<T> {
  ensureRuntimeRoot(dataDir);
  const root = path.dirname(statePath(dataDir));
  if (installLockContext.getStore() === root) return await fn();

  const lock = lockPath(dataDir);
  const staleMs = options?.staleMs ?? 15 * 60 * 1000;
  const timeoutMs = options?.timeoutMs ?? 60_000;
  const heartbeatMs = options?.heartbeatMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;
  let fd: number | undefined;
  const token = randomUUID();

  while (fd === undefined) {
    try {
      if (fs.existsSync(lock)) {
        const stat = fs.statSync(lock);
        if (Date.now() - stat.mtimeMs > staleMs) {
          fs.rmSync(lock, { force: true });
        }
      }
      fd = fs.openSync(lock, "wx");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new Error("runtime install lock timeout");
      await sleep(25);
    }
  }

  const stillOwns = (): boolean => {
    try {
      if (fs.fstatSync(fd).ino !== fs.statSync(lock).ino) return false;
      return readLockToken(lock) === token;
    } catch {
      return false;
    }
  };

  const writePayload = (): void => {
    const body = Buffer.from(
      `${JSON.stringify({ token, pid: process.pid, heartbeatAt: Date.now() })}\n`
    );
    fs.ftruncateSync(fd, 0);
    fs.writeSync(fd, body, 0, body.length, 0);
  };

  writePayload();

  return installLockContext.run(root, async () => {
    const heartbeat =
      heartbeatMs > 0
        ? setInterval(() => {
            try {
              if (!stillOwns()) return;
              writePayload();
              fs.utimesSync(lock, new Date(), new Date());
            } catch {
              /* lock stolen or already released */
            }
          }, heartbeatMs)
        : undefined;
    heartbeat?.unref?.();
    try {
      return await fn();
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      try {
        if (stillOwns()) fs.rmSync(lock, { force: true });
      } finally {
        fs.closeSync(fd);
      }
    }
  });
}
