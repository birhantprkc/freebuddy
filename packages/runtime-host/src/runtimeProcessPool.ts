import {
  DEFAULT_HOST_CAPABILITIES,
  HOST_API_VERSION,
  RUNTIME_RPC_VERSION
} from "@freebuddy/protocol/runtime";
import type {
  RuntimeHostApi,
  RuntimeHostEnvironment,
  RuntimeProcessHandle
} from "./ports.js";
import { RuntimeRpcSession } from "./rpc/session.js";
import type { RuntimeMessageTransport } from "./rpc/transport.js";
import { resolveRuntimeEntryPath } from "./runtimeEntryPath.js";
import { recordCrash } from "./runtimeHealthMonitor.js";
import { sanitizedRuntimeProcessEnv } from "./runtimeProcessEnv.js";

export function transportFromProcessHandle(handle: RuntimeProcessHandle): RuntimeMessageTransport {
  return {
    send(message) {
      handle.send(message);
    },
    onMessage(handler) {
      return handle.onMessage(handler);
    }
  };
}

export interface RuntimeProcessClient {
  version: string;
  handle: RuntimeProcessHandle;
  session: RuntimeRpcSession;
  request(
    method: string,
    params?: unknown,
    options?: { timeoutMs?: number; idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<unknown>;
  shutdown(): Promise<void>;
}

export interface RuntimeProcessPool {
  ensure(version: string, entryPath?: string): Promise<RuntimeProcessClient>;
  request(
    version: string,
    method: string,
    params?: unknown,
    options?: { timeoutMs?: number; idempotencyKey?: string; signal?: AbortSignal }
  ): Promise<unknown>;
  shutdown(): Promise<void>;
  has(version: string): boolean;
}

function helloPayload(environment: RuntimeHostEnvironment) {
  return {
    hostId: environment.hostId,
    hostVersion: environment.hostVersion,
    hostApiVersion: environment.hostApiVersion || HOST_API_VERSION,
    hostCapabilities:
      environment.hostCapabilities.length > 0
        ? [...environment.hostCapabilities]
        : [...DEFAULT_HOST_CAPABILITIES],
    rpcVersion: RUNTIME_RPC_VERSION,
    allowUnsignedDevelopmentRuntime: environment.allowUnsignedDevelopmentRuntime
  };
}

export function createRuntimeProcessPool(input: {
  environment: RuntimeHostEnvironment;
  hostApi: RuntimeHostApi;
}): RuntimeProcessPool {
  const clients = new Map<string, Promise<RuntimeProcessClient>>();

  async function start(version: string, entryPath?: string): Promise<RuntimeProcessClient> {
    const resolved = entryPath ?? resolveRuntimeEntryPath(input.environment, version);
    if (!resolved) {
      throw new Error(`runtime entry missing for version ${version}`);
    }
    const handle = input.environment.launcher.launch({
      entryPath: resolved,
      env: sanitizedRuntimeProcessEnv(version)
    });
    const box: { session?: RuntimeRpcSession } = {};
    const session = new RuntimeRpcSession({
      transport: transportFromProcessHandle(handle),
      timeoutMs: 15_000,
      handlers: {
        async "host.invoke"(params, meta) {
          const body = params as { method?: string; args?: unknown };
          if (!body?.method) throw new Error("host.invoke requires method");
          return input.hostApi.invoke(body.method, body.args, {
            idempotencyKey: meta.idempotencyKey,
            runtimeVersion: version,
            emit: (event, payload) => box.session?.emit(event, payload)
          });
        }
      }
    });
    box.session = session;

    const onExit = handle.onExit((code) => {
      clients.delete(version);
      session.close();
      if (code && code !== 0) {
        recordCrash(input.environment, version);
      }
    });

    try {
      const helloTimeoutMs = Number(process.env.FB_RUNTIME_HELLO_TIMEOUT_MS ?? 8_000);
      await session.request("runtime.hello", helloPayload(input.environment), {
        timeoutMs: Number.isFinite(helloTimeoutMs) && helloTimeoutMs > 0 ? helloTimeoutMs : 8_000
      });
    } catch (error) {
      onExit();
      session.close();
      handle.kill();
      recordCrash(input.environment, version);
      throw error;
    }

    return {
      version,
      handle,
      session,
      request(method, params, options) {
        return session.request(method, params, options);
      },
      async shutdown() {
        try {
          await session.request("runtime.shutdown", {}, { timeoutMs: 2_000 });
        } catch {
          /* force kill below */
        }
        session.close();
        handle.kill();
        onExit();
        clients.delete(version);
      }
    };
  }

  return {
    has(version) {
      return clients.has(version);
    },
    async ensure(version, entryPath) {
      const existing = clients.get(version);
      if (existing) return existing;
      const started = start(version, entryPath).catch((error) => {
        clients.delete(version);
        throw error;
      });
      clients.set(version, started);
      return started;
    },
    async request(version, method, params, options) {
      const client = await this.ensure(version);
      return client.request(method, params, options);
    },
    async shutdown() {
      const pending = [...clients.values()];
      clients.clear();
      await Promise.all(
        pending.map(async (clientPromise) => {
          try {
            const client = await clientPromise;
            await client.shutdown();
          } catch {
            /* already gone */
          }
        })
      );
    }
  };
}
