import fs from "node:fs";
import path from "node:path";
import type { RuntimeHostEnvironment } from "./ports.js";
import { versionDir } from "./runtimePaths.js";

export function resolveRuntimeEntryPath(
  environment: RuntimeHostEnvironment,
  version: string
): string | null {
  const candidates: string[] = [];
  if (version === "bundled") {
    if (environment.bundledRuntimePath) {
      candidates.push(path.join(environment.bundledRuntimePath, "runtime", "index.mjs"));
      candidates.push(environment.bundledRuntimePath);
    }
  } else {
    const dir = versionDir(environment.dataDir, version);
    candidates.push(path.join(dir, "runtime", "index.mjs"));
    candidates.push(dir);
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}
