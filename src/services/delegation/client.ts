import type {
  DelegationTeam,
  DelegationRosterEntry,
  DelegationPolicy
} from "@/services/workflowTeams/types";

export interface UpsertDelegationTeamInput {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  enabled: boolean;
  source: "builtin" | "user";
  entryRoleId: string;
  roster: DelegationRosterEntry[];
  policy: DelegationPolicy;
}

export interface UpdateDelegationTeamPatch {
  name?: string;
  description?: string | null;
  icon?: string | null;
  enabled?: boolean;
  entryRoleId?: string;
  roster?: DelegationRosterEntry[];
  policy?: DelegationPolicy;
}

export interface DelegationRunRow {
  id: string;
  kind: "delegation";
  conversationId: string | null;
  name?: string;
  goal: string;
  status: string;
  cwd: string | null;
  teamId: string | null;
  teamSnapshotJson: string | null;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
}

export type DelegationEventStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "timeout"
  | "cancelled";

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
  artifacts: Array<{ kind: "file" | "url" | "text"; label: string; uri?: string }>;
  verdict: "pass" | "needs_changes" | "fail" | null;
  verdictSummary: string | null;
}

export interface DelegationEventRow {
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
  verdict: "pass" | "needs_changes" | "fail" | null;
  verdictSummary: string | null;
}

export type DelegationRunFinishedEvent = {
  runId: string;
  conversationId?: string;
  status: string;
  name: string;
};

function api() {
  const delegation = window.freebuddy?.delegation;
  if (!delegation) throw new Error("delegation bridge unavailable");
  return delegation;
}

function wfApi() {
  const wf = window.freebuddy?.workflow;
  if (!wf) throw new Error("workflow bridge unavailable");
  return wf;
}

export const delegationClient = {
  isAvailable(): boolean {
    return Boolean(window.freebuddy?.delegation);
  },

  async list(): Promise<DelegationTeam[]> {
    if (!this.isAvailable()) return [];
    return api().listTeams();
  },

  async get(id: string): Promise<DelegationTeam | undefined> {
    if (!this.isAvailable()) return undefined;
    return api().getTeam(id);
  },

  async create(input: UpsertDelegationTeamInput): Promise<DelegationTeam> {
    return api().createTeam(input);
  },

  async update(
    id: string,
    patch: UpdateDelegationTeamPatch
  ): Promise<DelegationTeam | undefined> {
    return api().updateTeam(id, patch);
  },

  async delete(id: string): Promise<boolean> {
    return api().deleteTeam(id);
  },

  async createRun(input: {
    teamId: string;
    goal: string;
    cwd?: string;
    conversationId?: string;
  }): Promise<
    | { ok: true; runId: string; conversationId: string }
    | { ok: false; error: string }
  > {
    return wfApi().createDelegationRun(input);
  },

  async approveWrite(input: {
    runId: string;
    approvalId: string;
    approved: boolean;
  }): Promise<boolean> {
    return wfApi().approveDelegateWrite(input);
  },

  async getRun(id: string): Promise<unknown> {
    if (!this.isAvailable()) return undefined;
    return api().getRun(id);
  },

  async getRunByConversation(
    conversationId: string
  ): Promise<DelegationRunRow | undefined> {
    if (!this.isAvailable()) return undefined;
    return api().getRunByConversation(conversationId);
  },

  async listEvents(runId: string): Promise<DelegationEventRow[]> {
    if (!this.isAvailable()) return [];
    return api().listEvents(runId);
  },

  async listPendingApprovals(
    runId: string
  ): Promise<Array<{ approvalId: string; runId: string }>> {
    if (!this.isAvailable()) return [];
    return api().listPendingApprovals(runId);
  },

  async stopRun(runId: string): Promise<boolean> {
    if (!this.isAvailable()) return false;
    return api().stopRun(runId);
  },

  async pauseRun(runId: string): Promise<boolean> {
    if (!this.isAvailable()) return false;
    return api().pauseRun(runId);
  },

  async resumeRun(runId: string): Promise<boolean> {
    if (!this.isAvailable()) return false;
    return api().resumeRun(runId);
  },

  async hasRunForConversation(conversationId: string): Promise<boolean> {
    if (!this.isAvailable()) return false;
    return api().hasRunForConversation(conversationId);
  },

  async followUp(input: {
    conversationId: string;
    prompt: string;
  }): Promise<
    { ok: true; runId: string } | { ok: false; error: string; code?: string }
  > {
    return api().followUp(input);
  },

  onChanged(cb: () => void): (() => void) | undefined {
    return window.freebuddy?.delegation?.onChanged?.(cb);
  },

  onRunFinished(
    cb: (event: DelegationRunFinishedEvent) => void
  ): (() => void) | undefined {
    return window.freebuddy?.delegation?.onRunFinished?.(cb);
  }
};
