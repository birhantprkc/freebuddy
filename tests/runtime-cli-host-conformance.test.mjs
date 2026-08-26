import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const {
  createRuntimeManager,
  createNodeRuntimeProcessLauncher
} = await import("../packages/runtime-host/dist/index.js");

test("node cli host can construct a runtime manager without electron", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-cli-host-"));
  const manager = createRuntimeManager(
    {
      hostId: "freebuddy-cli",
      hostVersion: "0.0.0-test",
      hostApiVersion: "1.0.0",
      hostCapabilities: ["agent.execute.v1"],
      dataDir,
      allowUnsignedDevelopmentRuntime: true,
      launcher: createNodeRuntimeProcessLauncher(),
      http: { fetch },
      trustedKeys: { get: () => undefined, list: () => [] },
      clock: { now: () => new Date(), nowIso: () => new Date().toISOString() }
    },
    { invoke: async () => null }
  );
  await manager.activate("bundled");
  const status = await manager.status();
  assert.equal(status.hostId, "freebuddy-cli");
  assert.equal(status.activeVersion, "bundled");
});

test("runtime-host source has no electron imports", () => {
  const src = fs.readFileSync(
    new URL("../packages/runtime-host/src/index.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(src, /from ["']electron["']/);
});
