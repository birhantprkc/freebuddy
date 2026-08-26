import fs from "node:fs";
import path from "node:path";
import { verify } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packDir = path.join(root, ".build", "runtime-pack");
const pubPath = path.join(root, ".build", "runtime-keys", "runtime-dev.pub");
const manifest = fs.readFileSync(path.join(packDir, "manifest.json"));
const signature = fs.readFileSync(path.join(packDir, "manifest.sig"));
const publicKey = fs.readFileSync(pubPath);
if (!verify(null, manifest, publicKey, signature)) {
  throw new Error("runtime pack signature invalid");
}
const parsed = JSON.parse(manifest.toString("utf8"));
if (parsed.bundleId !== "dev.freebuddy.runtime") {
  throw new Error("unexpected bundle id");
}
console.log("verified runtime pack", parsed.version);
