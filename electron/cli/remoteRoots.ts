import { getUserById, getUserRoots } from "./users.js";
import { resolveWorkspaceRoots } from "../shared/workspaceRoots.js";

/**
 * Directories a caller may reach over the remote bridge.
 *
 * `resolveWorkspaceRoots([])` falls back to the host home directory. That is
 * the historical desktop behaviour and stays correct for the owner, but for a
 * member it would mean "no directories assigned" silently grants the whole
 * home folder — the opposite of what the admin configured. Members therefore
 * get an empty set until the owner assigns roots to them.
 */
export function remoteRootsForUser(userId: string | null | undefined): string[] {
  if (!userId) return resolveWorkspaceRoots([]);
  const roots = getUserRoots(userId);
  if (roots.length > 0) return resolveWorkspaceRoots(roots);
  return getUserById(userId)?.isOwner ? resolveWorkspaceRoots([]) : [];
}

/** True when the user browses the host home directory by default. */
export function usesDefaultHomeRoots(userId: string | null | undefined): boolean {
  if (!userId) return true;
  if (getUserRoots(userId).length > 0) return false;
  return getUserById(userId)?.isOwner === true;
}
