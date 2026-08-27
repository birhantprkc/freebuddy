import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRuntimeManager, recordCrash, writeRuntimeState, scheduleLastKnownGood, confirmAndMarkLastKnownGood, readRuntimeState } from "../packages/runtime-host/dist/index.js";
import {
  createHealthyRuntimeLauncher,
  writeDummyRuntimeEntry
} from "./fixtures/runtime-healthy-launcher.mjs";

function env(dataDir, launcher) {
  writeDummyRuntimeEntry(dataDir);
  return {
    hostId: "freebuddy-cli",
    hostVersion: "0.0.0-test",
    hostApiVersion: "1.0.0",
    hostCapabilities: ["agent.execute.v1", "workflow.repository.v1", "delegation.repository.v1", "events.publish.v1"],
    dataDir,
    bundledRuntimePath: dataDir,
    allowUnsignedDevelopmentRuntime: true,
    launcher: launcher ?? createHealthyRuntimeLauncher(),
    http: { fetch },
    trustedKeys: { get: () => undefined, list: () => [] },
    clock: { now: () => new Date(), nowIso: () => new Date().toISOString() }
  };
}

test("activation of bundled runtime succeeds and rollback does not block bundled", async () => {
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
  assert.equal(after.blockedVersions.bundled, undefined);
  await manager.activate("bundled");
});

test("explicit rollback blocks a downloaded version but not bundled", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-block-"));
  const manager = createRuntimeManager(env(dataDir), { invoke: async () => null });
  writeRuntimeState(dataDir, {
    schemaVersion: 1,
    activeVersion: "1.2.3",
    pendingVersion: null,
    lastKnownGoodVersion: "bundled",
    channel: "stable",
    lastCheckedAt: null,
    blockedVersions: {},
    crashCounts: {}
  });
  await manager.rollback();
  await assert.rejects(() => manager.activate("1.2.3"), /blocked/);
  await manager.activate("bundled");
});

test("a single crash rolls back to last-known-good without permanently blocking", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-crash-"));
  writeRuntimeState(dataDir, {
    schemaVersion: 1,
    activeVersion: "2.0.0",
    pendingVersion: null,
    lastKnownGoodVersion: "1.0.0",
    channel: "stable",
    lastCheckedAt: null,
    blockedVersions: {},
    crashCounts: {}
  });
  const environment = {
    dataDir,
    clock: { now: () => new Date(), nowIso: () => new Date().toISOString() }
  };
  assert.equal(recordCrash(environment, "2.0.0"), false);
  const state = JSON.parse(
    fs.readFileSync(path.join(dataDir, "runtimes", "runtime-state.json"), "utf8")
  );
  assert.equal(state.activeVersion, "1.0.0");
  assert.equal(state.blockedVersions["2.0.0"], undefined);
  assert.equal(state.crashCounts["2.0.0"], 1);
});

test("health window does not promote a crashed version to last-known-good", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-lkg-crash-"));
  const environment = env(dataDir);
  writeRuntimeState(dataDir, {
    schemaVersion: 1,
    activeVersion: "2.0.0",
    pendingVersion: null,
    lastKnownGoodVersion: "bundled",
    channel: "stable",
    lastCheckedAt: null,
    blockedVersions: {},
    crashCounts: {}
  });
  scheduleLastKnownGood(environment, "2.0.0", 40);
  recordCrash(environment, "2.0.0");
  await new Promise((resolve) => setTimeout(resolve, 80));
  const state = readRuntimeState(dataDir);
  assert.equal(state.lastKnownGoodVersion, "bundled");
  assert.notEqual(state.activeVersion, "2.0.0");
});

test("health window re-probes and requires zero crashes before last-known-good", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-lkg-ok-"));
  const environment = env(dataDir);
  writeRuntimeState(dataDir, {
    schemaVersion: 1,
    activeVersion: "bundled",
    pendingVersion: null,
    lastKnownGoodVersion: null,
    channel: "stable",
    lastCheckedAt: null,
    blockedVersions: {},
    crashCounts: {}
  });
  assert.equal(await confirmAndMarkLastKnownGood(environment, "bundled"), true);
  assert.equal(readRuntimeState(dataDir).lastKnownGoodVersion, "bundled");

  writeRuntimeState(dataDir, {
    ...readRuntimeState(dataDir),
    lastKnownGoodVersion: null,
    crashCounts: { bundled: 1 }
  });
  assert.equal(await confirmAndMarkLastKnownGood(environment, "bundled"), false);
  assert.equal(readRuntimeState(dataDir).lastKnownGoodVersion, null);
});
