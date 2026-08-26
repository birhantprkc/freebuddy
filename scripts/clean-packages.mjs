import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packagesDir = path.join(
  path.dirname(path.dirname(fileURLToPath(import.meta.url))),
  "packages"
);

if (!fs.existsSync(packagesDir)) process.exit(0);

for (const name of fs.readdirSync(packagesDir)) {
  const dist = path.join(packagesDir, name, "dist");
  fs.rmSync(dist, { recursive: true, force: true });
}
