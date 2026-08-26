import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  checkRuntimeUpdate,
  createRuntimeVersionRouter,
  inRollout,
  installRuntimeArchive,
  legacyRuntimeVersion,
  probeRuntimeVersion,
  recordCrash,
  writeRuntimeState
} from "../packages/runtime-host/dist/index.js";

function dataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fb-runtime-"));
}

test("version router pins persisted runs and uses active for new runs", () => {
  const router = createRuntimeVersionRouter(() => "2.0.0");
  assert.deepEqual(router.route({ runtimeVersion: "1.0.0" }), {
    version: "1.0.0",
    pinned: true
  });
  assert.deepEqual(router.route({}), { version: "2.0.0", pinned: false });
  assert.equal(legacyRuntimeVersion(null), "bundled");
  router.retain("1.0.0");
  assert.deepEqual(router.referencedVersions(), ["1.0.0"]);
});

test("crash loop blocks a version", () => {
  const dir = dataDir();
  const env = {
    dataDir: dir,
    clock: { now: () => new Date(), nowIso: () => new Date().toISOString() }
  };
  assert.equal(recordCrash(env, "bad"), false);
  assert.equal(recordCrash(env, "bad"), false);
  assert.equal(recordCrash(env, "bad"), true);
});

test("channel rollout exclusion is deterministic", () => {
  assert.equal(inRollout("always-in", 100), true);
  assert.equal(inRollout("always-out", 0), false);
});

test("update check respects kill switch and missing signature", async () => {
  const dir = dataDir();
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const descriptor = {
    schemaVersion: 1,
    channel: "stable",
    bundleId: "dev.freebuddy.runtime",
    version: "1.2.3",
    hostApi: "1.0.0",
    archiveUrl: "https://example.invalid/runtime.zip",
    archiveSha256: "abc",
    archiveBytes: 1,
    publishedAt: new Date().toISOString(),
    killSwitch: true
  };
  const bytes = Buffer.from(`${JSON.stringify(descriptor)}\n`);
  const signature = sign(null, bytes, privateKey);
  const environment = {
    hostId: "freebuddy-cli",
    hostVersion: "0.0.0",
    hostApiVersion: "1.0.0",
    hostCapabilities: [],
    dataDir: dir,
    allowUnsignedDevelopmentRuntime: true,
    launcher: { launch: () => ({ send() {}, onMessage() { return () => {}; }, onExit() { return () => {}; }, kill() {} }) },
    http: {
      async fetch() {
        return new Response(bytes, {
          status: 200,
          headers: {
            "x-runtime-signature": signature.toString("base64"),
            "x-runtime-key-id": "runtime-dev"
          }
        });
      }
    },
    trustedKeys: {
      get: () => publicKey.export({ type: "spki", format: "pem" }).toString(),
      list: () => []
    },
    clock: { now: () => new Date(), nowIso: () => new Date().toISOString() }
  };
  writeRuntimeState(dir, {
    schemaVersion: 1,
    activeVersion: "1.0.0",
    pendingVersion: null,
    lastKnownGoodVersion: "1.0.0",
    channel: "stable",
    lastCheckedAt: null,
    blockedVersions: {}
  });
  const killed = await checkRuntimeUpdate(environment, {
    enabled: true,
    baseUrl: "https://example.invalid/runtime"
  });
  assert.equal(killed.available, false);
  assert.match(killed.reason, /kill switch/);
});

test("update check accepts a sibling channel signature file", async () => {
  const dir = dataDir();
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const descriptor = {
    schemaVersion: 1,
    channel: "stable",
    bundleId: "dev.freebuddy.runtime",
    version: "1.2.3",
    hostApi: "1.0.0",
    archiveUrl: "https://example.invalid/runtime.zip",
    archiveSha256: "abc",
    archiveBytes: 1,
    publishedAt: new Date().toISOString(),
    keyId: "runtime-dev"
  };
  const bytes = Buffer.from(`${JSON.stringify(descriptor)}\n`);
  const signature = sign(null, bytes, privateKey);
  const environment = {
    hostId: "freebuddy-cli",
    hostVersion: "0.0.0",
    hostApiVersion: "1.0.0",
    hostCapabilities: [],
    dataDir: dir,
    allowUnsignedDevelopmentRuntime: true,
    launcher: { launch: () => ({ send() {}, onMessage() { return () => {}; }, onExit() { return () => {}; }, kill() {} }) },
    http: {
      async fetch(url) {
        const target = String(url);
        if (target.endsWith("/stable.json.sig")) {
          return new Response(signature, { status: 200 });
        }
        if (target.endsWith("/stable.json")) {
          return new Response(bytes, { status: 200 });
        }
        return new Response("missing", { status: 404 });
      }
    },
    trustedKeys: {
      get: (keyId) => (keyId === "runtime-dev" ? publicKey.export({ type: "spki", format: "pem" }).toString() : undefined),
      list: () => []
    },
    clock: { now: () => new Date(), nowIso: () => new Date().toISOString() }
  };
  writeRuntimeState(dir, {
    schemaVersion: 1,
    activeVersion: "1.0.0",
    pendingVersion: null,
    lastKnownGoodVersion: "1.0.0",
    channel: "stable",
    lastCheckedAt: null,
    blockedVersions: {}
  });
  const checked = await checkRuntimeUpdate(environment, {
    enabled: true,
    baseUrl: "https://example.invalid/runtime"
  });
  assert.equal(checked.available, true);
  assert.equal(checked.descriptor.version, "1.2.3");
});

test("update check fails when the channel signature is missing", async () => {
  const dir = dataDir();
  const descriptor = {
    schemaVersion: 1,
    channel: "stable",
    bundleId: "dev.freebuddy.runtime",
    version: "1.2.3",
    hostApi: "1.0.0",
    archiveUrl: "https://example.invalid/runtime.zip",
    archiveSha256: "abc",
    archiveBytes: 1,
    publishedAt: new Date().toISOString()
  };
  const bytes = Buffer.from(`${JSON.stringify(descriptor)}\n`);
  const environment = {
    hostId: "freebuddy-cli",
    hostVersion: "0.0.0",
    hostApiVersion: "1.0.0",
    hostCapabilities: [],
    dataDir: dir,
    allowUnsignedDevelopmentRuntime: true,
    launcher: { launch: () => ({ send() {}, onMessage() { return () => {}; }, onExit() { return () => {}; }, kill() {} }) },
    http: {
      async fetch(url) {
        if (String(url).endsWith(".sig")) {
          return new Response("missing", { status: 404 });
        }
        return new Response(bytes, { status: 200 });
      }
    },
    trustedKeys: {
      get: () => "unused",
      list: () => []
    },
    clock: { now: () => new Date(), nowIso: () => new Date().toISOString() }
  };
  writeRuntimeState(dir, {
    schemaVersion: 1,
    activeVersion: "1.0.0",
    pendingVersion: null,
    lastKnownGoodVersion: "1.0.0",
    channel: "stable",
    lastCheckedAt: null,
    blockedVersions: {}
  });
  const checked = await checkRuntimeUpdate(environment, {
    enabled: true,
    baseUrl: "https://example.invalid/runtime"
  });
  assert.equal(checked.available, false);
  assert.match(checked.reason, /missing channel signature/);
});

test("probe fails for a missing downloaded version", async () => {
  const dir = dataDir();
  const result = await probeRuntimeVersion(
    {
      dataDir: dir,
      launcher: { launch: () => { throw new Error("should not launch"); } },
      bundledRuntimePath: path.join(dir, "missing-bundled"),
      clock: { nowIso: () => new Date().toISOString() }
    },
    "9.9.9"
  );
  assert.equal(result.ok, false);
});

test("installer rejects path escape", async () => {
  const dir = dataDir();
  const { default: AdmZip } = await import("adm-zip");
  const zip = new AdmZip();
  zip.addFile("escape.txt", Buffer.from("nope"));
  zip.getEntries()[0].entryName = "../escape.txt";
  const result = installRuntimeArchive(dir, "evil", zip.toBuffer());
  assert.equal(result.ok, false);
});
