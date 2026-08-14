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

  list(): Promise<DelegationTeam[]> {
    return api().listTeams();
  },

  get(id: string): Promise<DelegationTeam | undefined> {
    return api().getTeam(id);
  },

  create(input: UpsertDelegationTeamInput): Promise<DelegationTeam> {
    return api().createTeam(input);
  },

  update(
    id: string,
    patch: UpdateDelegationTeamPatch
  ): Promise<DelegationTeam | undefined> {
    return api().updateTeam(id, patch);
  },

  delete(id: string): Promise<boolean> {
    return api().deleteTeam(id);
  },

  createRun(input: {
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

  approveWrite(input: {
    runId: string;
    approvalId: string;
    approved: boolean;
  }): Promise<boolean> {
    return wfApi().approveDelegateWrite(input);
  },

  getRun(id: string): Promise<unknown> {
    return api().getRun(id);
  },

  getRunByConversation(
    conversationId: string
  ): Promise<DelegationRunRow | undefined> {
    return api().getRunByConversation(conversationId);
  },

  listEvents(runId: string): Promise<unknown[]> {
    return api().listEvents(runId);
  },

  listPendingApprovals(
    runId: string
  ): Promise<Array<{ approvalId: string; runId: string }>> {
    return api().listPendingApprovals(runId);
  },

  stopRun(runId: string): Promise<boolean> {
    return api().stopRun(runId);
  },

  pauseRun(runId: string): Promise<boolean> {
    return api().pauseRun(runId);
  },

  resumeRun(runId: string): Promise<boolean> {
    return api().resumeRun(runId);
  },

  hasRunForConversation(conversationId: string): Promise<boolean> {
    return api().hasRunForConversation(conversationId);
  },

  followUp(input: {
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
