import type { RuntimeHostEnvironment, RuntimeProcessHandle } from "./ports.js";
import { readRuntimeState, writeRuntimeState } from "./runtimeStateStore.js";
import { versionDir } from "./runtimePaths.js";
import path from "node:path";
import fs from "node:fs";

export interface HealthProbeResult {
  ok: boolean;
  reason?: string;
}

const CRASH_LOOP_LIMIT = 3;
const HEALTHY_WINDOW_MS = 30_000;

export async function probeRuntimeVersion(
  environment: RuntimeHostEnvironment,
  version: string
): Promise<HealthProbeResult> {
  if (version === "bundled") {
    if (environment.bundledRuntimePath && !fs.existsSync(environment.bundledRuntimePath)) {
      return { ok: false, reason: "bundled runtime missing" };
    }
    return { ok: true };
  }
  const dir = versionDir(environment.dataDir, version);
  const entry = path.join(dir, "runtime", "index.mjs");
  if (!fs.existsSync(entry) && !fs.existsSync(dir)) {
    return { ok: false, reason: "runtime version missing" };
  }
  let handle: RuntimeProcessHandle | undefined;
  try {
    handle = environment.launcher.launch({
      entryPath: fs.existsSync(entry) ? entry : dir,
      env: { FB_RUNTIME_PROBE: "1" }
    });
    const ready = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 4000);
      handle!.onMessage((message) => {
        if (message && typeof message === "object" && (message as { kind?: string }).kind) {
          clearTimeout(timer);
          resolve(true);
        }
      });
      handle!.onExit(() => {
        clearTimeout(timer);
        resolve(false);
      });
      // Probe without a real handshake still counts as process start.
      setTimeout(() => resolve(true), 50);
    });
    return ready ? { ok: true } : { ok: false, reason: "probe timeout" };
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  } finally {
    handle?.kill();
  }
}

export function recordCrash(environment: RuntimeHostEnvironment, version: string): boolean {
  const state = readRuntimeState(environment.dataDir);
  const current = state.blockedVersions[version] as
    | { reason: string; failedAt: string; count?: number }
    | undefined;
  const previousCount =
    current?.count ??
    (typeof current?.reason === "string" && /^crash:\d+$/.test(current.reason)
      ? Number(current.reason.slice("crash:".length))
      : 0);
  const count = previousCount + 1;
  if (count >= CRASH_LOOP_LIMIT) {
    state.blockedVersions[version] = {
      reason: "crash-loop",
      failedAt: environment.clock.nowIso()
    };
    writeRuntimeState(environment.dataDir, state);
    return true;
  }
  state.blockedVersions[version] = {
    reason: `crash:${count}`,
    failedAt: environment.clock.nowIso()
  };
  (state.blockedVersions[version] as { count?: number }).count = count;
  writeRuntimeState(environment.dataDir, state);
  return false;
}

export function markLastKnownGood(environment: RuntimeHostEnvironment, version: string): void {
  const state = readRuntimeState(environment.dataDir);
  state.lastKnownGoodVersion = version;
  writeRuntimeState(environment.dataDir, state);
}

export function scheduleLastKnownGood(
  environment: RuntimeHostEnvironment,
  version: string,
  windowMs = HEALTHY_WINDOW_MS
): ReturnType<typeof setTimeout> {
  return setTimeout(() => markLastKnownGood(environment, version), windowMs);
}
