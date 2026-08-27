import type { RuntimeEntryTransport } from "./framing.js";

interface ParentPortLike {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): void;
  off?(event: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener?(event: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener?(event: "message", listener: (event: { data: unknown }) => void): void;
}

export function createParentPortTransport(parentPort: ParentPortLike): RuntimeEntryTransport {
  return {
    send(message) {
      parentPort.postMessage(message);
    },
    onMessage(handler) {
      const listener = (event: { data: unknown }) => handler(event.data);
      if (typeof parentPort.on === "function") {
        parentPort.on("message", listener);
        return () => parentPort.off?.("message", listener);
      }
      parentPort.addEventListener?.("message", listener);
      return () => parentPort.removeEventListener?.("message", listener);
    }
  };
}

export function createNodeProcessTransport(proc: NodeJS.Process): RuntimeEntryTransport {
  return {
    send(message) {
      proc.send?.(message as never);
    },
    onMessage(handler) {
      const listener = (message: unknown) => handler(message);
      proc.on("message", listener);
      return () => {
        proc.off("message", listener);
      };
    }
  };
}

export function resolveRuntimeProcessTransport(): RuntimeEntryTransport {
  const parentPort = (process as NodeJS.Process & { parentPort?: ParentPortLike }).parentPort;
  if (parentPort) return createParentPortTransport(parentPort);
  if (typeof process.send === "function") return createNodeProcessTransport(process);
  throw new Error("runtime process has no IPC transport");
}
