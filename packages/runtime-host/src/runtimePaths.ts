import fs from "node:fs";
import path from "node:path";

export function runtimeRoot(dataDir: string): string {
  return path.join(dataDir, "runtimes");
}

export function versionDir(dataDir: string, version: string): string {
  return path.join(runtimeRoot(dataDir), "versions", version);
}

export function statePath(dataDir: string): string {
  return path.join(runtimeRoot(dataDir), "runtime-state.json");
}

export function lockPath(dataDir: string): string {
  return path.join(runtimeRoot(dataDir), "runtime.lock");
}

export function ensureRuntimeRoot(dataDir: string): void {
  fs.mkdirSync(path.join(runtimeRoot(dataDir), "versions"), { recursive: true });
  fs.mkdirSync(path.join(runtimeRoot(dataDir), "downloads"), { recursive: true });
}
