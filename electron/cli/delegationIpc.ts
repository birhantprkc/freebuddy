import { BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { randomUUID } from "node:crypto";
import { registerHandler } from "../invokeRegistry.js";
import { listCliMembers } from "./members.js";
import {
  appendMessage,
  createConversation,
  notifyConversationsChanged
} from "./conversations.js";
import { getDelegationTeam } from "./delegationTeams.js";
import {
  DelegationRuntime,
  recoverInterruptedDelegationRuns
} from "./delegationRuntime.js";
import { createDelegateAgentRunner } from "./delegationRunner.js";

let runtime: DelegationRuntime | null = null;

export function ensureDelegationRuntime(event: IpcMainInvokeEvent): DelegationRuntime {
  if (runtime) return runtime;
  const win = BrowserWindow.fromWebContents(event.sender);
  runtime = new DelegationRuntime({
    webContents: win?.webContents,
    resolveAgent(agentId) {
      const member = listCliMembers().find((m) => m.id === agentId);
      if (!member) return undefined;
      return {
        adapter: member.cli.adapter,
        agentName: member.name,
        binary: member.cli.binary,
        extraArgs: member.cli.extraArgs,
        env: member.cli.env,
        skillIds: member.cli.skillIds
      };
    },
    runAgent: createDelegateAgentRunner(win?.webContents)
  });
  return runtime;
}

export function registerDelegationIpc(): void {
  recoverInterruptedDelegationRuns();

  registerHandler(
    "workflow:createDelegationRun",
    async (
      event,
      input: { teamId: string; goal: string; cwd?: string; conversationId?: string }
    ) => {
      const team = getDelegationTeam(input.teamId);
      if (!team) return { ok: false as const, error: "team not found" };
      const entry =
        team.roster.find((r) => r.id === team.entryRoleId) ?? team.roster[0];
      if (!entry) {
        return { ok: false as const, error: "team has no entry role" };
      }
      const member = listCliMembers().find((m) => m.id === entry.agentId);
      const agentName = member?.name ?? entry.label;
      const adapter = member?.cli.adapter ?? "claude";

      const conversationId = randomUUID();
      const title =
        input.goal.length > 100
          ? `${input.goal.slice(0, 97)}…`
          : input.goal;
      createConversation({
        id: conversationId,
        title,
        titleSource: "prompt",
        agentId: entry.agentId,
        agentName,
        adapter,
        cwd: input.cwd,
        approvalMode: "auto"
      });
      appendMessage({
        id: randomUUID(),
        conversationId,
        role: "user",
        status: "done",
        content: input.goal,
        agentId: entry.agentId,
        agentName,
        adapter
      });
      notifyConversationsChanged();

      const rt = ensureDelegationRuntime(event);
      const runId = rt.prepareRun({
        goal: input.goal,
        teamId: input.teamId,
        teamSnapshot: {
          roster: team.roster,
          policy: team.policy,
          entryRoleId: team.entryRoleId
        },
        cwd: input.cwd,
        conversationId
      });
      void rt.runEntry(runId, input.goal);
      return { ok: true as const, runId, conversationId };
    }
  );

  registerHandler(
    "workflow:approveDelegateWrite",
    (event, args: { runId: string; approvalId: string; approved: boolean }) => {
      ensureDelegationRuntime(event).resolveWriteApproval(
        args.approvalId,
        args.approved
      );
      return true;
    }
  );

  registerHandler(
    "delegation:listPendingApprovals",
    (event, runId: string) =>
      ensureDelegationRuntime(event)
        .listPendingApprovals()
        .filter((p) => p.runId === runId)
  );

  registerHandler(
    "delegation:stopRun",
    (event, runId: string) => {
      ensureDelegationRuntime(event).stopRun(runId);
      return true;
    }
  );
}
