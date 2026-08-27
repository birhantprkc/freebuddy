import fs from "node:fs";
import path from "node:path";
import { createHash, verify } from "node:crypto";
import type { RuntimeManifest } from "@freebuddy/protocol/runtime";
import { hostApiCompatible, hostCapabilitiesSatisfied } from "./hostApiRange.js";

export interface VerifyInput {
  manifestBytes: Buffer;
  signature: Buffer;
  publicKey: Buffer | string;
  archiveSha256: string;
  archiveBytes: Buffer;
  expectedBundleId: string;
  hostApiVersion: string;
}

export interface VerifyPackFilesInput {
  files: Record<string, Buffer>;
  publicKey?: Buffer | string;
  allowUnsigned?: boolean;
  expectedBundleId: string;
  hostApiVersion: string;
  hostCapabilities?: readonly string[];
}

export function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function readRuntimePackDirectory(dir: string): Record<string, Buffer> {
  const files: Record<string, Buffer> = {};
  const walk = (current: string, prefix: string) => {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.isFile()) files[rel.replaceAll("\\", "/")] = fs.readFileSync(full);
    }
  };
  walk(dir, "");
  return files;
}

export function verifyRuntimePackFiles(
  input: VerifyPackFilesInput
): { ok: true; manifest: RuntimeManifest } | { ok: false; error: string } {
  const manifestBytes = input.files["manifest.json"];
  const signature = input.files["manifest.sig"];
  const checksumBytes = input.files["checksums.json"];
  const entry = input.files["runtime/index.mjs"];
  if (!manifestBytes) return { ok: false, error: "missing manifest.json" };
  if (!checksumBytes) return { ok: false, error: "missing checksums.json" };
  if (!entry) return { ok: false, error: "missing runtime/index.mjs" };

  let checksums: { files?: Record<string, string> };
  try {
    checksums = JSON.parse(checksumBytes.toString("utf8")) as { files?: Record<string, string> };
  } catch {
    return { ok: false, error: "invalid checksums json" };
  }
  for (const [name, expected] of Object.entries(checksums.files ?? {})) {
    const bytes = input.files[name];
    if (!bytes) return { ok: false, error: `missing checksum file ${name}` };
    if (sha256(bytes) !== expected) return { ok: false, error: `checksum mismatch ${name}` };
  }

  if (!signature) {
    if (!input.allowUnsigned) return { ok: false, error: "missing manifest.sig" };
  } else if (input.publicKey) {
    if (!verify(null, manifestBytes, input.publicKey, signature)) {
      return { ok: false, error: "invalid signature" };
    }
  } else if (!input.allowUnsigned) {
    return { ok: false, error: "unknown pack key" };
  }

  let manifest: RuntimeManifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8")) as RuntimeManifest;
  } catch {
    return { ok: false, error: "invalid manifest json" };
  }
  if (manifest.bundleId !== input.expectedBundleId) {
    return { ok: false, error: "bundle id mismatch" };
  }
  if (!hostApiCompatible(manifest.hostApi, input.hostApiVersion)) {
    return { ok: false, error: "incompatible host api" };
  }
  const missing = hostCapabilitiesSatisfied(
    manifest.requiresHostCapabilities,
    input.hostCapabilities ?? []
  );
  if (missing.length > 0) {
    return { ok: false, error: `missing host capabilities: ${missing.join(",")}` };
  }
  return { ok: true, manifest };
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
  if (!hostApiCompatible(manifest.hostApi, input.hostApiVersion)) {
    return { ok: false, error: "incompatible host api" };
  }
  return { ok: true };
}
