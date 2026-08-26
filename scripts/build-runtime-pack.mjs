import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveRuntimePackVersion } from "./runtime-release-lib.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, ".build", "runtime-pack");
const packVersion = resolveRuntimePackVersion();
const keyId = process.env.RUNTIME_SIGNING_KEY_ID || "runtime-dev";
const publishedAt = process.env.RUNTIME_PACK_PUBLISHED_AT || new Date().toISOString();

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, "runtime"), { recursive: true });

const packTsconfig = {
  files: [],
  references: [{ path: path.join(root, "tsconfig.packages.json") }]
};
void packTsconfig;

const build = spawnSync("npx", ["esbuild", "packages/runtime-entry/src/bootstrap.ts", "--bundle", "--platform=node", "--format=esm", "--outfile=.build/runtime-pack/runtime/index.mjs"], {
  cwd: root,
  stdio: "inherit"
});
if (build.status !== 0) {
  // Fallback: copy compiled runtime-entry bootstrap when esbuild cannot resolve workspace graph yet.
  const entry = path.join(root, "packages/runtime-entry/dist/bootstrap.js");
  if (!fs.existsSync(entry)) {
    process.exit(build.status ?? 1);
  }
  fs.copyFileSync(entry, path.join(outDir, "runtime/index.mjs"));
}

const bundle = fs.readFileSync(path.join(outDir, "runtime/index.mjs"), "utf8");
if (bundle.includes('from "electron"') || bundle.includes("better-sqlite3")) {
  throw new Error("runtime pack contains forbidden host imports");
}

const manifest = {
  schemaVersion: 1,
  bundleId: "dev.freebuddy.runtime",
  version: packVersion,
  rpcVersion: 1,
  engine: { node: ">=22.0.0" },
  hostApi: ">=1.0.0 <2.0.0",
  entry: "runtime/index.mjs",
  keyId,
  publishedAt,
  providesCapabilities: ["workflow", "delegation", "cli-stream"],
  requiresHostCapabilities: [
    "agent.execute.v1",
    "workflow.repository.v1",
    "delegation.repository.v1",
    "events.publish.v1"
  ]
};

const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
fs.writeFileSync(path.join(outDir, "manifest.json"), manifestText);
const checksums = {
  files: {
    "manifest.json": createHash("sha256").update(manifestText).digest("hex"),
    "runtime/index.mjs": createHash("sha256")
      .update(fs.readFileSync(path.join(outDir, "runtime/index.mjs")))
      .digest("hex")
  }
};
fs.writeFileSync(path.join(outDir, "checksums.json"), `${JSON.stringify(checksums, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, "LICENSES.txt"), "FreeBuddy runtime pack. See repository LICENSE.\n");
console.log(`runtime pack written to ${outDir}`);
