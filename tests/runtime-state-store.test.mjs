import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

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
    async (signal) => {
      await Promise.race([
        firstHold,
        new Promise((_, reject) => {
          const fail = () => reject(new Error("runtime install lock lost"));
          if (signal.aborted) fail();
          signal.addEventListener("abort", fail, { once: true });
        })
      ]);
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
  const [firstResult, secondResult] = await Promise.allSettled([first, second]);
  assert.equal(secondResult.status, "fulfilled");
  assert.equal(secondResult.value, "b");
  assert.equal(firstResult.status, "rejected");
  assert.match(String(firstResult.reason), /lock lost/);
  assert.equal(secondSawLock, true);
});

test("two processes cannot overlap after racing a stale install lock", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-lock-race-"));
  const lockFile = path.join(dataDir, "runtimes", "runtime.lock");
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(lockFile, `${JSON.stringify({ token: "stale", pid: 0 })}\n`);
  const past = new Date(Date.now() - 10_000);
  fs.utimesSync(lockFile, past, past);

  const worker = fileURLToPath(new URL("./fixtures/install-lock-worker.mjs", import.meta.url));
  const spawnWorker = (label) => {
    const readyFile = path.join(dataDir, `${label}.ready`);
    const resultFile = path.join(dataDir, `${label}.result`);
    const child = spawn(
      process.execPath,
      [
        worker,
        dataDir,
        readyFile,
        path.join(dataDir, "go"),
        resultFile,
        path.join(dataDir, "busy"),
        "2000"
      ],
      { stdio: "inherit" }
    );
    return { child, readyFile, resultFile };
  };

  const a = spawnWorker("a");
  const b = spawnWorker("b");
  const waitFor = async (file) => {
    const started = Date.now();
    while (!fs.existsSync(file)) {
      if (Date.now() - started > 8_000) throw new Error(`timed out waiting for ${file}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  await Promise.all([waitFor(a.readyFile), waitFor(b.readyFile)]);
  fs.writeFileSync(path.join(dataDir, "go"), "1");
  await Promise.all([waitFor(a.resultFile), waitFor(b.resultFile)]);
  const results = [
    fs.readFileSync(a.resultFile, "utf8").trim(),
    fs.readFileSync(b.resultFile, "utf8").trim()
  ];
  assert.deepEqual(results.sort(), ["OK", "OK"]);
  const waitExit = (child, label) => {
    if (child.exitCode !== null) {
      if (child.exitCode === 0) return Promise.resolve();
      return Promise.reject(new Error(`${label} exited ${child.exitCode}`));
    }
    return new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`${label} exited ${code}`))
      );
    });
  };
  await Promise.all([waitExit(a.child, "a"), waitExit(b.child, "b")]);
});
