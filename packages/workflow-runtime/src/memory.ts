import { randomUUID } from "node:crypto";
import type {
  WorkflowRunRow,
  WorkflowStepRow
} from "@freebuddy/protocol/workflow";
import type {
  CreateWorkflowRunInput,
  CreateWorkflowStepInput,
  WorkflowRepository
} from "./ports.js";

export function createMemoryWorkflowRepository(): WorkflowRepository {
  const runs = new Map<string, WorkflowRunRow>();
  const steps = new Map<string, WorkflowStepRow[]>();

  return {
    createRun(input: CreateWorkflowRunInput) {
      const now = new Date().toISOString();
      const run: WorkflowRunRow = {
        id: input.id,
        conversationId: input.conversationId,
        teamId: input.teamId,
        teamSnapshotJson: input.teamSnapshotJson,
        planVersion: input.planVersion,
        name: input.name,
        goal: input.goal,
        status: input.status ?? "pending_approval",
        cwd: input.cwd,
        template: input.template,
        loopIndex: 0,
        maxLoops: input.maxLoops,
        planJson: input.planJson,
        createdAt: now,
        updatedAt: now,
        runtimeVersion: input.runtimeVersion,
        runtimeApiVersion: input.runtimeApiVersion
      };
      runs.set(run.id, run);
      steps.set(run.id, []);
      return run;
    },
    getRun(id) {
      return runs.get(id);
    },
    updateRun(id, patch) {
      const current = runs.get(id);
      if (!current) return;
      runs.set(id, {
        ...current,
        ...patch,
        summary: patch.summary === null ? undefined : (patch.summary ?? current.summary),
        endedAt: patch.endedAt === null ? undefined : (patch.endedAt ?? current.endedAt),
        updatedAt: new Date().toISOString()
      });
    },
    createStep(input: CreateWorkflowStepInput) {
      const now = new Date().toISOString();
      const row: WorkflowStepRow = {
        id: input.id || randomUUID(),
        workflowRunId: input.workflowRunId,
        phaseId: input.phaseId,
        stepId: input.stepId,
        title: input.title,
        agentId: input.agentId,
        agentName: input.agentName,
        adapter: input.adapter,
        mode: input.mode,
        status: "pending",
        prompt: input.prompt,
        dependsOn: input.dependsOn,
        targetPaths: input.targetPaths,
        createdAt: now,
        updatedAt: now
      };
      const list = steps.get(input.workflowRunId) ?? [];
      list.push(row);
      steps.set(input.workflowRunId, list);
    },
    getSteps(runId) {
      return [...(steps.get(runId) ?? [])];
    },
    updateStep(id, patch) {
      for (const [runId, list] of steps) {
        const idx = list.findIndex((s) => s.id === id);
        if (idx < 0) continue;
        const current = list[idx]!;
        list[idx] = {
          ...current,
          ...Object.fromEntries(
            Object.entries(patch).map(([k, v]) => [k, v === null ? undefined : v])
          ),
          updatedAt: new Date().toISOString()
        };
        steps.set(runId, list);
      }
    },
    resetStepsForLoop(runId, phaseIds) {
      const list = steps.get(runId) ?? [];
      steps.set(
        runId,
        list.map((step) =>
          phaseIds.includes(step.phaseId)
            ? {
                ...step,
                status: "pending",
                summary: undefined,
                resultJson: undefined,
                cliTaskId: undefined,
                toolSessionId: undefined,
                startedAt: undefined,
                endedAt: undefined,
                updatedAt: new Date().toISOString()
              }
            : step
        )
      );
    }
  };
}
