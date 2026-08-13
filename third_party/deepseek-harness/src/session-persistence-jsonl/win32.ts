/**
 * FreeBuddy fork of deepseek-harness JSONL Windows publish helpers.
 *
 * Drop this file onto
 * `packages/session/session-persistence-jsonl/src/win32.ts`
 * in a git fork of https://github.com/deepseek-ai/deepseek-harness
 * when that repository exists.
 *
 * Official code loaded a native Win32 binding to publish the first session
 * log. That aborts Windows Electron children with STATUS_ACCESS_VIOLATION.
 * Keep the exported names so `index.ts` is unchanged; implement them with
 * Node fs (rename, copy fallback, mkdir).
 *
 * @module dsh-session-persistence-jsonl/win32
 */

import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";

/**
 * Publish `existing` at `replacement`. Prefer an atomic rename; fall back to
 * copy+remove when the volume rejects rename (EXDEV / EPERM).
 */
export async function publishNewFileWin32(
  existing: string,
  replacement: string
): Promise<void> {
  try {
    await rename(existing, replacement);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code !== "EXDEV" && code !== "EPERM") throw error;
    const info = await stat(existing);
    if (info.isDirectory()) {
      await mkdir(replacement, { recursive: true });
      await rm(existing, { recursive: true, force: true });
      return;
    }
    await copyFile(existing, replacement);
    await rm(existing, { force: true });
  }
}

/** Create `target` and missing ancestors with Node mkdir. */
export async function ensureDurableDirectoryWin32(target: string): Promise<void> {
  await mkdir(target, { recursive: true });
}
