import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { ensureRuntimeRoot, versionDir } from "./runtimePaths.js";

const require = createRequire(import.meta.url);
const AdmZip = require("adm-zip") as typeof import("adm-zip");

const MAX_FILES = 4000;
const MAX_TOTAL = 80 * 1024 * 1024;

export function installRuntimeArchive(
  dataDir: string,
  version: string,
  archiveBytes: Buffer
): { ok: true; dir: string } | { ok: false; error: string } {
  ensureRuntimeRoot(dataDir);
  const dest = versionDir(dataDir, version);
  if (fs.existsSync(dest)) return { ok: true, dir: dest };

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
  fs.renameSync(tmp, dest);
  return { ok: true, dir: dest };
}
