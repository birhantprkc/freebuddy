const sessionOwners = new Map<string, string>();

export function recordSessionOwner(sessionId: string, userId: string | null): void {
  if (!sessionId || !userId) return;
  sessionOwners.set(sessionId, userId);
}

export function clearSessionOwner(sessionId: string): void {
  sessionOwners.delete(sessionId);
}

export function getSessionOwner(sessionId: string): string | null {
  return sessionOwners.get(sessionId) ?? null;
}
