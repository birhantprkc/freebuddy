import type { RuntimeHostApi, RuntimeHostEnvironment, RuntimeManager } from "./ports.js";
import { readRuntimeState, writeRuntimeState } from "./runtimeStateStore.js";
import { versionDir } from "./runtimePaths.js";

export function createRuntimeManager(
  environment: RuntimeHostEnvironment,
  _hostApi: RuntimeHostApi
): RuntimeManager {
  return {
    async status() {
      const state = readRuntimeState(environment.dataDir);
      return {
        hostId: environment.hostId,
        hostVersion: environment.hostVersion,
        hostApiVersion: environment.hostApiVersion,
        bundledRuntimePath: environment.bundledRuntimePath ?? null,
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
      if (state.blockedVersions[version]) {
        throw new Error(`runtime ${version} is blocked`);
      }
      if (version !== "bundled" && environment.bundledRuntimePath !== version) {
        const dir = versionDir(environment.dataDir, version);
        if (!dir) throw new Error("runtime version missing");
      }
      state.activeVersion = version;
      state.pendingVersion = null;
      writeRuntimeState(environment.dataDir, state);
    },
    async rollback() {
      const state = readRuntimeState(environment.dataDir);
      const fallback = state.lastKnownGoodVersion ?? "bundled";
      if (state.activeVersion) {
        state.blockedVersions[state.activeVersion] = {
          reason: "rollback",
          failedAt: environment.clock.nowIso()
        };
      }
      state.activeVersion = fallback;
      writeRuntimeState(environment.dataDir, state);
    },
    async shutdown() {
      // Process cleanup is owned by the launcher adapter.
    }
  };
}
