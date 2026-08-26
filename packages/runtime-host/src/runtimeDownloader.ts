import fs from "node:fs";
import path from "node:path";
import { downloadsDir } from "./runtimePaths.js";
import { sha256 } from "./runtimeVerifier.js";

export interface DownloadResult {
  bytes: Buffer;
  etag: string | null;
  notModified: boolean;
}

const MAX_ARCHIVE = 80 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export async function downloadRuntimeArtifact(input: {
  url: string;
  dataDir: string;
  version: string;
  http: { fetch(url: string, init?: RequestInit): Promise<Response> };
  etag?: string | null;
  timeoutMs?: number;
  maxBytes?: number;
}): Promise<DownloadResult> {
  const destDir = downloadsDir(input.dataDir);
  fs.mkdirSync(destDir, { recursive: true });
  const partial = path.join(destDir, `${input.version}.zip.partial`);
  const headers: Record<string, string> = {};
  if (input.etag) headers["if-none-match"] = input.etag;

  let url = input.url;
  let response: Response | undefined;
  for (let i = 0; i <= MAX_REDIRECTS; i += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 30_000);
    try {
      response = await input.http.fetch(url, { headers, signal: controller.signal, redirect: "manual" });
    } finally {
      clearTimeout(timer);
    }
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      if (!next) throw new Error("redirect without location");
      if (!next.startsWith("https://") && !next.startsWith("http://127.0.0.1")) {
        throw new Error("redirect rejected");
      }
      url = next;
      continue;
    }
    break;
  }
  if (!response) throw new Error("download failed");
  if (response.status === 304) {
    return { bytes: Buffer.alloc(0), etag: input.etag ?? null, notModified: true };
  }
  if (!response.ok) throw new Error(`download failed: ${response.status}`);
  const maxBytes = input.maxBytes ?? MAX_ARCHIVE;
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > maxBytes) throw new Error("response too large");
  const buf = Buffer.from(await response.arrayBuffer());
  if (buf.byteLength > maxBytes) throw new Error("response too large");
  fs.writeFileSync(partial, buf);
  const finalPath = path.join(destDir, `${input.version}.zip`);
  fs.renameSync(partial, finalPath);
  return {
    bytes: buf,
    etag: response.headers.get("etag"),
    notModified: false
  };
}

export function archiveHash(bytes: Buffer): string {
  return sha256(bytes);
}
