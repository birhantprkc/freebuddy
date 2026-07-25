/**
 * Failure throttling for /api/login.
 *
 * The endpoint is reachable by anyone on the LAN and passwords are the only
 * barrier, so unlimited attempts make an offline-quality guessing attack
 * possible online. Counters live in memory: a restart clears them, which is
 * acceptable because restarting the desktop app is not something an attacker
 * can trigger remotely.
 */

const FREE_ATTEMPTS = 5;
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 15 * 60 * 1000;
/** Counters reset once the attacker goes quiet for this long. */
const IDLE_RESET_MS = 30 * 60 * 1000;

interface Attempts {
  failures: number;
  lockedUntil: number;
  lastFailureAt: number;
}

const attempts = new Map<string, Attempts>();

export function loginAttemptKey(ip: string | null, username: string): string {
  return `${ip ?? "unknown"}|${username.trim().toLowerCase()}`;
}

function currentEntry(key: string, now: number): Attempts | undefined {
  const entry = attempts.get(key);
  if (!entry) return undefined;
  if (now - entry.lastFailureAt > IDLE_RESET_MS) {
    attempts.delete(key);
    return undefined;
  }
  return entry;
}

export interface LoginGate {
  allowed: boolean;
  retryAfterMs: number;
}

export function checkLoginAllowed(key: string, now = Date.now()): LoginGate {
  const entry = currentEntry(key, now);
  if (!entry || now >= entry.lockedUntil) return { allowed: true, retryAfterMs: 0 };
  return { allowed: false, retryAfterMs: entry.lockedUntil - now };
}

/** Returns the lockout applied to this attempt, in milliseconds. */
export function recordLoginFailure(key: string, now = Date.now()): number {
  const entry = currentEntry(key, now) ?? {
    failures: 0,
    lockedUntil: 0,
    lastFailureAt: now
  };
  entry.failures += 1;
  entry.lastFailureAt = now;
  const over = entry.failures - FREE_ATTEMPTS;
  const delay =
    over <= 0 ? 0 : Math.min(BASE_DELAY_MS * 2 ** (over - 1), MAX_DELAY_MS);
  entry.lockedUntil = delay > 0 ? now + delay : 0;
  attempts.set(key, entry);
  return delay;
}

export function recordLoginSuccess(key: string): void {
  attempts.delete(key);
}

export function resetLoginLimits(): void {
  attempts.clear();
}
