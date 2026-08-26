import type { WorkflowRuntime } from "@freebuddy/workflow-runtime";
import type { DelegationRuntime } from "@freebuddy/delegation-runtime";
import type { CachedAgent, HostPortController } from "./hostPorts.js";
import type { RpcHandler } from "./peer.js";

function body<T>(params: unknown): T {
  return (params ?? {}) as T;
}

export function createWorkflowServiceHandlers(
  runtime: WorkflowRuntime,
  controller: HostPortController
): Record<string, RpcHandler> {
  return {
    async "workflow.createPendingRun"(params) {
      await controller.prepare();
      const input = body<{
        conversationId?: string;
        teamId?: string;
        teamSnapshotJson?: string;
        planVersion?: number;
        plan: never;
        agents: Array<CachedAgent & { id: string; name?: string; enabled?: boolean }>;
      }>(params);
      if (input.conversationId) {
        controller.cacheOwned(input.conversationId, true);
      }
      for (const agent of input.agents ?? []) {
        if (!agent?.id) continue;
        controller.cacheAgent({
          id: agent.id,
          adapter: agent.adapter,
          agentName: agent.agentName ?? agent.name ?? agent.id,
          binary: agent.binary,
          extraArgs: agent.extraArgs,
          env: agent.env,
          skillIds: agent.skillIds
        });
      }
      const result = runtime.createPendingRun({
        conversationId: input.conversationId,
        teamId: input.teamId,
        teamSnapshotJson: input.teamSnapshotJson,
        planVersion: input.planVersion,
        plan: input.plan as never,
        agents: (input.agents ?? []).map((agent) => ({
          id: agent.id,
          name: agent.name ?? agent.agentName ?? agent.id,
          adapter: agent.adapter,
          enabled: agent.enabled ?? true,
          skillIds: agent.skillIds
        }))
      });
      await controller.flush();
      return result;
    },
    async "workflow.getRun"(params) {
      const { runId } = body<{ runId: string }>(params);
      await controller.hydrateWorkflow(runId);
      return runtime.getRun(runId) ?? null;
    },
    async "workflow.getSteps"(params) {
      const { runId } = body<{ runId: string }>(params);
      await controller.hydrateWorkflow(runId);
      return runtime.getSteps(runId);
    },
    async "workflow.start"(params) {
      const { runId } = body<{ runId: string }>(params);
      await controller.hydrateWorkflow(runId);
      void runtime.start(runId).finally(() => {
        void controller.flush();
      });
      await controller.flush();
      return true;
    },
    async "workflow.approveGate"(params) {
      const { runId, phaseId } = body<{ runId: string; phaseId: string }>(params);
      await controller.hydrateWorkflow(runId);
      const result = runtime.approveGate(runId, phaseId);
      await controller.flush();
      return result;
    },
    async "workflow.requestGateChanges"(params) {
      const { runId, phaseId, feedback } = body<{
        runId: string;
        phaseId: string;
        feedback: string;
      }>(params);
      await controller.hydrateWorkflow(runId);
      const result = await runtime.requestGateChanges(runId, phaseId, feedback);
      await controller.flush();
      return result;
    },
    async "workflow.pause"(params) {
      const { runId } = body<{ runId: string }>(params);
      await controller.hydrateWorkflow(runId);
      runtime.pause(runId);
      await controller.flush();
      return true;
    },
    async "workflow.resume"(params) {
      const { runId } = body<{ runId: string }>(params);
      await controller.hydrateWorkflow(runId);
      void runtime.resume(runId).finally(() => {
        void controller.flush();
      });
      await controller.flush();
      return true;
    },
    async "workflow.stop"(params) {
      const { runId } = body<{ runId: string }>(params);
      await controller.hydrateWorkflow(runId);
      runtime.stop(runId);
      await controller.flush();
      return true;
    },
    async "workflow.retryStep"(params) {
      const { runId, stepRowId } = body<{ runId: string; stepRowId: string }>(params);
      await controller.hydrateWorkflow(runId);
      void runtime.retryStep(runId, stepRowId).finally(() => {
        void controller.flush();
      });
      await controller.flush();
      return true;
    },
    async "workflow.continueImplementReview"(params) {
      const { runId } = body<{ runId: string }>(params);
      await controller.hydrateWorkflow(runId);
      const result = runtime.continueImplementReview(runId);
      await controller.flush();
      return result;
    }
  };
}

function cacheTeamSnapshot(
  controller: HostPortController,
  teamId: string,
  snapshot: Parameters<DelegationRuntime["prepareRun"]>[0]["teamSnapshot"]
): void {
  if (!snapshot) return;
  const now = new Date().toISOString();
  controller.cacheTeam({
    id: teamId,
    name: teamId,
    enabled: true,
    source: "user",
    kind: "delegation",
    entryRoleId: snapshot.entryRoleId,
    roster: snapshot.roster,
    policy: snapshot.policy,
    createdAt: now,
    updatedAt: now
  });
}

export function createDelegationServiceHandlers(
  runtime: DelegationRuntime,
  controller: HostPortController
): Record<string, RpcHandler> {
  return {
    async "delegation.prepareRun"(params) {
      await controller.prepare();
      const input = body<Parameters<DelegationRuntime["prepareRun"]>[0]>(params);
      cacheTeamSnapshot(controller, input.teamId, input.teamSnapshot);
      const runId = runtime.prepareRun(input);
      await controller.flush();
      return { runId };
    },
    async "delegation.runEntry"(params) {
      const { runId, goal } = body<{ runId: string; goal: string }>(params);
      await controller.hydrateDelegation(runId);
      void runtime.runEntry(runId, goal).finally(() => {
        void controller.flush();
      });
      await controller.flush();
      return true;
    },
    async "delegation.getContext"(params) {
      const { runId } = body<{ runId: string }>(params);
      await controller.hydrateDelegation(runId);
      return runtime.getContext(runId) ?? null;
    },
    async "delegation.start"(params) {
      await controller.prepare();
      const input = body<Parameters<DelegationRuntime["start"]>[0]>(params);
      cacheTeamSnapshot(controller, input.teamId, input.teamSnapshot);
      const runId = runtime.prepareRun(input);
      await controller.flush();
      void runtime.runEntry(runId, input.goal).finally(() => {
        void controller.flush();
      });
      return { runId };
    }
  };
}
