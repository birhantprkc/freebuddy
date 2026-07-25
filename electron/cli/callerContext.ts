import { AsyncLocalStorage } from "node:async_hooks";

interface Caller {
  userId: string;
  isAdmin: boolean;
}

const callerStorage = new AsyncLocalStorage<Caller>();

export function runAsCaller<T>(userId: string, fn: () => T, isAdmin = false): T {
  return callerStorage.run({ userId, isAdmin }, fn);
}

export function getCallerUserId(): string | null {
  return callerStorage.getStore()?.userId ?? null;
}

export function isCallerAdmin(): boolean {
  return callerStorage.getStore()?.isAdmin ?? false;
}
