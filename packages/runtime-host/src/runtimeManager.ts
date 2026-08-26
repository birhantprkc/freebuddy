import type { RuntimeHostApi, RuntimeHostEnvironment, RuntimeManager } from "./ports.js";
import { readRuntimeState, writeRuntimeState } from "./runtimeStateStore.js";
import { versionDir } from "./runtimePaths.js";
import { probeRuntimeVersion, recordCrash, isVersionBlocked, scheduleLastKnownGood } from "./runtimeHealthMonitor.js";
import { checkRuntimeUpdate, downloadAndPrepareRuntime } from "./runtimeUpdateService.js";
import { createRuntimeVersionRouter } from "./runtimeVersionRouter.js";
import { createRuntimeProcessPool } from "./runtimeProcessPool.js";
import fs from "node:fs";

export function createRuntimeManager(
  environment: RuntimeHostEnvironment,
  hostApi: RuntimeHostApi
): RuntimeManager {
  const router = createRuntimeVersionRouter(
    () => readRuntimeState(environment.dataDir).activeVersion ?? "bundled"
  );
  const pool = createRuntimeProcessPool({ environment, hostApi });
  let lastError: string | null = null;

  return {
    async status() {
      const state = readRuntimeState(environment.dataDir);
      return {
        hostId: environment.hostId,
        hostVersion: environment.hostVersion,
        hostApiVersion: environment.hostApiVersion,
        bundledRuntimePath: environment.bundledRuntimePath ?? null,
        lastError,
        ...state
      };
    },
    async prepare(version = "bundled") {
      const state = readRuntimeState(environment.dataDir);
      state.pendingVersion = version;
      writeRuntimeState(environment.dataDir, state);
    },
    async activate(version: string) {
      const state = readRuntimeState(environment.dataDir);
      if (isVersionBlocked(state.blockedVersions, version)) {
        throw new Error(`runtime ${version} is blocked`);
      }
      if (version !== "bundled") {
        const dir = versionDir(environment.dataDir, version);
        if (!fs.existsSync(dir) && environment.bundledRuntimePath !== version) {
          throw new Error("runtime version missing");
        }
      }
      const probe = await probeRuntimeVersion(environment, version);
      if (!probe.ok) {
        lastError = probe.reason ?? "probe failed";
        recordCrash(environment, version);
        throw new Error(lastError);
      }
      const next = readRuntimeState(environment.dataDir);
      next.activeVersion = version;
      next.pendingVersion = null;
      if (version !== "bundled") next.crashCounts = { ...(next.crashCounts ?? {}), [version]: 0 };
      writeRuntimeState(environment.dataDir, next);
      scheduleLastKnownGood(environment, version);
      lastError = null;
    },
    async rollback() {
      const state = readRuntimeState(environment.dataDir);
      const previous = state.activeVersion;
      const fallback =
        state.lastKnownGoodVersion && state.lastKnownGoodVersion !== previous
          ? state.lastKnownGoodVersion
          : "bundled";
      if (previous && previous !== "bundled") {
        state.blockedVersions[previous] = {
          reason: "rollback",
          failedAt: environment.clock.nowIso()
        };
      }
      state.activeVersion = fallback;
      writeRuntimeState(environment.dataDir, state);
    },
    async shutdown() {
      await pool.shutdown();
      router.shutdown();
    },
    route(input) {
      return router.route(input);
    },
    async ensureProcess(version, entryPath) {
      const client = await pool.ensure(version, entryPath);
      router.attach(version, client.handle);
      router.retain(version);
    },
    async request(version, method, params, options) {
      await this.ensureProcess(version);
      return pool.request(version, method, params, options);
    },
    async check() {
      const result = await checkRuntimeUpdate(environment, {
        baseUrl: environment.update?.baseUrl,
        enabled: environment.update?.enabled ?? false,
        channel: readRuntimeState(environment.dataDir).channel
      });
      if (!result.available) return { available: false, reason: result.reason };
      const prepared = await downloadAndPrepareRuntime(environment, result.descriptor);
      if (!prepared.ok) {
        lastError = prepared.error;
        return { available: false, reason: prepared.error };
      }
      return { available: true, version: result.descriptor.version };
    },
    async setChannel(channel) {
      const state = readRuntimeState(environment.dataDir);
      state.channel = channel;
      writeRuntimeState(environment.dataDir, state);
    }
  };
}
