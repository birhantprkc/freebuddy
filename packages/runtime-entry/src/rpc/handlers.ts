import {
  DEFAULT_HOST_CAPABILITIES,
  DEFAULT_RUNTIME_CAPABILITIES,
  HOST_API_VERSION,
  RUNTIME_BUNDLE_ID,
  RUNTIME_RPC_VERSION,
  type RuntimeHelloRequest,
  type RuntimeHelloResponse,
  type RuntimeRpcFrame
} from "@freebuddy/protocol/runtime";

export function negotiateHello(
  request: RuntimeHelloRequest
): { ok: true; response: RuntimeHelloResponse } | { ok: false; message: string } {
  if (request.rpcVersion !== RUNTIME_RPC_VERSION) {
    return { ok: false, message: "unsupported rpc version" };
  }
  if (!request.hostApiVersion.startsWith("1.")) {
    return { ok: false, message: "unsupported host api" };
  }
  const requiredHost = [...DEFAULT_HOST_CAPABILITIES];
  const unsupported = requiredHost.filter((cap) => !request.hostCapabilities.includes(cap));
  if (unsupported.length > 0) {
    return { ok: false, message: `missing: ${unsupported.join(",")}` };
  }
  return {
    ok: true,
    response: {
      runtimeVersion: "1.0.0",
      rpcVersion: RUNTIME_RPC_VERSION,
      nodeVersion: process.versions.node,
      bundleId: RUNTIME_BUNDLE_ID,
      hostApiRange: HOST_API_VERSION,
      requiredHostCapabilities: requiredHost,
      providedCapabilities: [...DEFAULT_RUNTIME_CAPABILITIES]
    }
  };
}

export function createRuntimeRpcHandlers(input?: {
  health?: () => unknown;
  hostInvoke?: (
    method: string,
    params: unknown,
    meta?: { idempotencyKey?: string }
  ) => Promise<unknown>;
}): Record<string, (params: unknown, meta: { idempotencyKey?: string }) => Promise<unknown> | unknown> {
  const started = Date.now();
  return {
    async "runtime.hello"(params) {
      const result = negotiateHello(params as RuntimeHelloRequest);
      if (!result.ok) throw new Error(result.message);
      return result.response;
    },
    async "runtime.health"() {
      return (
        input?.health?.() ?? {
          ok: true,
          runtimeVersion: "1.0.0",
          uptimeMs: Date.now() - started,
          activeRuns: 0
        }
      );
    },
    async "runtime.shutdown"() {
      return { ok: true };
    },
    async "host.invoke"(params, meta) {
      const body = params as { method?: string; args?: unknown };
      if (!body?.method) throw new Error("host.invoke requires method");
      if (!input?.hostInvoke) throw new Error("host invoke not bound");
      return input.hostInvoke(body.method, body.args, { idempotencyKey: meta.idempotencyKey });
    }
  };
}

export type { RuntimeRpcFrame };
