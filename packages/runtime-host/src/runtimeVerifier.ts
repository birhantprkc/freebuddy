import { createHash, verify } from "node:crypto";
import type { RuntimeManifest } from "@freebuddy/protocol/runtime";

export interface VerifyInput {
  manifestBytes: Buffer;
  signature: Buffer;
  publicKey: Buffer | string;
  archiveSha256: string;
  archiveBytes: Buffer;
  expectedBundleId: string;
  hostApiVersion: string;
}

export function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function verifyRuntimeArtifact(input: VerifyInput): { ok: true } | { ok: false; error: string } {
  if (input.archiveBytes.byteLength > 80 * 1024 * 1024) {
    return { ok: false, error: "archive too large" };
  }
  const archiveHash = sha256(input.archiveBytes);
  if (archiveHash !== input.archiveSha256) {
    return { ok: false, error: "archive hash mismatch" };
  }
  const valid = verify(null, input.manifestBytes, input.publicKey, input.signature);
  if (!valid) return { ok: false, error: "invalid signature" };
  let manifest: RuntimeManifest;
  try {
    manifest = JSON.parse(input.manifestBytes.toString("utf8")) as RuntimeManifest;
  } catch {
    return { ok: false, error: "invalid manifest json" };
  }
  if (manifest.bundleId !== input.expectedBundleId) {
    return { ok: false, error: "bundle id mismatch" };
  }
  if (!manifest.hostApi.includes(input.hostApiVersion.split(".")[0] ?? "1")) {
    return { ok: false, error: "incompatible host api" };
  }
  return { ok: true };
}
