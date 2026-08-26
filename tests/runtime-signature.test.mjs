import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";

const { verifyRuntimeArtifact, sha256 } = await import(
  "../packages/runtime-host/dist/runtimeVerifier.js"
);

test("valid signature verifies", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const manifestBytes = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      bundleId: "dev.freebuddy.runtime",
      version: "1.0.0",
      rpcVersion: 1,
      engine: { node: ">=22.0.0" },
      hostApi: ">=1.0.0 <2.0.0",
      entry: "runtime/index.mjs",
      keyId: "k",
      publishedAt: "2026-08-26T00:00:00.000Z",
      providesCapabilities: [],
      requiresHostCapabilities: []
    })
  );
  const archiveBytes = Buffer.from("archive");
  const signature = sign(null, manifestBytes, privateKey);
  const result = verifyRuntimeArtifact({
    manifestBytes,
    signature,
    publicKey,
    archiveSha256: sha256(archiveBytes),
    archiveBytes,
    expectedBundleId: "dev.freebuddy.runtime",
    hostApiVersion: "1.0.0"
  });
  assert.equal(result.ok, true);
});

test("modified archive is rejected", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const manifestBytes = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      bundleId: "dev.freebuddy.runtime",
      version: "1.0.0",
      hostApi: ">=1.0.0 <2.0.0"
    })
  );
  const archiveBytes = Buffer.from("archive");
  const signature = sign(null, manifestBytes, privateKey);
  const result = verifyRuntimeArtifact({
    manifestBytes,
    signature,
    publicKey,
    archiveSha256: sha256(archiveBytes),
    archiveBytes: Buffer.from("tampered"),
    expectedBundleId: "dev.freebuddy.runtime",
    hostApiVersion: "1.0.0"
  });
  assert.equal(result.ok, false);
});
