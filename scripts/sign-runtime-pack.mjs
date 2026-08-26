import fs from "node:fs";
import path from "node:path";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packDir = path.join(root, ".build", "runtime-pack");
const keyDir = path.join(root, ".build", "runtime-keys");
fs.mkdirSync(keyDir, { recursive: true });

const privPath = path.join(keyDir, "runtime-dev.pem");
const pubPath = path.join(keyDir, "runtime-dev.pub");
if (!fs.existsSync(privPath)) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  fs.writeFileSync(privPath, privateKey.export({ type: "pkcs8", format: "pem" }));
  fs.writeFileSync(pubPath, publicKey.export({ type: "spki", format: "pem" }));
}

const manifest = fs.readFileSync(path.join(packDir, "manifest.json"));
const privateKey = fs.readFileSync(privPath);
const signature = sign(null, manifest, privateKey);
fs.writeFileSync(path.join(packDir, "manifest.sig"), signature);
const ok = verify(null, manifest, fs.readFileSync(pubPath), signature);
if (!ok) throw new Error("failed to sign runtime manifest");
console.log("signed", path.join(packDir, "manifest.sig"));
