import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { RuntimeChannelDescriptor } from "@freebuddy/protocol/runtime";
import type { RuntimeHostEnvironment } from "./ports.js";
import { readRuntimeState, writeRuntimeState } from "./runtimeStateStore.js";
import { downloadRuntimeArtifact } from "./runtimeDownloader.js";
import { inRollout, parseChannelDescriptor, verifyChannelDescriptor } from "./runtimeManifest.js";
import { installRuntimeArchive } from "./runtimeInstaller.js";
import { cohortPath } from "./runtimePaths.js";
import { isVersionBlocked } from "./runtimeHealthMonitor.js";

export interface RuntimeUpdateConfig {
  baseUrl?: string;
  channel?: "stable" | "beta" | "development";
  enabled?: boolean;
}

function cohortId(dataDir: string): string {
  const file = cohortPath(dataDir);
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  const id = randomUUID();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, id);
  return id;
}

export async function checkRuntimeUpdate(
  environment: RuntimeHostEnvironment,
  config: RuntimeUpdateConfig
): Promise<
  | { available: false; reason: string }
  | { available: true; descriptor: RuntimeChannelDescriptor }
> {
  const state = readRuntimeState(environment.dataDir);
  state.lastCheckedAt = environment.clock.nowIso();
  if (config.channel) state.channel = config.channel;
  writeRuntimeState(environment.dataDir, state);

  if (!config.enabled || !config.baseUrl) {
    return { available: false, reason: "updates disabled" };
  }
  const channel = config.channel ?? state.channel;
  const url = `${config.baseUrl.replace(/\/$/, "")}/${channel}.json`;
  const response = await environment.http.fetch(url, { redirect: "manual" });
  if (!response.ok) return { available: false, reason: `channel fetch ${response.status}` };
  const bytes = Buffer.from(await response.arrayBuffer());
  const signatureHeader = response.headers.get("x-runtime-signature");
  const keyIdHeader = response.headers.get("x-runtime-key-id");
  let signature: Buffer | null = signatureHeader ? Buffer.from(signatureHeader, "base64") : null;
  if (!signature) {
    const sigResponse = await environment.http.fetch(`${url}.sig`, { redirect: "manual" });
    if (!sigResponse.ok) return { available: false, reason: "missing channel signature" };
    signature = Buffer.from(await sigResponse.arrayBuffer());
  }
  const parsedUnsigned = (() => {
    try {
      return JSON.parse(bytes.toString("utf8")) as { keyId?: string };
    } catch {
      return {};
    }
  })();
  const keyId = keyIdHeader ?? parsedUnsigned.keyId ?? "runtime-dev";
  const publicKey = environment.trustedKeys.get(keyId);
  if (!publicKey) return { available: false, reason: "unknown channel key" };
  const verified = verifyChannelDescriptor({
    descriptorBytes: bytes,
    signature,
    publicKey
  });
  if (!verified.ok) return { available: false, reason: verified.error };
  const descriptor = verified.descriptor;
  if (descriptor.killSwitch) return { available: false, reason: "kill switch" };
  if (descriptor.revokedVersions?.includes(descriptor.version)) {
    return { available: false, reason: "version revoked" };
  }
  if (state.blockedVersions[descriptor.version] && isVersionBlocked(state.blockedVersions, descriptor.version)) {
    return { available: false, reason: "version blocked locally" };
  }
  if (descriptor.rollout && !inRollout(cohortId(environment.dataDir), descriptor.rollout.percent)) {
    return { available: false, reason: "rollout excluded" };
  }
  if (descriptor.version === state.activeVersion) {
    return { available: false, reason: "already active" };
  }
  return { available: true, descriptor };
}

export async function downloadAndPrepareRuntime(
  environment: RuntimeHostEnvironment,
  descriptor: RuntimeChannelDescriptor
): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
  try {
    const downloaded = await downloadRuntimeArtifact({
      url: descriptor.archiveUrl,
      dataDir: environment.dataDir,
      version: descriptor.version,
      http: environment.http
    });
    if (downloaded.notModified) return { ok: true, version: descriptor.version };
    const hash = createHash("sha256").update(downloaded.bytes).digest("hex");
    if (hash !== descriptor.archiveSha256) {
      return { ok: false, error: "archive hash mismatch" };
    }
    if (downloaded.bytes.byteLength !== descriptor.archiveBytes) {
      return { ok: false, error: "archive size mismatch" };
    }
    const installed = installRuntimeArchive(environment.dataDir, descriptor.version, downloaded.bytes, {
      publicKey: environment.trustedKeys.get(descriptor.keyId ?? "runtime-dev"),
      allowUnsigned: environment.allowUnsignedDevelopmentRuntime && !descriptor.keyId?.startsWith("runtime-prod"),
      hostApiVersion: environment.hostApiVersion,
      hostCapabilities: environment.hostCapabilities
    });
    if (!installed.ok) return installed;
    const state = readRuntimeState(environment.dataDir);
    state.pendingVersion = descriptor.version;
    writeRuntimeState(environment.dataDir, state);
    return { ok: true, version: descriptor.version };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export function parseUnsignedChannelDescriptor(bytes: Buffer): RuntimeChannelDescriptor {
  return parseChannelDescriptor(bytes);
}
