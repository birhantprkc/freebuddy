import { registerHandler } from "../invokeRegistry.js";
import { createRuntimeManager } from "@freebuddy/runtime-host";
import { createElectronRuntimeEnvironment } from "./electronRuntimeEnvironment.js";

let manager: ReturnType<typeof createRuntimeManager> | null = null;

export function getRuntimeManager() {
  if (!manager) {
    manager = createRuntimeManager(createElectronRuntimeEnvironment(), {
      async invoke() {
        return null;
      }
    });
  }
  return manager;
}

export async function shutdownRuntimeProcesses(): Promise<void> {
  if (!manager) return;
  await manager.shutdown();
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
  registerHandler("runtime:check", () => getRuntimeManager().check());
  registerHandler(
    "runtime:setChannel",
    (_e, channel: "stable" | "beta" | "development") => getRuntimeManager().setChannel(channel)
  );
}
