import type { WorkflowRepository } from "@freebuddy/workflow-runtime";
import type { SqliteStoreContext } from "./types.js";
import {
  createWorkflowRun,
  createWorkflowStep,
  getWorkflowRun,
  getWorkflowSteps,
  resetWorkflowStepsForLoop,
  updateWorkflowRun,
  updateWorkflowStep
} from "./workflows.js";

export function createSqliteWorkflowRepository(ctx: SqliteStoreContext): WorkflowRepository {
  return {
    createRun: (input) => createWorkflowRun(ctx, input),
    getRun: (id) => getWorkflowRun(ctx, id),
    updateRun: (id, patch) => updateWorkflowRun(ctx, id, patch),
    createStep: (input) => createWorkflowStep(ctx, input),
    getSteps: (runId) => getWorkflowSteps(ctx, runId),
    updateStep: (id, patch) => updateWorkflowStep(ctx, id, patch),
    resetStepsForLoop: (runId, phaseIds) => resetWorkflowStepsForLoop(ctx, runId, phaseIds)
  };
}
