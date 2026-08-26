export type RuntimeHostId = "freebuddy-desktop" | "freebuddy-cli" | (string & {});

export interface RuntimeHostEnvironment {
  hostId: RuntimeHostId;
  hostVersion: string;
  hostApiVersion: string;
  hostCapabilities: readonly string[];
  dataDir: string;
  bundledRuntimePath?: string;
  allowUnsignedDevelopmentRuntime: boolean;
  launcher: RuntimeProcessLauncher;
  http: RuntimeHttpClient;
  trustedKeys: RuntimeTrustedKeyStore;
  clock: { now(): Date; nowIso(): string };
  update?: {
    baseUrl?: string;
    enabled?: boolean;
  };
}

export interface RuntimeProcessHandle {
  pid?: number;
  send(message: unknown): void;
  onMessage(handler: (message: unknown) => void): () => void;
  onExit(handler: (code: number | null) => void): () => void;
  kill(): void;
}

export interface RuntimeProcessLauncher {
  launch(input: {
    entryPath: string;
    cwd?: string;
    env?: Record<string, string>;
  }): RuntimeProcessHandle;
}

export interface RuntimeHttpClient {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

export interface RuntimeTrustedKeyStore {
  get(keyId: string): string | undefined;
  list(): Array<{ keyId: string; publicKey: string }>;
}

export interface RuntimeHostApi {
  invoke(method: string, params: unknown, meta?: { idempotencyKey?: string }): Promise<unknown>;
}

export interface RuntimeStatusSnapshot {
  hostId: string;
  hostVersion: string;
  hostApiVersion: string;
  bundledRuntimePath: string | null;
  activeVersion: string | null;
  pendingVersion: string | null;
  lastKnownGoodVersion: string | null;
  channel: string;
  lastCheckedAt: string | null;
  blockedVersions: Record<string, { reason: string; failedAt: string }>;
  lastError?: string | null;
}

export interface RuntimeManager {
  status(): Promise<RuntimeStatusSnapshot>;
  prepare(version?: string): Promise<void>;
  activate(version: string): Promise<void>;
  rollback(): Promise<void>;
  shutdown(): Promise<void>;
  check(): Promise<{ available: boolean; version?: string; reason?: string }>;
  setChannel(channel: "stable" | "beta" | "development"): Promise<void>;
}
