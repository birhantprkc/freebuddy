import fs from "node:fs";
import path from "node:path";
import { createHash, sign, createPrivateKey } from "node:crypto";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { resolveRuntimePackVersion, runtimeReleaseRepo, runtimeReleaseTag } from "./runtime-release-lib.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packDir = path.join(root, ".build", "runtime-pack");
const outDir = path.join(root, ".build", "runtime-release");
const version = resolveRuntimePackVersion();
const repo = runtimeReleaseRepo();
const tag = runtimeReleaseTag(version);
const zipName = `freebuddy-runtime-${version}.zip`;
const channel = process.env.RUNTIME_RELEASE_CHANNEL || "stable";

if (!fs.existsSync(path.join(packDir, "runtime", "index.mjs"))) {
  throw new Error("runtime pack missing; run npm run runtime:build first");
}
if (!fs.existsSync(path.join(packDir, "manifest.sig"))) {
  throw new Error("runtime pack is unsigned; run npm run runtime:sign first");
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const zip = new AdmZip();
for (const file of ["manifest.json", "manifest.sig", "checksums.json", "LICENSES.txt", "runtime/index.mjs"]) {
  const full = path.join(packDir, file);
  if (!fs.existsSync(full)) throw new Error(`missing pack file: ${file}`);
  zip.addFile(file, fs.readFileSync(full));
}
const zipBytes = zip.toBuffer();
fs.writeFileSync(path.join(outDir, zipName), zipBytes);

const descriptor = {
  schemaVersion: 1,
  channel,
  bundleId: "dev.freebuddy.runtime",
  version,
  hostApi: ">=1.0.0 <2.0.0",
  archiveUrl: `https://github.com/${repo}/releases/download/${tag}/${zipName}`,
  archiveSha256: createHash("sha256").update(zipBytes).digest("hex"),
  archiveBytes: zipBytes.byteLength,
  publishedAt: new Date().toISOString(),
  keyId: process.env.RUNTIME_SIGNING_KEY_ID || "runtime-dev"
};
const descriptorText = `${JSON.stringify(descriptor, null, 2)}\n`;
fs.writeFileSync(path.join(outDir, `${channel}.json`), descriptorText);

const fromEnv = process.env.RUNTIME_SIGNING_PRIVATE_KEY?.replace(/\\n/g, "\n")?.trim();
if (
  !fromEnv &&
  process.env.CI &&
  /^runtime-v\d+\.\d+\.\d+$/.test(process.env.GITHUB_REF_NAME ?? "")
) {
  throw new Error("RUNTIME_SIGNING_PRIVATE_KEY is required to package tagged runtime releases");
}
const localPem = path.join(root, ".build", "runtime-keys", "runtime-dev.pem");
if (!fromEnv && !fs.existsSync(localPem)) {
  throw new Error("missing RUNTIME_SIGNING_PRIVATE_KEY and local development key");
}
const keyPem = fromEnv || fs.readFileSync(localPem, "utf8");
const signature = sign(null, Buffer.from(descriptorText), createPrivateKey(keyPem));
fs.writeFileSync(path.join(outDir, `${channel}.json.sig`), signature);

console.log(`runtime release staged at ${outDir}`);
console.log(`  ${zipName}`);
console.log(`  ${channel}.json (${descriptor.archiveSha256})`);
