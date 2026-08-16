export interface DelegationRosterEntry {
  id: string;
  label: string;
  agentId: string;
  model?: string;
  modelOptionId?: string;
  capability: string;
  canWrite: boolean;
  skillIds?: string[];
}

export interface DelegationPolicy {
  allowWrites: boolean;
  requireApprovalBeforeDelegateWrite: boolean;
  maxDepth: number;
  delegateTimeoutMs: number;
  maxConcurrentDelegates: number;
  stopOnDelegateFailure: boolean;
}

export interface DelegationTeam {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  enabled: boolean;
  source: "builtin" | "user";
  kind: "delegation";
  entryRoleId: string;
  roster: DelegationRosterEntry[];
  policy: DelegationPolicy;
  createdAt: string;
  updatedAt: string;
}

export type DelegationEventStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "timeout"
  | "cancelled";

export type DelegationVerdict = "pass" | "needs_changes" | "fail";

export interface DelegationArtifact {
  kind: "file" | "url" | "text";
  label: string;
  uri?: string;
}

/** Versioned terminal result contract; resultSummary remains as a v0 compatibility field. */
export interface DelegationResult {
  schemaVersion: 1;
  status: Exclude<DelegationEventStatus, "pending" | "running">;
  summary: string;
  exitCode: number | null;
  error: {
    code: "delegate_failed" | "delegate_timeout" | "delegate_cancelled";
    message: string;
    retryable: boolean;
  } | null;
  artifacts: DelegationArtifact[];
  verdict: DelegationVerdict | null;
  verdictSummary: string | null;
}

export interface DelegationEvent {
  id: string;
  runId: string;
  parentEventId: string | null;
  agentId: string;
  agentName: string;
  roleLabel: string;
  taskText: string;
  depth: number;
  status: DelegationEventStatus;
  resultSummary: string | null;
  result: DelegationResult | null;
  canWrite: boolean;
  acceptedAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  verdict: DelegationVerdict | null;
  verdictSummary: string | null;
}

export function defaultDelegationPolicy(): DelegationPolicy {
  return {
    allowWrites: true,
    requireApprovalBeforeDelegateWrite: true,
    maxDepth: 3,
    delegateTimeoutMs: 600000,
    maxConcurrentDelegates: 1,
    stopOnDelegateFailure: false,
  };
}
