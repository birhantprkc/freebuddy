import { fork, type ChildProcess } from "node:child_process";
import type {
  RuntimeProcessHandle,
  RuntimeProcessLauncher
} from "../ports.js";

export function createNodeRuntimeProcessLauncher(): RuntimeProcessLauncher {
  return {
    launch(input) {
      const child: ChildProcess = fork(input.entryPath, [], {
        cwd: input.cwd,
        env: input.env,
        stdio: ["pipe", "pipe", "pipe", "ipc"]
      });
      const handle: RuntimeProcessHandle = {
        pid: child.pid,
        send(message) {
          child.send?.(message as import("node:child_process").Serializable);
        },
        onMessage(handler) {
          const listener = (message: unknown) => handler(message);
          child.on("message", listener);
          return () => child.off("message", listener);
        },
        onExit(handler) {
          const listener = (code: number | null) => handler(code);
          child.on("exit", listener);
          return () => child.off("exit", listener);
        },
        kill() {
          child.kill();
        }
      };
      return handle;
    }
  };
}
