import type { RuntimeProcessHandle } from "./ports.js";

export interface VersionRoute {
  version: string;
  pinned: boolean;
}

export interface RuntimeVersionRouter {
  route(input: { runtimeVersion?: string | null; terminal?: boolean }): VersionRoute;
  retain(version: string): void;
  release(version: string): void;
  attach(version: string, handle: RuntimeProcessHandle): void;
  handle(version: string): RuntimeProcessHandle | undefined;
  shutdown(): void;
  referencedVersions(): string[];
}

export function createRuntimeVersionRouter(activeVersion: () => string): RuntimeVersionRouter {
  const retained = new Map<string, number>();
  const pool = new Map<string, RuntimeProcessHandle>();

  return {
    route(input) {
      const pinned = Boolean(input.runtimeVersion && input.runtimeVersion.length > 0);
      const version = pinned ? input.runtimeVersion! : activeVersion();
      return { version, pinned };
    },
    retain(version) {
      retained.set(version, (retained.get(version) ?? 0) + 1);
    },
    release(version) {
      const next = (retained.get(version) ?? 1) - 1;
      if (next <= 0) retained.delete(version);
      else retained.set(version, next);
    },
    attach(version, handle) {
      pool.set(version, handle);
    },
    handle(version) {
      return pool.get(version);
    },
    shutdown() {
      for (const handle of pool.values()) handle.kill();
      pool.clear();
    },
    referencedVersions() {
      return [...new Set([...retained.keys(), ...pool.keys()])];
    }
  };
}

export function legacyRuntimeVersion(runtimeVersion?: string | null): string {
  return runtimeVersion && runtimeVersion.length > 0 ? runtimeVersion : "bundled";
}
