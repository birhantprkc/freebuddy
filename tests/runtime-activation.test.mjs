import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRuntimeManager } from "../packages/runtime-host/dist/index.js";

function env(dataDir) {
  return {
    hostId: "freebuddy-cli",
    hostVersion: "0.0.0-test",
    hostApiVersion: "1.0.0",
    hostCapabilities: ["agent.execute.v1"],
    dataDir,
    bundledRuntimePath: dataDir,
    allowUnsignedDevelopmentRuntime: true,
    launcher: {
      launch() {
        return {
          send() {},
          onMessage() {
            return () => {};
          },
          onExit() {
            return () => {};
          },
          kill() {}
        };
      }
    },
    http: { fetch },
    trustedKeys: { get: () => undefined, list: () => [] },
    clock: { now: () => new Date(), nowIso: () => new Date().toISOString() }
  };
}

test("activation of bundled runtime succeeds and rollback restores last known good", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-act-"));
  const manager = createRuntimeManager(env(dataDir), { invoke: async () => null });
  await manager.activate("bundled");
  const status = await manager.status();
  assert.equal(status.activeVersion, "bundled");
  await manager.setChannel("beta");
  assert.equal((await manager.status()).channel, "beta");
  await manager.rollback();
  const after = await manager.status();
  assert.equal(after.activeVersion, "bundled");
  assert.ok(after.blockedVersions.bundled);
});

test("blocked versions cannot be activated", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-block-"));
  const manager = createRuntimeManager(env(dataDir), { invoke: async () => null });
  await manager.activate("bundled");
  await manager.rollback();
  await assert.rejects(() => manager.activate("bundled"), /blocked/);
});
