/**
 * Construction surface for a future freebuddy-cli Host.
 * Desktop and CLI both compose createRuntimeManager with an injected launcher
 * and Host API. This fixture is imported by the Node conformance test.
 */
import {
  createRuntimeManager,
  createNodeRuntimeProcessLauncher
} from "../../packages/runtime-host/dist/index.js";

export function createCliRuntimeHost(input) {
  return createRuntimeManager(
    {
      hostId: "freebuddy-cli",
      hostVersion: input.hostVersion ?? "0.0.0-test",
      hostApiVersion: "1.0.0",
      hostCapabilities: input.hostCapabilities ?? [
        "agent.execute.v1",
        "workflow.repository.v1",
        "delegation.repository.v1",
        "events.publish.v1"
      ],
      dataDir: input.dataDir,
      bundledRuntimePath: input.bundledRuntimePath,
      allowUnsignedDevelopmentRuntime: true,
      launcher: input.launcher ?? createNodeRuntimeProcessLauncher(),
      http: { fetch },
      trustedKeys: input.trustedKeys ?? { get: () => undefined, list: () => [] },
      clock: { now: () => new Date(), nowIso: () => new Date().toISOString() }
    },
    input.hostApi ?? { invoke: async () => null }
  );
}
