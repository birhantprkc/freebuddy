const suppressed = new Set<string>();

export function addInactivitySuppression(sessionId: string): void {
  suppressed.add(sessionId);
}

export function removeInactivitySuppression(sessionId: string): void {
  suppressed.delete(sessionId);
}

export function isInactivitySuppressed(sessionId: string): boolean {
  return suppressed.has(sessionId);
}

export function clearInactivitySuppression(): void {
  suppressed.clear();
}
