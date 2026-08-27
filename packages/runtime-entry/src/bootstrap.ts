import { randomUUID } from "node:crypto";
import { WorkflowRuntime } from "@freebuddy/workflow-runtime";
import { DelegationRuntime } from "@freebuddy/delegation-runtime";
import { RUNTIME_RPC_VERSION } from "@freebuddy/protocol/runtime";
import { RuntimeRpcPeer } from "./rpc/peer.js";
import { makeFrame } from "./rpc/framing.js";
import { resolveRuntimeProcessTransport } from "./rpc/ipcTransport.js";
import { createRuntimeRpcHandlers } from "./rpc/handlers.js";
import { createHostBackedPorts } from "./rpc/hostPorts.js";
import {
  createDelegationServiceHandlers,
  createWorkflowServiceHandlers
} from "./rpc/serviceHandlers.js";
import type { RpcHandler } from "./rpc/peer.js";

export async function startRuntimeBootstrap(): Promise<RuntimeRpcPeer> {
  const transport = resolveRuntimeProcessTransport();
  const handlers: Record<string, RpcHandler> = {};
  const peerRef: { current: RuntimeRpcPeer | null } = { current: null };
  const peerFacade = {
    request: ((...args: Parameters<RuntimeRpcPeer["request"]>) =>
      peerRef.current!.request(...args)) as RuntimeRpcPeer["request"],
    onEvent: ((...args: Parameters<RuntimeRpcPeer["onEvent"]>) =>
      peerRef.current!.onEvent(...args)) as RuntimeRpcPeer["onEvent"]
  } as RuntimeRpcPeer;

  const { workflow, delegation, controller } = createHostBackedPorts(peerFacade);
  const workflowRuntime = new WorkflowRuntime(workflow);
  const delegationRuntime = new DelegationRuntime(delegation);
  const started = Date.now();
  const version = process.env.FB_RUNTIME_VERSION || "1.0.0";

  Object.assign(
    handlers,
    createRuntimeRpcHandlers({
      health: () => ({
        ok: true,
        runtimeVersion: version,
        uptimeMs: Date.now() - started,
        activeRuns: delegationRuntime.listActiveRunIds().length
      })
    }),
    createWorkflowServiceHandlers(workflowRuntime, controller),
    createDelegationServiceHandlers(delegationRuntime, controller),
    {
      async "runtime.shutdown"() {
        setTimeout(() => process.exit(0), 10);
        return { ok: true };
      }
    }
  );

  const peer = new RuntimeRpcPeer({ transport, handlers, timeoutMs: 15_000 });
  peerRef.current = peer;

  transport.send(
    makeFrame({
      id: randomUUID(),
      kind: "event",
      event: "runtime.booting",
      payload: { runtimeVersion: version, pid: process.pid, rpcVersion: RUNTIME_RPC_VERSION }
    })
  );
  return peer;
}

const shouldStart =
  process.env.FB_RUNTIME_PROCESS === "1" ||
  Boolean((process as NodeJS.Process & { parentPort?: unknown }).parentPort) ||
  typeof process.send === "function";

if (shouldStart) {
  startRuntimeBootstrap().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
