import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import { safeSendToWebContents } from "./ipcSend.js";
import { getDb } from "./db.js";
import {
  createDelegationRun,
  setDelegationRunStatus,
  insertDelegationEvent,
  updateDelegationEvent
} from "./delegationRuns.js";
import type { DelegationRosterEntry, DelegationPolicy } from "./delegationTeamTypes.js";
import type { CLIAdapterId } from "./adapters.js";
import { resolveSkillSnapshots } from "./skills.js";
import { setDelegateDeps, type DelegateRunContext, type DelegateExecArgs, type DelegateExecResult } from "./delegationDispatch.js";
import { buildDelegateTaskPrompt } from "./delegationPrompt.js";
import type { DelegateAgentRunner } from "./delegationRunner.js";

export const DELEGATION_SKILL_ID = "delegation";

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
  constructor(private deps: DelegationRuntimeDeps) {
    setDelegateDeps({
      contextProvider: (runId) => this.getContext(runId),
      executor: (args) => this.executor(args),
      writeApproval: (binding, teammate) => this.requestWriteApproval(binding.runId, teammate)
    });
  }

  getContext(runId: string): DelegateRunContext | undefined {
    const ctx = this.contexts.get(runId);
    if (!ctx) return undefined;
    return { roster: ctx.roster, policy: ctx.policy, teamId: ctx.teamId, cwd: ctx.cwd };
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
    const prompt = buildDelegateTaskPrompt(goal, ctx.roster, entry.id, 0, ctx.policy.maxDepth);
    try {
      const result = await this.deps.runAgent({
        sessionId: `del-${runId}`,
        conversationId: ctx.conversationId,
        agentId: entry.agentId,
        agentName: resolved.agentName,
        adapter: resolved.adapter as CLIAdapterId,
        binary: resolved.binary,
        extraArgs: resolved.extraArgs,
        env: resolved.env,
        prompt,
        cwd: ctx.cwd,
        approvalMode: "auto",
        skills: resolveSkillSnapshots([...(entry.skillIds ?? []), DELEGATION_SKILL_ID]),
        announceSkills: true,
        delegation: { runId, parentEventId: rootEventId, depth: 0, selfAgentId: entry.id, selfLabel: entry.label }
      });
      const status = result.error ? "failed" : "done";
      updateDelegationEvent(rootEventId, { status, resultSummary: result.summary });
      setDelegationRunStatus(runId, status === "done" ? "completed" : "failed");
    } catch (err) {
      updateDelegationEvent(rootEventId, { status: "failed", resultSummary: (err as Error).message });
      setDelegationRunStatus(runId, "failed");
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
    const resolved = ctx ? this.deps.resolveAgent(args.teammate.agentId) : undefined;
    if (!resolved || !ctx) {
      return { summary: "", exitCode: null, error: `agent not resolved: ${args.teammate.agentId}` };
    }
    const prompt = buildDelegateTaskPrompt(args.task, ctx.roster, args.teammate.id, args.depth, ctx.policy.maxDepth);
    try {
      return await this.deps.runAgent({
        sessionId: `del-${args.runId}-${args.childEventId}`,
        conversationId: ctx.conversationId,
        agentId: args.teammate.agentId,
        agentName: resolved.agentName,
        adapter: resolved.adapter as CLIAdapterId,
        binary: resolved.binary,
        extraArgs: resolved.extraArgs,
        env: resolved.env,
        prompt,
        cwd: ctx.cwd,
        approvalMode: "auto",
        skills: resolveSkillSnapshots([...(args.teammate.skillIds ?? []), DELEGATION_SKILL_ID]),
        announceSkills: true,
        delegation: { runId: args.runId, parentEventId: args.childEventId, depth: args.depth, selfAgentId: args.teammate.id, selfLabel: args.teammate.label }
      });
    } catch (err) {
      return { summary: "", exitCode: null, error: (err as Error).message };
    }
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
}

export function recoverInterruptedDelegationRuns(): number {
  const now = new Date().toISOString();
  const rows = getDb()
    .prepare("SELECT id FROM workflow_runs WHERE kind = 'delegation' AND status IN ('running','blocked')")
    .all() as Array<{ id: string }>;
  const update = getDb()
    .prepare("UPDATE workflow_runs SET status = 'failed', summary = COALESCE(summary, 'Interrupted by app restart.'), updated_at = ? WHERE id = ? AND status IN ('running','blocked')");
  for (const row of rows) update.run(now, row.id);
  return rows.length;
}
