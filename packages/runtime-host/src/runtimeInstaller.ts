import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { RUNTIME_BUNDLE_ID } from "@freebuddy/protocol/runtime";
import { ensureRuntimeRoot, versionDir } from "./runtimePaths.js";
import { readRuntimePackDirectory, verifyRuntimePackFiles } from "./runtimeVerifier.js";

const require = createRequire(import.meta.url);
const AdmZip = require("adm-zip") as typeof import("adm-zip");

const MAX_FILES = 4000;
const MAX_TOTAL = 80 * 1024 * 1024;

export interface InstallRuntimeOptions {
  publicKey?: Buffer | string;
  allowUnsigned?: boolean;
  hostApiVersion?: string;
  hostCapabilities?: readonly string[];
}

function verifyDir(
  dir: string,
  options: InstallRuntimeOptions
): { ok: true } | { ok: false; error: string } {
  return verifyRuntimePackFiles({
    files: readRuntimePackDirectory(dir),
    publicKey: options.publicKey,
    allowUnsigned: options.allowUnsigned,
    expectedBundleId: RUNTIME_BUNDLE_ID,
    hostApiVersion: options.hostApiVersion ?? "1.0.0",
    hostCapabilities: options.hostCapabilities ?? []
  });
}

export function installRuntimeArchive(
  dataDir: string,
  version: string,
  archiveBytes: Buffer,
  options: InstallRuntimeOptions = {}
): { ok: true; dir: string } | { ok: false; error: string } {
  ensureRuntimeRoot(dataDir);
  const dest = versionDir(dataDir, version);
  if (fs.existsSync(dest)) {
    const existing = verifyDir(dest, options);
    if (!existing.ok) {
      return {
        ok: false,
        error: `installed ${version} does not match signed pack (${existing.error}); refusing to overwrite`
      };
    }
    return { ok: true, dir: dest };
  }

  let zip: import("adm-zip");
  try {
    zip = new AdmZip(archiveBytes);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unzip failed" };
  }

  const entries = zip.getEntries();
  if (entries.length > MAX_FILES) return { ok: false, error: "too many files" };
  let total = 0;
  for (const entry of entries) {
    const name = entry.entryName.replaceAll("\\", "/");
    if (name.startsWith("/") || name.includes("..") || path.isAbsolute(name)) {
      return { ok: false, error: "illegal path" };
    }
    const resolved = path.resolve(dest, name);
    if (resolved !== dest && !resolved.startsWith(`${path.resolve(dest)}${path.sep}`)) {
      return { ok: false, error: "illegal path" };
    }
    total += entry.header?.size ?? entry.getData().byteLength;
    if (total > MAX_TOTAL) return { ok: false, error: "zip bomb" };
  }

  const tmp = `${dest}.partial`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = entry.entryName.replaceAll("\\", "/");
    const target = path.join(tmp, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.getData());
  }
  const verified = verifyDir(tmp, options);
  if (!verified.ok) {
    fs.rmSync(tmp, { recursive: true, force: true });
    return verified;
  }
  fs.renameSync(tmp, dest);
  return { ok: true, dir: dest };
}
