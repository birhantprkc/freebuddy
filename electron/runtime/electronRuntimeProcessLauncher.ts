import { utilityProcess } from "electron";
import type { RuntimeProcessLauncher } from "@freebuddy/runtime-host";

export function createElectronRuntimeProcessLauncher(): RuntimeProcessLauncher {
  return {
    launch(input) {
      const child = utilityProcess.fork(input.entryPath, [], {
        serviceName: "freebuddy-runtime",
        stdio: "pipe",
        env: input.env
      });
      return {
        pid: child.pid,
        send(message) {
          child.postMessage(message);
        },
        onMessage(handler) {
          const listener = (event: { data: unknown }) => handler(event.data);
          child.on("message", listener);
          return () => child.off("message", listener);
        },
        onExit(handler) {
          const listener = (code: number) => handler(code);
          child.on("exit", listener);
          return () => child.off("exit", listener);
        },
        kill() {
          child.kill();
        }
      };
    }
  };
}
