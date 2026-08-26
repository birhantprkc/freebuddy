import { app } from "electron";
import { registerHandler } from "../invokeRegistry.js";
import {
  createRuntimeManager,
  type RuntimeHostEnvironment
} from "@freebuddy/runtime-host";
import { createElectronRuntimeProcessLauncher } from "./electronRuntimeProcessLauncher.js";

let manager: ReturnType<typeof createRuntimeManager> | null = null;

function environment(): RuntimeHostEnvironment {
  return {
    hostId: "freebuddy-desktop",
    hostVersion: app.getVersion(),
    hostApiVersion: "1.0.0",
    hostCapabilities: [
      "agent.execute.v1",
      "workflow.repository.v1",
      "delegation.repository.v1",
      "events.publish.v1"
    ],
    dataDir: app.getPath("userData"),
    bundledRuntimePath: process.env.FB_BUNDLED_RUNTIME,
    allowUnsignedDevelopmentRuntime: !app.isPackaged,
    launcher: createElectronRuntimeProcessLauncher(),
    http: { fetch: (url, init) => fetch(url, init) },
    trustedKeys: {
      get: () => undefined,
      list: () => []
    },
    clock: {
      now: () => new Date(),
      nowIso: () => new Date().toISOString()
    }
  };
}

export function getRuntimeManager() {
  if (!manager) {
    manager = createRuntimeManager(environment(), {
      async invoke() {
        return null;
      }
    });
  }
  return manager;
}

export function registerRuntimeIpc() {
  registerHandler("runtime:status", () => getRuntimeManager().status());
  registerHandler("runtime:prepare", (_e, version?: string) =>
    getRuntimeManager().prepare(version)
  );
  registerHandler("runtime:activate", (_e, version: string) =>
    getRuntimeManager().activate(version)
  );
  registerHandler("runtime:rollback", () => getRuntimeManager().rollback());
}
