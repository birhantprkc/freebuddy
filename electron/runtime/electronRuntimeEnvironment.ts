import { app } from "electron";
import type { RuntimeHostEnvironment } from "@freebuddy/runtime-host";
import { createElectronRuntimeProcessLauncher } from "./electronRuntimeProcessLauncher.js";
import { bundledRuntimePath } from "./bundledRuntime.js";

export function createElectronRuntimeEnvironment(): RuntimeHostEnvironment {
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
    bundledRuntimePath: bundledRuntimePath(),
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
    },
    update: {
      enabled: false
    }
  };
}
