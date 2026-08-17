import type { DelegationEvent } from "../../delegationTeamTypes.js";
import {
  getDelegationEvent,
  isTerminalDelegationStatus,
  listDelegationEvents,
  listPendingChildEvents,
  setDelegationRunStatus,
  updateDelegationEvent
} from "../../delegationRuns.js";
import { buildDelegateWakePrompt } from "../protocol/text.js";
import { resolveEffectiveWakeVerdict } from "../protocol/wakeVerdict.js";
import type { DelegationRosterEntry, DelegationPolicy } from "../../delegationTeamTypes.js";
import {
  createInitialBusState,
  ensureChildNode,
  markChildTurning,
  reduce
} from "./stateMachine.js";
import type { BusEffect, BusState } from "./types.js";

export interface OrchestratorTurnResult {
  summary: string;
  error: string | null;
}

export interface OrchestratorSpawnArgs {
  kind: "task" | "wake" | "followUp";
  nodeId: string;
  prompt: string;
  depth: number;
  selfAgentId: string;
  selfLabel: string;
}

/**
 * Per-run bus orchestrator: owns park/wake decisions via the pure FSM.
 * Agent spawning is injected so DelegationRuntime can keep using runAgentTurn.
 */
export class DelegationOrchestrator {
  private bus: BusState | null = null;
  private eventWaiters = new Map<string, Array<(e: DelegationEvent | undefined) => void>>();
  private killed = false;

  constructor(
    private readonly opts: {
      runId: string;
      roster: DelegationRosterEntry[];
      policy: DelegationPolicy;
      entryRoleId: string;
      spawnTurn: (args: OrchestratorSpawnArgs) => Promise<OrchestratorTurnResult>;
    }
  ) {}

  get state(): BusState | null {
    return this.bus;
  }

  /** Refresh roster/policy after the user edits the team mid-run (e.g. model swap). */
  syncTeamSnapshot(input: {
    roster: DelegationRosterEntry[];
    policy: DelegationPolicy;
    entryRoleId: string;
  }): void {
    this.opts.roster = input.roster;
    this.opts.policy = input.policy;
    this.opts.entryRoleId = input.entryRoleId;
  }

  bindEntry(entryNodeId: string): void {
    this.bus = createInitialBusState({
      runId: this.opts.runId,
      entryNodeId
    });
  }

  noteChildEnqueued(child: {
    childEventId: string;
    parentEventId: string;
    depth: number;
  }): void {
    if (!this.bus) return;
    this.bus = ensureChildNode(this.bus, {
      id: child.childEventId,
      parentId: child.parentEventId,
      depth: child.depth
    });
  }

  noteChildStarted(childEventId: string): void {
    if (!this.bus) return;
    this.bus = markChildTurning(this.bus, childEventId);
  }

  onEventSettled(eventId: string): void {
    const evt = getDelegationEvent(eventId);
    const waiters = this.eventWaiters.get(eventId);
    if (waiters) {
      this.eventWaiters.delete(eventId);
      for (const resolve of waiters) resolve(evt);
    }
    if (!this.bus || !evt?.parentEventId) return;
    const { state, effects } = reduce(this.bus, {
      type: "ChildSettled",
      parentId: evt.parentEventId,
      childId: eventId,
      childStatus: evt.status,
      resultSummary: evt.resultSummary ?? "",
      taskText: evt.taskText,
      roleLabel: evt.roleLabel,
      verdict: evt.verdict,
      verdictSummary: evt.verdictSummary
    });
    this.bus = state;
    // Wake effects for parked parents are consumed by the park loops via waiters;
    // we still apply Mark* effects here.
    this.applyEffects(effects.filter((e) => e.type !== "SpawnWake"));
  }

  awaitEventSettle(eventId: string): Promise<DelegationEvent | undefined> {
    const existing = getDelegationEvent(eventId);
    if (existing && isTerminalDelegationStatus(existing.status)) {
      return Promise.resolve(existing);
    }
    return new Promise((resolve) => {
      const arr = this.eventWaiters.get(eventId) ?? [];
      arr.push(resolve);
      this.eventWaiters.set(eventId, arr);
    });
  }

  raceAnySettle(eventIds: string[]): Promise<DelegationEvent | undefined> {
    if (eventIds.length === 0) throw new Error("raceAnySettle: empty id list");
    if (eventIds.length === 1) return this.awaitEventSettle(eventIds[0]!);
    return Promise.race(eventIds.map((id) => this.awaitEventSettle(id)));
  }

  private applyEffects(effects: BusEffect[]): void {
    for (const effect of effects) {
      switch (effect.type) {
        case "MarkRunCompleted":
          setDelegationRunStatus(this.opts.runId, "completed");
          break;
        case "MarkRunFailed":
          setDelegationRunStatus(this.opts.runId, "failed");
          break;
        case "MarkRunKilled":
          setDelegationRunStatus(this.opts.runId, "killed");
          break;
        case "MarkNodeTerminal":
          updateDelegationEvent(effect.nodeId, {
            status: effect.status,
            resultSummary: effect.summary
          });
          break;
        default:
          break;
      }
    }
  }

  markKilled(): void {
    this.killed = true;
    if (!this.bus) {
      setDelegationRunStatus(this.opts.runId, "killed");
      return;
    }
    const { state, effects } = reduce(this.bus, { type: "RunKilled" });
    this.bus = state;
    this.applyEffects(effects);
  }

  /** Stop park/wake loops without forcing run status to killed (used by pause). */
  interruptLoops(): void {
    this.killed = true;
  }

  clearInterrupt(): void {
    this.killed = false;
  }

  /**
   * Drive a node through turn → park/wake loops until it has no active children
   * and ends a turn without parking.
   */
  async runNodeLoop(opts: {
    nodeId: string;
    depth: number;
    selfAgentId: string;
    selfLabel: string;
    initialPrompt: string;
    kind?: "task" | "followUp";
  }): Promise<OrchestratorTurnResult> {
    if (!this.bus) throw new Error("orchestrator not bound");
    let prompt = opts.initialPrompt;
    let lastError: string | null = null;
    let lastSummary = "";
    let kind: "task" | "wake" | "followUp" = opts.kind ?? "task";

    while (!this.killed) {
      {
        const { state, effects } = reduce(this.bus, {
          type: "TurnStarted",
          nodeId: opts.nodeId
        });
        this.bus = state;
        this.applyEffects(effects);
      }

      const turn = await this.opts.spawnTurn({
        kind,
        nodeId: opts.nodeId,
        prompt,
        depth: opts.depth,
        selfAgentId: opts.selfAgentId,
        selfLabel: opts.selfLabel
      });
      lastError = turn.error;
      lastSummary = turn.summary ?? "";
      if (this.killed) break;

      const pending = listPendingChildEvents(this.opts.runId, opts.nodeId);
      {
        const { state, effects } = reduce(this.bus, {
          type: "TurnEnded",
          nodeId: opts.nodeId,
          error: lastError,
          summary: lastSummary
        });
        this.bus = state;
        // If FSM parked, don't mark terminal yet.
        const parked = state.nodes[opts.nodeId]?.status === "parked";
        if (!parked) {
          this.applyEffects(effects);
          break;
        }
        // Discard MarkRunCompleted if somehow emitted while children exist.
        this.applyEffects(effects.filter((e) => e.type !== "MarkRunCompleted"));
      }

      if (pending.length === 0) {
        // Race: children finished between listPending and TurnEnded reduce.
        // Re-check and complete.
        const still = listPendingChildEvents(this.opts.runId, opts.nodeId);
        if (still.length === 0) {
          const { state, effects } = reduce(this.bus, {
            type: "TurnEnded",
            nodeId: opts.nodeId,
            error: lastError,
            summary: lastSummary
          });
          this.bus = state;
          this.applyEffects(effects);
          break;
        }
      }

      const settled = await this.raceAnySettle(
        (pending.length
          ? pending
          : listPendingChildEvents(this.opts.runId, opts.nodeId)
        ).map((e) => e.id)
      );
      if (this.killed) break;

      // Apply ChildSettled into FSM (also done in onEventSettled; reduce is idempotent enough for wake prompt build).
      if (settled && this.bus) {
        const { state } = reduce(this.bus, {
          type: "ChildSettled",
          parentId: opts.nodeId,
          childId: settled.id,
          childStatus: settled.status,
          resultSummary: settled.resultSummary ?? "",
          taskText: settled.taskText,
          roleLabel: settled.roleLabel,
          verdict: settled.verdict,
          verdictSummary: settled.verdictSummary
        });
        this.bus = state;
      }

      prompt = buildDelegateWakePrompt(
        {
          taskText: settled?.taskText ?? "",
          roleLabel: settled?.roleLabel ?? "",
          status: settled?.status ?? "done",
          resultSummary: settled?.resultSummary ?? "",
          ...resolveEffectiveWakeVerdict(
            settled ?? {
              id: "",
              verdict: null,
              verdictSummary: null
            },
            listDelegationEvents(this.opts.runId)
          )
        },
        this.opts.roster,
        opts.selfAgentId,
        opts.depth,
        this.opts.policy.maxDepth
      );
      kind = "wake";
    }

    return { summary: lastSummary, error: lastError };
  }

  /** Reopen a completed/failed run and spawn a follow-up entry turn with park/wake. */
  async followUp(opts: {
    entryNodeId: string;
    entry: DelegationRosterEntry;
    prompt: string;
  }): Promise<OrchestratorTurnResult> {
    if (!this.bus) {
      this.bindEntry(opts.entryNodeId);
    }
    this.killed = false;
    const { state, effects } = reduce(this.bus!, {
      type: "UserFollowUp",
      prompt: opts.prompt
    });
    this.bus = state;
    // SpawnFollowUp is handled by runNodeLoop below; apply status reopen only.
    this.applyEffects(effects.filter((e) => e.type !== "SpawnFollowUp"));
    setDelegationRunStatus(this.opts.runId, "running", { allowReopen: true });

    return this.runNodeLoop({
      nodeId: opts.entryNodeId,
      depth: 0,
      selfAgentId: opts.entry.id,
      selfLabel: opts.entry.label,
      initialPrompt: opts.prompt,
      kind: "followUp"
    });
  }
}
