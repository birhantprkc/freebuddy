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
  getDelegationEvent,
  listPendingChildEvents,
  isTerminalDelegationStatus
} from "./delegationRuns.js";
import type { DelegationRosterEntry, DelegationPolicy, DelegationEvent, DelegationEventStatus } from "./delegationTeamTypes.js";
import { getDelegationTeam } from "./delegationTeams.js";
import type { CLIAdapterId } from "./adapters.js";
import { resolveSkillSnapshots } from "./skills.js";
import { setDelegateDeps, type DelegateRunContext, type DelegateExecArgs, type DelegateExecResult } from "./delegationDispatch.js";
import { buildDelegateTaskPrompt, buildDelegateWakePrompt } from "./delegationPrompt.js";
import type { DelegateAgentRunner } from "./delegationRunner.js";

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
  private eventWaiters = new Map<string, Array<(e: DelegationEvent | undefined) => void>>();
  constructor(private deps: DelegationRuntimeDeps) {
    setDelegateDeps({
      contextProvider: (runId) => this.getContext(runId),
      executor: (args) => this.executor(args),
      writeApproval: (binding, teammate) => this.requestWriteApproval(binding.runId, teammate),
      onSettle: (id) => this.onEventSettled(id)
    });
  }

  /** Resolve when a delegation event reaches a terminal status. */
  private awaitEventSettle(eventId: string): Promise<DelegationEvent | undefined> {
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

  private onEventSettled(eventId: string): void {
    const evt = getDelegationEvent(eventId);
    const waiters = this.eventWaiters.get(eventId);
    if (waiters) {
      this.eventWaiters.delete(eventId);
      for (const resolve of waiters) resolve(evt);
    }
  }

  /** Wait for the first of the given pending events to settle. */
  private raceAnySettle(eventIds: string[]): Promise<DelegationEvent | undefined> {
    if (eventIds.length === 0) throw new Error("raceAnySettle: empty id list");
    if (eventIds.length === 1) return this.awaitEventSettle(eventIds[0]!);
    return Promise.race(eventIds.map((id) => this.awaitEventSettle(id)));
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

  prepareRun(input: {
    goal: string; teamId: string;
    teamSnapshot: { roster: DelegationRosterEntry[]; policy: DelegationPolicy; entryRoleId: string };
    cwd?: string; conversationId?: string;
  }): string {
    const runId = createDelegationRun({
      goal: input.goal, cwd: input.cwd, teamId: input.teamId,
      teamSnapshotJson: JSON.stringify(input.teamSnapshot), conversationId: input.conversationId
    });
    this.contexts.set(runId, {
      runId, teamId: input.teamId, roster: input.teamSnapshot.roster,
      policy: input.teamSnapshot.policy, entryRoleId: input.teamSnapshot.entryRoleId,
      cwd: input.cwd, conversationId: input.conversationId
    });
    return runId;
  }

  async runEntry(runId: string, goal: string): Promise<void> {
    const ctx = this.contexts.get(runId);
    if (!ctx) return;
    const entry = ctx.roster.find((r) => r.id === ctx.entryRoleId) ?? ctx.roster[0];
    const rootEventId = insertDelegationEvent({
      runId, parentEventId: null, agentId: entry.agentId, agentName: entry.label,
      roleLabel: entry.label, taskText: goal, depth: 0, canWrite: entry.canWrite, status: "running"
    });
    const resolved = this.deps.resolveAgent(entry.agentId);
    if (!resolved) {
      updateDelegationEvent(rootEventId, { status: "failed", resultSummary: `agent not found: ${entry.agentId}` });
      setDelegationRunStatus(runId, "failed");
      return;
    }
    let prompt = buildDelegateTaskPrompt(goal, ctx.roster, entry.id, 0, ctx.policy.maxDepth);
    let lastError: string | null = null;
    let lastSummary = "";
    try {
      while (!this.killedRunIds.has(runId)) {
        const turn = await this.runAgentTurn({
          ctx, agent: entry, resolved,
          scope: delegationEntryScope(runId),
          sessionId: `del-${runId}`,
          parentEventId: rootEventId,
          depth: 0,
          prompt
        });
        lastError = turn.error;
        lastSummary = turn.summary ?? "";
        if (this.killedRunIds.has(runId)) break;
        // Park: if the entry still has outstanding delegates, wait for one to settle,
        // then resume the entry with that result. Otherwise its turn is truly complete.
        const pending = listPendingChildEvents(runId, rootEventId);
        if (pending.length === 0) break;
        const settled = await this.raceAnySettle(pending.map((e) => e.id));
        if (this.killedRunIds.has(runId)) break;
        prompt = buildDelegateWakePrompt(
          {
            taskText: settled?.taskText ?? "",
            roleLabel: settled?.roleLabel ?? "",
            status: settled?.status ?? "done",
            resultSummary: settled?.resultSummary ?? ""
          },
          ctx.roster, entry.id, 0, ctx.policy.maxDepth
        );
      }
      const status: DelegationEventStatus = this.killedRunIds.has(runId)
        ? "cancelled"
        : lastError ? "failed" : "done";
      updateDelegationEvent(rootEventId, { status, resultSummary: lastError ?? lastSummary });
      if (!this.killedRunIds.has(runId)) {
        setDelegationRunStatus(runId, status === "done" ? "completed" : status === "cancelled" ? "killed" : "failed");
      }
    } catch (err) {
      updateDelegationEvent(rootEventId, { status: "failed", resultSummary: (err as Error).message });
      if (!this.killedRunIds.has(runId)) setDelegationRunStatus(runId, "failed");
    }
  }

  /** Run exactly one agent turn (one ACP session/prompt). Shared by entry and delegates. */
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
        skills: resolveSkillSnapshots([...(opts.agent.skillIds ?? []), DELEGATION_SKILL_ID]),
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
    goal: string; teamId: string;
    teamSnapshot: { roster: DelegationRosterEntry[]; policy: DelegationPolicy; entryRoleId: string };
    cwd?: string; conversationId?: string;
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
      return { summary: "", exitCode: null, error: `agent not resolved: ${args.teammate.agentId}` };
    }
    let prompt = buildDelegateTaskPrompt(args.task, ctx.roster, args.teammate.id, args.depth, ctx.policy.maxDepth);
    let lastError: string | null = null;
    let lastSummary = "";
    while (!this.killedRunIds.has(args.runId)) {
      const turn = await this.runAgentTurn({
        ctx, agent: args.teammate, resolved,
        scope: delegationEventScope(args.runId, args.childEventId),
        sessionId: `del-${args.runId}-${args.childEventId}`,
        parentEventId: args.childEventId,
        depth: args.depth,
        prompt
      });
      lastError = turn.error;
      lastSummary = turn.summary ?? "";
      if (this.killedRunIds.has(args.runId)) { lastError = lastError ?? "killed"; break; }
      // Park: if this delegate spawned sub-delegates that are still running, wait for
      // one to settle and resume the teammate with its result. Otherwise the delegate is done.
      const pending = listPendingChildEvents(args.runId, args.childEventId);
      if (pending.length === 0) break;
      const settled = await this.raceAnySettle(pending.map((e) => e.id));
      if (this.killedRunIds.has(args.runId)) { lastError = lastError ?? "killed"; break; }
      prompt = buildDelegateWakePrompt(
        {
          taskText: settled?.taskText ?? "",
          roleLabel: settled?.roleLabel ?? "",
          status: settled?.status ?? "done",
          resultSummary: settled?.resultSummary ?? ""
        },
        ctx.roster, args.teammate.id, args.depth, ctx.policy.maxDepth
      );
    }
    return { summary: lastSummary, exitCode: null, error: lastError };
  }

  requestWriteApproval(runId: string, teammate: DelegationRosterEntry): Promise<boolean> {
    const approvalId = randomUUID();
    setDelegationRunStatus(runId, "blocked");
    safeSendToWebContents(this.deps.webContents, `delegation://approval/${runId}`, { runId, approvalId, teammate });
    return new Promise<boolean>((resolve) => {
      this.pendingApprovals.push({ approvalId, runId, teammate, resolve });
    });
  }

  listPendingApprovals(): Array<{ approvalId: string; runId: string }> {
    return this.pendingApprovals.map((p) => ({ approvalId: p.approvalId, runId: p.runId }));
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
    setDelegationRunStatus(runId, "killed");
    // v1: status-only. Full multi-agent kill (cancelling live ACP sessions) is a documented fast-follow.
  }
}

export function recoverInterruptedDelegationRuns(): number {
  const now = new Date().toISOString();
  const rows = getDb()
    .prepare("SELECT id FROM workflow_runs WHERE kind = 'delegation' AND status IN ('running','blocked')")
    .all() as Array<{ id: string }>;
  const update = getDb()
    .prepare("UPDATE workflow_runs SET status = 'failed', summary = COALESCE(summary, 'Interrupted by app restart.'), updated_at = ? WHERE id = ? AND status IN ('running','blocked')");
  // Orphaned delegate events (the in-memory queue is lost on restart): mark any
  // still pending (queued) or running delegate events of interrupted runs failed.
  const sweepEvents = getDb()
    .prepare(`UPDATE delegation_events SET status = 'failed', result_summary = COALESCE(result_summary, 'Interrupted by app restart.'), ended_at = ? WHERE status IN ('pending','running')`);
  for (const row of rows) update.run(now, row.id);
  sweepEvents.run(now);
  return rows.length;
}
