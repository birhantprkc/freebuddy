import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { readRuntimeState, writeRuntimeState, withInstallLock } = await import(
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

test("install lock serializes overlapping download and install work", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-lock-"));
  const order = [];
  let releaseFirst;
  const blocked = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const first = withInstallLock(dataDir, async () => {
    order.push("a-start");
    await blocked;
    order.push("a-end");
    return 1;
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const second = withInstallLock(dataDir, async () => {
    order.push("b");
    return 2;
  });
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(order, ["a-start", "a-end", "b"]);
});

test("stale install lock steal does not let the old holder delete the new lock", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-lock-stale-"));
  const lockFile = path.join(dataDir, "runtimes", "runtime.lock");
  let releaseFirst;
  const firstHold = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let secondSawLock = false;
  const first = withInstallLock(
    dataDir,
    async () => {
      await firstHold;
      return "a";
    },
    { staleMs: 40, heartbeatMs: 0, timeoutMs: 1_000 }
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fs.existsSync(lockFile), true);
  const firstToken = JSON.parse(fs.readFileSync(lockFile, "utf8")).token;
  await new Promise((resolve) => setTimeout(resolve, 45));
  const second = withInstallLock(
    dataDir,
    async () => {
      const held = JSON.parse(fs.readFileSync(lockFile, "utf8"));
      assert.notEqual(held.token, firstToken);
      releaseFirst();
      await new Promise((resolve) => setTimeout(resolve, 30));
      secondSawLock = fs.existsSync(lockFile);
      const afterOldRelease = JSON.parse(fs.readFileSync(lockFile, "utf8"));
      assert.equal(afterOldRelease.token, held.token);
      return "b";
    },
    { staleMs: 40, heartbeatMs: 0, timeoutMs: 1_000 }
  );
  assert.deepEqual(await Promise.all([first, second]), ["a", "b"]);
  assert.equal(secondSawLock, true);
});
