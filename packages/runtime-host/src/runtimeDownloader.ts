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

  const timeoutMs = input.timeoutMs ?? 5 * 60 * 1000;
  const deadline = Date.now() + timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let url = input.url;
  let response: Response | undefined;
  try {
    for (let i = 0; i <= MAX_REDIRECTS; i += 1) {
      if (Date.now() >= deadline) throw new Error("download timeout");
      response = await input.http.fetch(url, {
        headers,
        signal: controller.signal,
        redirect: "manual"
      });
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
  } finally {
    clearTimeout(timer);
  }
}

export function archiveHash(bytes: Buffer): string {
  return sha256(bytes);
}
