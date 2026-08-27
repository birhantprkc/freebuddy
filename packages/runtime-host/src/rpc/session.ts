import { randomUUID } from "node:crypto";
import { BoundedIdempotencyCache } from "@freebuddy/protocol";
import type { RuntimeRpcFrame } from "@freebuddy/protocol/runtime";
import {
  isRuntimeRpcFrame,
  makeFrame,
  rpcError,
  type RuntimeMessageTransport
} from "./transport.js";

export type RpcHandler = (
  params: unknown,
  meta: { id: string; idempotencyKey?: string; attempt?: number }
) => Promise<unknown> | unknown;

export interface RuntimeRpcSessionOptions {
  transport: RuntimeMessageTransport;
  handlers?: Record<string, RpcHandler>;
  timeoutMs?: number;
  onEvent?: (event: string, payload: unknown) => void;
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
};

export class RuntimeRpcSession {
  private pending = new Map<string, Pending>();
  private idempotent = new BoundedIdempotencyCache();
  private unsubscribe: () => void;
  private closed = false;
  private readonly timeoutMs: number;

  constructor(private readonly opts: RuntimeRpcSessionOptions) {
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.unsubscribe = opts.transport.onMessage((message) => {
      void this.onMessage(message);
    });
  }

  async request(
    method: string,
    params?: unknown,
    options?: { timeoutMs?: number; idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<unknown> {
    if (this.closed) throw new Error("rpc session closed");
    if (options?.idempotencyKey) {
      const cached = this.idempotent.get(options.idempotencyKey);
      if (cached.found) return cached.value;
    }
    const id = randomUUID();
    const frame = makeFrame({
      id,
      kind: "request",
      method,
      params,
      idempotencyKey: options?.idempotencyKey,
      attempt: 1
    });
    const timeoutMs = options?.timeoutMs ?? this.timeoutMs;
    const result = await new Promise<unknown>((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`rpc timeout: ${method}`));
            }, timeoutMs)
          : undefined;
      const onAbort = () => {
        this.pending.delete(id);
        if (timer) clearTimeout(timer);
        this.opts.transport.send(
          makeFrame({ id, kind: "request", method: "runtime.cancel", params: { id } })
        );
        reject(new Error(`rpc cancelled: ${method}`));
      };
      options?.signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, {
        resolve: (value) => {
          options?.signal?.removeEventListener("abort", onAbort);
          resolve(value);
        },
        reject: (error) => {
          options?.signal?.removeEventListener("abort", onAbort);
          reject(error);
        },
        timer
      });
      this.opts.transport.send(frame);
    });
    if (options?.idempotencyKey) this.idempotent.set(options.idempotencyKey, result);
    return result;
  }

  emit(event: string, payload?: unknown): void {
    this.opts.transport.send(
      makeFrame({ id: randomUUID(), kind: "event", event, payload })
    );
  }

  close(): void {
    this.closed = true;
    this.unsubscribe();
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error("rpc session closed"));
    }
    this.pending.clear();
  }

  private async onMessage(message: unknown): Promise<void> {
    if (!isRuntimeRpcFrame(message)) return;
    if (message.kind === "event") {
      this.opts.onEvent?.(message.event ?? "", message.payload);
      return;
    }
    if (message.kind === "response" || message.kind === "error") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      if (pending.timer) clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.kind === "error") {
        pending.reject(new Error(message.error?.message ?? "rpc error"));
        return;
      }
      pending.resolve(message.result);
      return;
    }
    if (message.kind !== "request" || !message.method) return;
    const handler = this.opts.handlers?.[message.method];
    if (!handler) {
      this.opts.transport.send(
        makeFrame({
          id: message.id,
          kind: "error",
          error: rpcError("unknown_method", `unknown method: ${message.method}`)
        })
      );
      return;
    }
    try {
      if (message.idempotencyKey) {
        const cached = this.idempotent.get(message.idempotencyKey);
        if (cached.found) {
          this.opts.transport.send(
            makeFrame({
              id: message.id,
              kind: "response",
              result: cached.value
            })
          );
          return;
        }
      }
      const result = await handler(message.params, {
        id: message.id,
        idempotencyKey: message.idempotencyKey,
        attempt: message.attempt
      });
      if (message.idempotencyKey) this.idempotent.set(message.idempotencyKey, result);
      this.opts.transport.send(makeFrame({ id: message.id, kind: "response", result }));
    } catch (error) {
      this.opts.transport.send(
        makeFrame({
          id: message.id,
          kind: "error",
          error: rpcError("handler_failed", (error as Error).message, true)
        })
      );
    }
  }
}

export function createLoopbackPair(): {
  host: RuntimeMessageTransport;
  runtime: RuntimeMessageTransport;
} {
  const hostHandlers: Array<(message: unknown) => void> = [];
  const runtimeHandlers: Array<(message: unknown) => void> = [];
  const host: RuntimeMessageTransport = {
    send(message) {
      queueMicrotask(() => {
        for (const handler of runtimeHandlers) handler(message);
      });
    },
    onMessage(handler) {
      hostHandlers.push(handler);
      return () => {
        const idx = hostHandlers.indexOf(handler);
        if (idx >= 0) hostHandlers.splice(idx, 1);
      };
    }
  };
  const runtime: RuntimeMessageTransport = {
    send(message) {
      queueMicrotask(() => {
        for (const handler of hostHandlers) handler(message);
      });
    },
    onMessage(handler) {
      runtimeHandlers.push(handler);
      return () => {
        const idx = runtimeHandlers.indexOf(handler);
        if (idx >= 0) runtimeHandlers.splice(idx, 1);
      };
    }
  };
  return { host, runtime };
}

export type { RuntimeRpcFrame };
