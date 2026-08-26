import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_HOST_CAPABILITIES,
  HOST_API_VERSION,
  RUNTIME_RPC_VERSION
} from "../packages/protocol/dist/runtime.js";
import {
  RuntimeRpcSession,
  createLoopbackPair,
  isRuntimeRpcFrame,
  redactSecrets
} from "../packages/runtime-host/dist/index.js";
import { attachRuntimeRpcServer } from "../packages/runtime-entry/dist/rpc/server.js";

test("rpc loopback covers success, timeout, cancel, malformed, optional fields, handshake", async () => {
  const pair = createLoopbackPair();
  attachRuntimeRpcServer(pair.runtime);
  const host = new RuntimeRpcSession({ transport: pair.host, timeoutMs: 200 });

  const hello = await host.request("runtime.hello", {
    hostId: "freebuddy-cli",
    hostVersion: "0.0.0-test",
    hostApiVersion: HOST_API_VERSION,
    hostCapabilities: [...DEFAULT_HOST_CAPABILITIES],
    rpcVersion: RUNTIME_RPC_VERSION,
    extraOptional: true
  });
  assert.equal(hello.rpcVersion, RUNTIME_RPC_VERSION);
  assert.equal(hello.bundleId, "dev.freebuddy.runtime");

  const health = await host.request("runtime.health", {});
  assert.equal(health.ok, true);

  await assert.rejects(
    () => host.request("runtime.missing", {}, { timeoutMs: 50 }),
    /unknown method|rpc timeout|rpc error/
  );

  const controller = new AbortController();
  const pending = host.request("runtime.health", {}, { signal: controller.signal, timeoutMs: 5_000 });
  controller.abort();
  await assert.rejects(() => pending, /cancelled/);

  assert.equal(isRuntimeRpcFrame({ rpcVersion: 1, id: "x", kind: "request" }), true);
  assert.equal(isRuntimeRpcFrame({ id: "x" }), false);

  const redacted = redactSecrets({ authorization: "secret-token", nested: { apiKey: "abc" } });
  assert.equal(redacted.authorization, "<redacted>");
  assert.equal(redacted.nested.apiKey, "<redacted>");

  await assert.rejects(
    () =>
      host.request("runtime.hello", {
        hostId: "freebuddy-cli",
        hostVersion: "0.0.0-test",
        hostApiVersion: "9.0.0",
        hostCapabilities: [...DEFAULT_HOST_CAPABILITIES],
        rpcVersion: RUNTIME_RPC_VERSION
      }),
    /unsupported host api|handler_failed|rpc error/
  );

  host.close();
});
