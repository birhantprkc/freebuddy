export const RUNTIME_RPC_VERSION = 1 as const;
export const RUNTIME_MANIFEST_SCHEMA_VERSION = 1 as const;
export const RUNTIME_STATE_SCHEMA_VERSION = 1 as const;
export const HOST_API_VERSION = "1.0.0";
export const RUNTIME_BUNDLE_ID = "dev.freebuddy.runtime";

export type RuntimeHostId = "freebuddy-desktop" | "freebuddy-cli" | (string & {});

export type RuntimeRpcKind = "request" | "response" | "event" | "error";

export interface RuntimeRpcError {
  code: string;
  message: string;
  retryable?: boolean;
  details?: unknown;
}

export interface RuntimeRpcFrame {
  rpcVersion: typeof RUNTIME_RPC_VERSION;
  id: string;
  kind: RuntimeRpcKind;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: RuntimeRpcError;
  event?: string;
  payload?: unknown;
  correlationId?: string;
  idempotencyKey?: string;
  attempt?: number;
}

export interface RuntimeHelloRequest {
  hostId: RuntimeHostId;
  hostVersion: string;
  hostApiVersion: string;
  hostCapabilities: readonly string[];
  rpcVersion: number;
  allowUnsignedDevelopmentRuntime?: boolean;
}

export interface RuntimeHelloResponse {
  runtimeVersion: string;
  rpcVersion: number;
  nodeVersion: string;
  bundleId: string;
  hostApiRange: string;
  requiredHostCapabilities: readonly string[];
  providedCapabilities: readonly string[];
}

export interface RuntimeReadyEvent {
  runtimeVersion: string;
  pid?: number;
}

export interface RuntimeHealthSnapshot {
  ok: boolean;
  runtimeVersion: string;
  uptimeMs: number;
  activeRuns: number;
}

export interface RuntimeManifest {
  schemaVersion: typeof RUNTIME_MANIFEST_SCHEMA_VERSION;
  bundleId: string;
  version: string;
  rpcVersion: number;
  engine: { node: string };
  hostApi: string;
  entry: string;
  keyId: string;
  publishedAt: string;
  providesCapabilities: readonly string[];
  requiresHostCapabilities: readonly string[];
}

export interface RuntimeChecksums {
  files: Record<string, string>;
}

export interface RuntimeChannelDescriptor {
  schemaVersion: 1;
  channel: "stable" | "beta" | "development";
  bundleId: string;
  version: string;
  hostApi: string;
  archiveUrl: string;
  archiveSha256: string;
  archiveBytes: number;
  publishedAt: string;
  keyId?: string;
  revokedVersions?: readonly string[];
  killSwitch?: boolean;
  rollout?: { percent: number };
}

export const DEFAULT_RUNTIME_CAPABILITIES = [
  "workflow",
  "delegation",
  "cli-stream"
] as const;

export const DEFAULT_HOST_CAPABILITIES = [
  "agent.execute.v1",
  "workflow.repository.v1",
  "delegation.repository.v1",
  "events.publish.v1"
] as const;
