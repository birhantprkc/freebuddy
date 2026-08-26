import { createHash, verify } from "node:crypto";
import type { RuntimeChannelDescriptor } from "@freebuddy/protocol/runtime";
import { RUNTIME_BUNDLE_ID } from "@freebuddy/protocol/runtime";

export function parseChannelDescriptor(bytes: Buffer): RuntimeChannelDescriptor {
  const parsed = JSON.parse(bytes.toString("utf8")) as RuntimeChannelDescriptor;
  if (parsed.schemaVersion !== 1) throw new Error("unsupported channel descriptor schema");
  if (parsed.bundleId !== RUNTIME_BUNDLE_ID) throw new Error("unexpected bundle id");
  if (!parsed.archiveUrl.startsWith("https://") && !parsed.archiveUrl.startsWith("http://127.0.0.1")) {
    throw new Error("archive url must be https");
  }
  return parsed;
}

export function verifyChannelDescriptor(input: {
  descriptorBytes: Buffer;
  signature: Buffer;
  publicKey: Buffer | string;
}): { ok: true; descriptor: RuntimeChannelDescriptor } | { ok: false; error: string } {
  if (input.descriptorBytes.byteLength > 64 * 1024) {
    return { ok: false, error: "descriptor too large" };
  }
  const valid = verify(null, input.descriptorBytes, input.publicKey, input.signature);
  if (!valid) return { ok: false, error: "invalid channel signature" };
  try {
    return { ok: true, descriptor: parseChannelDescriptor(input.descriptorBytes) };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export function sha256Hex(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function inRollout(cohortId: string, percent: number): boolean {
  if (percent >= 100) return true;
  if (percent <= 0) return false;
  const hash = createHash("sha256").update(cohortId).digest();
  const bucket = hash[0]! % 100;
  return bucket < percent;
}
