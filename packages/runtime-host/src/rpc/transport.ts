import {
  RUNTIME_RPC_VERSION,
  type RuntimeRpcError,
  type RuntimeRpcFrame
} from "@freebuddy/protocol/runtime";

export interface RuntimeMessageTransport {
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

export function redactSecrets(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/(authorization|token|secret|password|key)=([^&\s]+)/gi, "$1=<redacted>");
  }
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = /token|secret|password|authorization|key/i.test(key)
        ? "<redacted>"
        : redactSecrets(entry);
    }
    return out;
  }
  return value;
}

export function rpcError(code: string, message: string, retryable = false): RuntimeRpcError {
  return { code, message, retryable };
}

export function makeFrame(partial: Omit<RuntimeRpcFrame, "rpcVersion">): RuntimeRpcFrame {
  return { rpcVersion: RUNTIME_RPC_VERSION, ...partial };
}
