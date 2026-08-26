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

export interface DelegationRunRepository {
  createRun(input: {
    id: string;
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
  setStatus(id: string, status: string, endedAt?: string | null): void;
  insertEvent(event: DelegationEvent): void;
  updateEvent(id: string, patch: Partial<DelegationEvent>): void;
  transitionEvent(
    id: string,
    from: DelegationEventStatus[] | DelegationEventStatus,
    to: DelegationEventStatus,
    patch?: Partial<DelegationEvent>
  ): boolean;
  listEvents(runId: string): DelegationEvent[];
  cancelActiveEvents(runId: string): void;
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
}

export type {
  DelegationEvent,
  DelegationPolicy,
  DelegationResult,
  DelegationVerdict
};
