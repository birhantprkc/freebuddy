import { RuntimeRpcSession } from "@freebuddy/runtime-host";
import type { RuntimeMessageTransport } from "@freebuddy/runtime-host";
import {
  DEFAULT_HOST_CAPABILITIES,
  HOST_API_VERSION,
  RUNTIME_RPC_VERSION
} from "@freebuddy/protocol/runtime";

export function createDesktopHostRpcHandlers(invoke: (method: string, params: unknown) => Promise<unknown>) {
  return {
    async "host.invoke"(params: unknown) {
      const body = params as { method?: string; args?: unknown };
      if (!body?.method) throw new Error("method required");
      return invoke(body.method, body.args);
    }
  };
}

export function bindRuntimeProcessRpc(transport: RuntimeMessageTransport, invoke: (method: string, params: unknown) => Promise<unknown>) {
  return new RuntimeRpcSession({
    transport,
    handlers: createDesktopHostRpcHandlers(invoke)
  });
}

export function desktopHelloPayload(hostVersion: string, hostId: string) {
  return {
    hostId,
    hostVersion,
    hostApiVersion: HOST_API_VERSION,
    hostCapabilities: [...DEFAULT_HOST_CAPABILITIES],
    rpcVersion: RUNTIME_RPC_VERSION
  };
}
