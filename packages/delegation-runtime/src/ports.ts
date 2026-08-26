import type {
  DelegationEvent,
  DelegationEventStatus,
  DelegationPolicy,
  DelegationResult,
  DelegationRosterEntry,
  DelegationRunRow,
  DelegationTeam,
  DelegationVerdict
} from "@freebuddy/protocol/delegation";
import type {
  AgentExecutor,
  Clock,
  EventPublisher,
  IdGenerator,
  SkillResolver
} from "@freebuddy/agent-runtime";

export interface InsertDelegationEventInput {
  runId: string;
  parentEventId: string | null;
  agentId: string;
  agentName: string;
  roleLabel: string;
  taskText: string;
  depth: number;
  canWrite: boolean;
  status: DelegationEventStatus;
}

export interface DelegationRunRepository {
  createRun(input: {
    id?: string;
    conversationId?: string | null;
    name?: string;
    goal: string;
    status: string;
    cwd?: string | null;
    teamId?: string | null;
    teamSnapshotJson?: string | null;
    runtimeVersion?: string | null;
    runtimeApiVersion?: string | null;
  }): DelegationRunRow;
  getRun(id: string): DelegationRunRow | undefined;
  setStatus(
    id: string,
    status: string,
    options?: { allowReopen?: boolean; endedAt?: string | null }
  ): boolean;
  insertEvent(input: InsertDelegationEventInput): string;
  updateEvent(id: string, patch: Partial<DelegationEvent>): void;
  transitionEvent(
    id: string,
    to: DelegationEventStatus,
    resultSummary?: string | null,
    options?: { allowReopen?: boolean }
  ): boolean;
  getEvent(id: string): DelegationEvent | undefined;
  listEvents(runId: string): DelegationEvent[];
  listPendingChildEvents(runId: string, parentEventId: string): DelegationEvent[];
  countActiveDelegateLeaves(runId: string): number;
  cancelActiveEvents(runId: string, reason?: string): string[];
  getOwnerId?(runId: string): string | undefined;
}

export interface ApprovalPort {
  request(input: {
    runId: string;
    teammate: DelegationRosterEntry;
    reason?: string;
  }): Promise<boolean>;
}

export interface DelegationRuntimePorts {
  repository: DelegationRunRepository;
  executor: AgentExecutor;
  events: EventPublisher;
  approval: ApprovalPort;
  clock: Clock;
  ids: IdGenerator;
  skills: SkillResolver;
  resolveAgent: (agentId: string) =>
    | {
        adapter: string;
        agentName: string;
        binary?: string;
        extraArgs?: string[];
        env?: Record<string, string>;
        skillIds?: string[];
      }
    | undefined;
  getTeam: (id: string) => DelegationTeam | undefined;
  abort?: AbortSignal;
  yieldSession?: (sessionId: string) => void;
  killSession?: (sessionId: string) => void;
  runAsOwner?: <T>(ownerId: string, fn: () => Promise<T> | T) => Promise<T> | T;
}

export type {
  DelegationEvent,
  DelegationPolicy,
  DelegationResult,
  DelegationVerdict
};
