import {
  RUNTIME_RPC_VERSION,
  type RuntimeRpcError,
  type RuntimeRpcFrame
} from "@freebuddy/protocol/runtime";

export interface RuntimeEntryTransport {
  send(message: unknown): void;
  onMessage(handler: (message: unknown) => void): () => void;
}

const KINDS = new Set(["request", "response", "event", "error"]);

export function isRuntimeRpcFrame(value: unknown): value is RuntimeRpcFrame {
  if (!value || typeof value !== "object") return false;
  const frame = value as Record<string, unknown>;
  if (frame.rpcVersion !== RUNTIME_RPC_VERSION) return false;
  if (typeof frame.id !== "string" || frame.id.length === 0) return false;
  if (typeof frame.kind !== "string" || !KINDS.has(frame.kind)) return false;
  return true;
}

export function rpcError(code: string, message: string, retryable = false): RuntimeRpcError {
  return { code, message, retryable };
}

export function makeFrame(partial: Omit<RuntimeRpcFrame, "rpcVersion">): RuntimeRpcFrame {
  return { rpcVersion: RUNTIME_RPC_VERSION, ...partial };
}
