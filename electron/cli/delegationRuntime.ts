import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import { safeSendToWebContents } from "./ipcSend.js";
import { getDb } from "./db.js";
import {
  createDelegationRun,
  getDelegationRun,
  setDelegationRunStatus,
  insertDelegationEvent,
  updateDelegationEvent,
  listDelegationEvents
} from "./delegationRuns.js";
import type {
  DelegationRosterEntry,
  DelegationPolicy,
  DelegationEventStatus
} from "./delegationTeamTypes.js";
import { getDelegationTeam } from "./delegationTeams.js";
import type { CLIAdapterId } from "./adapters.js";
import { resolveSkillSnapshots } from "./skills.js";
import {
  setDelegateDeps,
  type DelegateRunContext,
  type DelegateExecArgs,
  type DelegateExecResult
} from "./delegationDispatch.js";
import { buildDelegateTaskPrompt } from "./delegation/protocol/text.js";
import type { DelegateAgentRunner } from "./delegationRunner.js";
import { DelegationOrchestrator } from "./delegation/bus/orchestrator.js";

export const DELEGATION_SKILL_ID = "delegation";

function delegationEntryScope(runId: string): string {
  return `delegation:${runId}:entry`;
}

function delegationEventScope(runId: string, eventId: string): string {
  return `delegation:${runId}:${eventId}`;
}

function modelConfigOverride(entry: {
  model?: string;
  modelOptionId?: string;
}): Record<string, string> | undefined {
  const model = entry.model?.trim();
  if (!model) return undefined;
  const optionId = entry.modelOptionId?.trim() || "model";
  return { [optionId]: model };
}

type ResolvedAgent = {
  adapter: string;
  agentName: string;
  binary?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
  skillIds?: string[];
};

export interface DelegationRuntimeDeps {
  webContents: WebContents | undefined;
  resolveAgent: (agentId: string) => ResolvedAgent | undefined;
  runAgent: DelegateAgentRunner;
}

interface RunContext {
  runId: string;
  teamId: string;
  roster: DelegationRosterEntry[];
  policy: DelegationPolicy;
  entryRoleId: string;
  cwd?: string;
  conversationId?: string;
  orchestrator?: DelegationOrchestrator;
  rootEventId?: string;
}

interface PendingApproval {
  approvalId: string;
  runId: string;
  teammate: DelegationRosterEntry;
  resolve: (approved: boolean) => void;
}

export class DelegationRuntime {
  private contexts = new Map<string, RunContext>();
  private pendingApprovals: PendingApproval[] = [];
  private killedRunIds = new Set<string>();

  constructor(private deps: DelegationRuntimeDeps) {
    setDelegateDeps({
      contextProvider: (runId) => this.getContext(runId),
      executor: (args) => this.executor(args),
      writeApproval: (binding, teammate) => this.requestWriteApproval(binding.runId, teammate),
      onSettle: (id) => {
        const evtRun = this.findRunIdForEvent(id);
        if (evtRun) {
          this.contexts.get(evtRun)?.orchestrator?.onEventSettled(id);
          const child = this.contexts
            .get(evtRun)
            ?.orchestrator?.state?.nodes[id];
          if (child) {
            // leaf started tracking already handled at enqueue/start
          }
        }
      },
      onChildEnqueued: ({ runId, childEventId, parentEventId, depth }) => {
        this.contexts.get(runId)?.orchestrator?.noteChildEnqueued({
          childEventId,
          parentEventId,
          depth
        });
      }
    });
  }

  private findRunIdForEvent(eventId: string): string | undefined {
    for (const [runId, ctx] of this.contexts) {
      if (ctx.orchestrator?.state?.nodes[eventId]) return runId;
    }
    // Fallback: scan DB via list for known contexts
    for (const runId of this.contexts.keys()) {
      const events = listDelegationEvents(runId);
      if (events.some((e) => e.id === eventId)) return runId;
    }
    return undefined;
  }

  getContext(runId: string): DelegateRunContext | undefined {
    let ctx = this.contexts.get(runId);
    if (!ctx) {
      ctx = this.loadContextFromDb(runId);
    }
    if (!ctx) return undefined;
    return { roster: ctx.roster, policy: ctx.policy, teamId: ctx.teamId, cwd: ctx.cwd };
  }

  private loadContextFromDb(runId: string): RunContext | undefined {
    const run = getDelegationRun(runId);
    if (!run?.teamId) return undefined;
    const team = getDelegationTeam(run.teamId);
    if (!team) return undefined;
    const ctx: RunContext = {
      runId,
      teamId: run.teamId,
      roster: team.roster,
      policy: team.policy,
      entryRoleId: team.entryRoleId,
      cwd: run.cwd ?? undefined,
      conversationId: run.conversationId ?? undefined
    };
    this.contexts.set(runId, ctx);
    return ctx;
  }

  private ensureOrchestrator(ctx: RunContext): DelegationOrchestrator {
    if (ctx.orchestrator) return ctx.orchestrator;
    const orch = new DelegationOrchestrator({
      runId: ctx.runId,
      roster: ctx.roster,
      policy: ctx.policy,
      entryRoleId: ctx.entryRoleId,
      spawnTurn: async (args) => {
        const agent =
          ctx.roster.find((r) => r.id === args.selfAgentId) ??
          ctx.roster.find((r) => r.id === ctx.entryRoleId) ??
          ctx.roster[0]!;
        const resolvedAgent = this.deps.resolveAgent(agent.agentId);
        if (!resolvedAgent) {
          return { summary: "", error: `agent not found: ${agent.agentId}` };
        }
        const scope =
          args.depth === 0
            ? delegationEntryScope(ctx.runId)
            : delegationEventScope(ctx.runId, args.nodeId);
        const sessionId =
          args.depth === 0
            ? `del-${ctx.runId}`
            : `del-${ctx.runId}-${args.nodeId}`;
        const turn = await this.runAgentTurn({
          ctx,
          agent,
          resolved: resolvedAgent,
          scope,
          sessionId,
          parentEventId: args.nodeId,
          depth: args.depth,
          prompt: args.prompt
        });
        return { summary: turn.summary, error: turn.error };
      }
    });
    ctx.orchestrator = orch;
    return orch;
  }

  prepareRun(input: {
    goal: string;
    teamId: string;
    teamSnapshot: {
      roster: DelegationRosterEntry[];
      policy: DelegationPolicy;
      entryRoleId: string;
    };
    cwd?: string;
    conversationId?: string;
  }): string {
    const runId = createDelegationRun({
      goal: input.goal,
      cwd: input.cwd,
      teamId: input.teamId,
      teamSnapshotJson: JSON.stringify(input.teamSnapshot),
      conversationId: input.conversationId
    });
    this.contexts.set(runId, {
      runId,
      teamId: input.teamId,
      roster: input.teamSnapshot.roster,
      policy: input.teamSnapshot.policy,
      entryRoleId: input.teamSnapshot.entryRoleId,
      cwd: input.cwd,
      conversationId: input.conversationId
    });
    return runId;
  }

  async runEntry(runId: string, goal: string): Promise<void> {
    const ctx = this.contexts.get(runId);
    if (!ctx) return;
    const entry = ctx.roster.find((r) => r.id === ctx.entryRoleId) ?? ctx.roster[0];
    const rootEventId = insertDelegationEvent({
      runId,
      parentEventId: null,
      agentId: entry.agentId,
      agentName: entry.label,
      roleLabel: entry.label,
      taskText: goal,
      depth: 0,
      canWrite: entry.canWrite,
      status: "running"
    });
    ctx.rootEventId = rootEventId;
    const resolved = this.deps.resolveAgent(entry.agentId);
    if (!resolved) {
      updateDelegationEvent(rootEventId, {
        status: "failed",
        resultSummary: `agent not found: ${entry.agentId}`
      });
      setDelegationRunStatus(runId, "failed");
      return;
    }

    const orch = this.ensureOrchestrator(ctx);
    orch.bindEntry(rootEventId);

    const prompt = buildDelegateTaskPrompt(
      goal,
      ctx.roster,
      entry.id,
      0,
      ctx.policy.maxDepth
    );

    try {
      const result = await orch.runNodeLoop({
        nodeId: rootEventId,
        depth: 0,
        selfAgentId: entry.id,
        selfLabel: entry.label,
        initialPrompt: prompt,
        kind: "task"
      });
      if (this.killedRunIds.has(runId)) {
        updateDelegationEvent(rootEventId, {
          status: "cancelled",
          resultSummary: result.error ?? result.summary
        });
        return;
      }
      // Orchestrator already marks run/node terminal via FSM effects when appropriate.
      // Ensure root event has a summary if still running-ish.
      const status: DelegationEventStatus = result.error ? "failed" : "done";
      updateDelegationEvent(rootEventId, {
        status,
        resultSummary: result.error ?? result.summary
      });
      if (!this.killedRunIds.has(runId)) {
        const run = getDelegationRun(runId);
        if (run && run.status === "running") {
          setDelegationRunStatus(
            runId,
            status === "done" ? "completed" : "failed"
          );
        }
      }
    } catch (err) {
      updateDelegationEvent(rootEventId, {
        status: "failed",
        resultSummary: (err as Error).message
      });
      if (!this.killedRunIds.has(runId)) setDelegationRunStatus(runId, "failed");
    }
  }

  /**
   * Conversation follow-up on an existing delegation run.
   * Reopens completed/failed runs and drives entry park/wake via the bus.
   */
  async followUp(runId: string, userPrompt: string): Promise<void> {
    let ctx = this.contexts.get(runId);
    if (!ctx) ctx = this.loadContextFromDb(runId);
    if (!ctx) throw new Error("delegation run not found");

    this.killedRunIds.delete(runId);
    const entry = ctx.roster.find((r) => r.id === ctx!.entryRoleId) ?? ctx.roster[0];
    const events = listDelegationEvents(runId);
    let root = events.find((e) => e.depth === 0);
    if (!root) {
      const rootEventId = insertDelegationEvent({
        runId,
        parentEventId: null,
        agentId: entry.agentId,
        agentName: entry.label,
        roleLabel: entry.label,
        taskText: userPrompt,
        depth: 0,
        canWrite: entry.canWrite,
        status: "running"
      });
      root = listDelegationEvents(runId).find((e) => e.id === rootEventId)!;
    }
    ctx.rootEventId = root.id;

    const orch = this.ensureOrchestrator(ctx);
    if (!orch.state) orch.bindEntry(root.id);

    // Reset root to running for the follow-up turn.
    updateDelegationEvent(root.id, { status: "running", resultSummary: null });

    const prompt = buildDelegateTaskPrompt(
      userPrompt,
      ctx.roster,
      entry.id,
      0,
      ctx.policy.maxDepth
    );

    const result = await orch.followUp({
      entryNodeId: root.id,
      entry,
      prompt
    });

    if (this.killedRunIds.has(runId)) return;
    const status: DelegationEventStatus = result.error ? "failed" : "done";
    updateDelegationEvent(root.id, {
      status,
      resultSummary: result.error ?? result.summary
    });
    const run = getDelegationRun(runId);
    if (run && (run.status === "running" || run.status === "blocked")) {
      setDelegationRunStatus(runId, status === "done" ? "completed" : "failed");
    }
  }

  private async runAgentTurn(opts: {
    ctx: RunContext;
    agent: DelegationRosterEntry;
    resolved: ResolvedAgent;
    scope: string;
    sessionId: string;
    parentEventId: string;
    depth: number;
    prompt: string;
  }): Promise<DelegateExecResult> {
    const modelOverride = modelConfigOverride(opts.agent);
    try {
      const result = await this.deps.runAgent({
        sessionId: opts.sessionId,
        conversationId: opts.ctx.conversationId,
        toolSessionScope: opts.scope,
        resumeToolSession: true,
        roleLabel: opts.agent.label,
        agentId: opts.agent.agentId,
        agentName: opts.resolved.agentName,
        adapter: opts.resolved.adapter as CLIAdapterId,
        binary: opts.resolved.binary,
        extraArgs: opts.resolved.extraArgs,
        env: opts.resolved.env,
        prompt: opts.prompt,
        cwd: opts.ctx.cwd,
        approvalMode: "auto",
        ...(modelOverride ? { configOptionOverrides: modelOverride } : {}),
        skills: resolveSkillSnapshots([
          ...(opts.agent.skillIds ?? []),
          DELEGATION_SKILL_ID
        ]),
        announceSkills: true,
        delegation: {
          runId: opts.ctx.runId,
          parentEventId: opts.parentEventId,
          depth: opts.depth,
          selfAgentId: opts.agent.id,
          selfLabel: opts.agent.label
        }
      });
      return { summary: result.summary, exitCode: result.exitCode, error: result.error };
    } catch (err) {
      return { summary: "", exitCode: null, error: (err as Error).message };
    }
  }

  async start(input: {
    goal: string;
    teamId: string;
    teamSnapshot: {
      roster: DelegationRosterEntry[];
      policy: DelegationPolicy;
      entryRoleId: string;
    };
    cwd?: string;
    conversationId?: string;
  }): Promise<string> {
    const runId = this.prepareRun(input);
    await this.runEntry(runId, input.goal);
    return runId;
  }

  private async executor(args: DelegateExecArgs): Promise<DelegateExecResult> {
    const ctx = this.contexts.get(args.runId);
    if (!ctx) {
      return { summary: "", exitCode: null, error: "run context not found" };
    }
    const resolved = this.deps.resolveAgent(args.teammate.agentId);
    if (!resolved) {
      return {
        summary: "",
        exitCode: null,
        error: `agent not resolved: ${args.teammate.agentId}`
      };
    }

    const orch = this.ensureOrchestrator(ctx);
    orch.noteChildEnqueued({
      childEventId: args.childEventId,
      parentEventId: args.parentEventId,
      depth: args.depth
    });
    orch.noteChildStarted(args.childEventId);

    const { buildDelegateWakePrompt } = await import("./delegation/protocol/text.js");
    const { listPendingChildEvents } = await import("./delegationRuns.js");

    let prompt = buildDelegateTaskPrompt(
      args.task,
      ctx.roster,
      args.teammate.id,
      args.depth,
      ctx.policy.maxDepth
    );
    let lastError: string | null = null;
    let lastSummary = "";

    while (!this.killedRunIds.has(args.runId)) {
      const turn = await this.runAgentTurn({
        ctx,
        agent: args.teammate,
        resolved,
        scope: delegationEventScope(ctx.runId, args.childEventId),
        sessionId: `del-${ctx.runId}-${args.childEventId}`,
        parentEventId: args.childEventId,
        depth: args.depth,
        prompt
      });
      lastError = turn.error;
      lastSummary = turn.summary ?? "";
      if (this.killedRunIds.has(args.runId)) {
        lastError = lastError ?? "killed";
        break;
      }
      const pending = listPendingChildEvents(args.runId, args.childEventId);
      if (pending.length === 0) break;
      const settled = await orch.raceAnySettle(pending.map((e) => e.id));
      if (this.killedRunIds.has(args.runId)) {
        lastError = lastError ?? "killed";
        break;
      }
      prompt = buildDelegateWakePrompt(
        {
          taskText: settled?.taskText ?? "",
          roleLabel: settled?.roleLabel ?? "",
          status: settled?.status ?? "done",
          resultSummary: settled?.resultSummary ?? ""
        },
        ctx.roster,
        args.teammate.id,
        args.depth,
        ctx.policy.maxDepth
      );
    }
    return { summary: lastSummary, exitCode: null, error: lastError };
  }

  requestWriteApproval(runId: string, teammate: DelegationRosterEntry): Promise<boolean> {
    const approvalId = randomUUID();
    setDelegationRunStatus(runId, "blocked");
    safeSendToWebContents(this.deps.webContents, `delegation://approval/${runId}`, {
      runId,
      approvalId,
      teammate
    });
    return new Promise<boolean>((resolve) => {
      this.pendingApprovals.push({ approvalId, runId, teammate, resolve });
    });
  }

  listPendingApprovals(): Array<{ approvalId: string; runId: string }> {
    return this.pendingApprovals.map((p) => ({
      approvalId: p.approvalId,
      runId: p.runId
    }));
  }

  resolveWriteApproval(approvalId: string, approved: boolean): void {
    const idx = this.pendingApprovals.findIndex((p) => p.approvalId === approvalId);
    if (idx < 0) return;
    const [pending] = this.pendingApprovals.splice(idx, 1);
    if (approved) {
      const ctx = this.contexts.get(pending.runId);
      if (ctx) setDelegationRunStatus(pending.runId, "running");
    }
    pending.resolve(approved);
  }

  stopRun(runId: string): void {
    this.killedRunIds.add(runId);
    this.contexts.get(runId)?.orchestrator?.markKilled();
    setDelegationRunStatus(runId, "killed");
  }
}

export function recoverInterruptedDelegationRuns(): number {
  const now = new Date().toISOString();
  const rows = getDb()
    .prepare(
      "SELECT id FROM workflow_runs WHERE kind = 'delegation' AND status IN ('running','blocked')"
    )
    .all() as Array<{ id: string }>;
  const update = getDb().prepare(
    "UPDATE workflow_runs SET status = 'failed', summary = COALESCE(summary, 'Interrupted by app restart.'), updated_at = ? WHERE id = ? AND status IN ('running','blocked')"
  );
  const sweepEvents = getDb().prepare(
    `UPDATE delegation_events SET status = 'failed', result_summary = COALESCE(result_summary, 'Interrupted by app restart.'), ended_at = ? WHERE status IN ('pending','running')`
  );
  for (const row of rows) update.run(now, row.id);
  sweepEvents.run(now);
  return rows.length;
}
