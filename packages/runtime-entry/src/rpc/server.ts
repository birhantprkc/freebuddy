import { randomUUID } from "node:crypto";
import { RUNTIME_RPC_VERSION, type RuntimeRpcFrame } from "@freebuddy/protocol/runtime";
import { createRuntimeRpcHandlers } from "./handlers.js";

export interface RuntimeEntryTransport {
  send(message: unknown): void;
  onMessage(handler: (message: unknown) => void): () => void;
}

function isFrame(value: unknown): value is RuntimeRpcFrame {
  if (!value || typeof value !== "object") return false;
  const frame = value as RuntimeRpcFrame;
  return frame.rpcVersion === RUNTIME_RPC_VERSION && typeof frame.id === "string";
}

export function attachRuntimeRpcServer(
  transport: RuntimeEntryTransport,
  handlers = createRuntimeRpcHandlers()
): () => void {
  const idempotent = new Map<string, unknown>();
  return transport.onMessage((message) => {
    void (async () => {
      if (!isFrame(message) || message.kind !== "request" || !message.method) return;
      const handler = handlers[message.method];
      if (!handler) {
        transport.send({
          rpcVersion: RUNTIME_RPC_VERSION,
          id: message.id,
          kind: "error",
          error: { code: "unknown_method", message: `unknown method: ${message.method}` }
        } satisfies RuntimeRpcFrame);
        return;
      }
      try {
        if (message.idempotencyKey && idempotent.has(message.idempotencyKey)) {
          transport.send({
            rpcVersion: RUNTIME_RPC_VERSION,
            id: message.id,
            kind: "response",
            result: idempotent.get(message.idempotencyKey)
          } satisfies RuntimeRpcFrame);
          return;
        }
        const result = await handler(message.params, { idempotencyKey: message.idempotencyKey ?? "" });
        if (message.idempotencyKey) idempotent.set(message.idempotencyKey, result);
        transport.send({
          rpcVersion: RUNTIME_RPC_VERSION,
          id: message.id,
          kind: "response",
          result
        } satisfies RuntimeRpcFrame);
        if (message.method === "runtime.hello") {
          transport.send({
            rpcVersion: RUNTIME_RPC_VERSION,
            id: randomUUID(),
            kind: "event",
            event: "runtime.ready",
            payload: { runtimeVersion: "1.0.0", pid: process.pid }
          } satisfies RuntimeRpcFrame);
        }
      } catch (error) {
        transport.send({
          rpcVersion: RUNTIME_RPC_VERSION,
          id: message.id,
          kind: "error",
          error: { code: "handler_failed", message: (error as Error).message, retryable: true }
        } satisfies RuntimeRpcFrame);
      }
    })();
  });
}
