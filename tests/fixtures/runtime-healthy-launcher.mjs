import fs from "node:fs";
import path from "node:path";
import { makeFrame } from "../../packages/runtime-host/dist/rpc/transport.js";

export function writeDummyRuntimeEntry(dir) {
  fs.mkdirSync(path.join(dir, "runtime"), { recursive: true });
  fs.writeFileSync(path.join(dir, "runtime", "index.mjs"), "export {}\n");
}

export function createHealthyRuntimeLauncher() {
  const kills = { count: 0 };
  return {
    kills,
    launch() {
      const listeners = [];
      return {
        send(message) {
          if (!message || typeof message !== "object") return;
          const frame = message;
          if (frame.kind !== "request") return;
          queueMicrotask(() => {
            let result;
            if (frame.method === "runtime.hello") {
              result = {
                runtimeVersion: "bundled",
                rpcVersion: 1,
                nodeVersion: process.versions.node,
                bundleId: "dev.freebuddy.runtime",
                hostApiRange: "1.0.0",
                requiredHostCapabilities: [],
                providedCapabilities: ["workflow", "delegation"]
              };
            } else if (frame.method === "runtime.health") {
              result = { ok: true, runtimeVersion: "bundled", uptimeMs: 1, activeRuns: 0 };
            } else {
              result = { ok: true };
            }
            for (const listener of listeners) {
              listener(makeFrame({ id: frame.id, kind: "response", result }));
            }
          });
        },
        onMessage(handler) {
          listeners.push(handler);
          return () => {
            const index = listeners.indexOf(handler);
            if (index >= 0) listeners.splice(index, 1);
          };
        },
        onExit() {
          return () => {};
        },
        kill() {
          kills.count += 1;
        }
      };
    }
  };
}
