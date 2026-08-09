const refsBySession = new Map<string, number>();

export function addInactivitySuppression(sessionId: string): void {
  refsBySession.set(sessionId, (refsBySession.get(sessionId) ?? 0) + 1);
}

export function removeInactivitySuppression(sessionId: string): void {
  const next = (refsBySession.get(sessionId) ?? 0) - 1;
  if (next <= 0) refsBySession.delete(sessionId);
  else refsBySession.set(sessionId, next);
}

export function isInactivitySuppressed(sessionId: string): boolean {
  return (refsBySession.get(sessionId) ?? 0) > 0;
}

export function clearInactivitySuppression(): void {
  refsBySession.clear();
}
