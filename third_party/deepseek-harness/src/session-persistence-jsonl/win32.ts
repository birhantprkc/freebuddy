/**
 * Windows publish helpers for the JSONL backend.
 *
 * POSIX publishes a newly-created log by creating a directory entry and then
 * fsyncing the parent directory. Windows does not expose that parent-directory
 * fsync contract through Node. The previous implementation loaded a native
 * Win32 binding and called `MoveFileExW(..., MOVEFILE_WRITE_THROUGH)`. That
 * aborts some Windows Electron/Node hosts with STATUS_ACCESS_VIOLATION
 * (0xC0000005) the first time a session is materialized.
 *
 * Keep the exported names so `index.ts` is unchanged. Publish with Node fs:
 * rename when the volume allows it, copy+remove on EXDEV/EPERM, mkdir for
 * directories.
 *
 * @module dsh-session-persistence-jsonl/win32
 */

import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises'

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code
}

/**
 * Publish `existing` at `replacement`. The destination must not already exist
 * on the happy path; EXDEV/EPERM fall back to copy+remove.
 * @param existing - the synced staging path to move.
 * @param replacement - the final path.
 */
export async function publishNewFileWin32(existing: string, replacement: string): Promise<void> {
  try {
    await rename(existing, replacement)
  } catch (error) {
    const code = errorCode(error)
    if (code !== 'EXDEV' && code !== 'EPERM') throw error
    const info = await stat(existing)
    if (info.isDirectory()) {
      await mkdir(replacement, { recursive: true })
      await rm(existing, { recursive: true, force: true })
      return
    }
    await copyFile(existing, replacement)
    await rm(existing, { force: true })
  }
}

/**
 * Create `target` and its missing ancestors.
 * @param target - the absolute directory path to create when absent.
 */
export async function ensureDurableDirectoryWin32(target: string): Promise<void> {
  await mkdir(target, { recursive: true })
}
