import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { readRuntimeState, writeRuntimeState } = await import(
  "../packages/runtime-host/dist/runtimeStateStore.js"
);

test("runtime state writes atomically and reloads", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-runtime-"));
  writeRuntimeState(dataDir, {
    schemaVersion: 1,
    activeVersion: "1.0.0",
    pendingVersion: null,
    lastKnownGoodVersion: "1.0.0",
    channel: "stable",
    lastCheckedAt: null,
    blockedVersions: {}
  });
  const state = readRuntimeState(dataDir);
  assert.equal(state.activeVersion, "1.0.0");
  assert.equal(state.channel, "stable");
});

test("corrupt runtime state falls back to empty defaults", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-runtime-"));
  fs.mkdirSync(path.join(dataDir, "runtimes"), { recursive: true });
  fs.writeFileSync(path.join(dataDir, "runtimes", "runtime-state.json"), "{not json");
  const state = readRuntimeState(dataDir);
  assert.equal(state.activeVersion, null);
});
