import type { RuntimeHostEnvironment, RuntimeProcessHandle } from "./ports.js";
import type { RuntimeMessageTransport } from "./rpc/transport.js";
import { readRuntimeState, writeRuntimeState } from "./runtimeStateStore.js";
import { resolveRuntimeEntryPath } from "./runtimeEntryPath.js";
import { RuntimeRpcSession } from "./rpc/session.js";
import { sanitizedRuntimeProcessEnv } from "./runtimeProcessEnv.js";
import {
  DEFAULT_HOST_CAPABILITIES,
  HOST_API_VERSION,
  RUNTIME_BUNDLE_ID,
  RUNTIME_RPC_VERSION
} from "@freebuddy/protocol/runtime";

export interface HealthProbeResult {
  ok: boolean;
  reason?: string;
}

export const CRASH_LOOP_LIMIT = 3;
const HEALTHY_WINDOW_MS = 30_000;

function transportFromHandle(handle: RuntimeProcessHandle): RuntimeMessageTransport {
  return {
    send(message) {
      handle.send(message);
    },
    onMessage(handler) {
      return handle.onMessage(handler);
    }
  };
}

function helloPayload(environment: RuntimeHostEnvironment) {
  return {
    hostId: environment.hostId,
    hostVersion: environment.hostVersion,
    hostApiVersion: environment.hostApiVersion || HOST_API_VERSION,
    hostCapabilities:
      environment.hostCapabilities.length > 0
        ? [...environment.hostCapabilities]
        : [...DEFAULT_HOST_CAPABILITIES],
    rpcVersion: RUNTIME_RPC_VERSION,
    allowUnsignedDevelopmentRuntime: environment.allowUnsignedDevelopmentRuntime
  };
}

export async function probeRuntimeVersion(
  environment: RuntimeHostEnvironment,
  version: string
): Promise<HealthProbeResult> {
  const entry = resolveRuntimeEntryPath(environment, version);
  if (!entry) {
    return { ok: false, reason: version === "bundled" ? "bundled runtime missing" : "runtime version missing" };
  }
  let handle: RuntimeProcessHandle | undefined;
  let session: RuntimeRpcSession | undefined;
  try {
    handle = environment.launcher.launch({
      entryPath: entry,
      env: { ...sanitizedRuntimeProcessEnv(version), FB_RUNTIME_PROBE: "1" }
    });
    session = new RuntimeRpcSession({
      transport: transportFromHandle(handle),
      timeoutMs: Number(process.env.FB_RUNTIME_PROBE_TIMEOUT_MS ?? 8_000),
      handlers: {
        async "host.invoke"() {
          return null;
        }
      }
    });
    const hello = (await session.request("runtime.hello", helloPayload(environment), {
      timeoutMs: Number(process.env.FB_RUNTIME_PROBE_TIMEOUT_MS ?? 8_000)
    })) as { rpcVersion?: number; bundleId?: string; requiredHostCapabilities?: string[] };
    if (hello?.rpcVersion !== RUNTIME_RPC_VERSION) {
      return { ok: false, reason: "probe handshake rpc mismatch" };
    }
    if (hello.bundleId && hello.bundleId !== RUNTIME_BUNDLE_ID) {
      return { ok: false, reason: "probe bundle id mismatch" };
    }
    const health = (await session.request("runtime.health", {}, { timeoutMs: 4_000 })) as {
      ok?: boolean;
    };
    if (!health?.ok) return { ok: false, reason: "health failed" };
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  } finally {
    session?.close();
    handle?.kill();
  }
}

export function isVersionBlocked(
  blocked: Record<string, { reason: string; failedAt: string }>,
  version: string
): boolean {
  if (version === "bundled") return false;
  const entry = blocked[version];
  if (!entry) return false;
  return entry.reason === "crash-loop" || entry.reason === "rollback";
}

export function recordCrash(
  environment: RuntimeHostEnvironment,
  version: string
): boolean {
  const state = readRuntimeState(environment.dataDir);
  const counts = { ...(state.crashCounts ?? {}) };
  const count = (counts[version] ?? 0) + 1;
  counts[version] = count;
  state.crashCounts = counts;

  let blocked = false;
  if (version !== "bundled" && count >= CRASH_LOOP_LIMIT) {
    state.blockedVersions[version] = {
      reason: "crash-loop",
      failedAt: environment.clock.nowIso()
    };
    blocked = true;
  }

  if (state.activeVersion === version) {
    const fallback =
      state.lastKnownGoodVersion && state.lastKnownGoodVersion !== version
        ? state.lastKnownGoodVersion
        : "bundled";
    if (fallback !== version) {
      state.activeVersion = fallback;
    }
  }

  writeRuntimeState(environment.dataDir, state);
  return blocked;
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
