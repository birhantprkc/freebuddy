import type {
  WorkflowRunRow,
  WorkflowRunStatus,
  WorkflowStepRow,
  WorkflowStepStatus
} from "./workflowTypes.js";
import type { CreateWorkflowRunInput as PackageCreateRun, CreateWorkflowStepInput as PackageCreateStep } from "@freebuddy/workflow-runtime";
import * as sqlite from "@freebuddy/storage-sqlite";
import { sqliteContext } from "./sqliteContext.js";

export type CreateWorkflowRunInput = PackageCreateRun;
export type CreateWorkflowStepInput = PackageCreateStep;
export type UpdateWorkflowRunPatch = Parameters<typeof sqlite.updateWorkflowRun>[2];
export type UpdateWorkflowStepPatch = Parameters<typeof sqlite.updateWorkflowStep>[2];

export function createWorkflowRun(input: CreateWorkflowRunInput): WorkflowRunRow {
  return sqlite.createWorkflowRun(sqliteContext(), input);
}

export function updateWorkflowRun(id: string, patch: UpdateWorkflowRunPatch): void {
  sqlite.updateWorkflowRun(sqliteContext(), id, patch);
}

export function getWorkflowRun(id: string): WorkflowRunRow | undefined {
  return sqlite.getWorkflowRun(sqliteContext(), id);
}

export function listWorkflowRunsByConversation(conversationId: string): WorkflowRunRow[] {
  return sqlite.listWorkflowRunsByConversation(sqliteContext(), conversationId);
}

export function listActiveWorkflowRuns(): WorkflowRunRow[] {
  return sqlite.listActiveWorkflowRuns(sqliteContext());
}

export function recoverInterruptedWorkflowRuns(): number {
  return sqlite.recoverInterruptedWorkflowRuns(sqliteContext());
}

export function createWorkflowStep(input: CreateWorkflowStepInput): void {
  sqlite.createWorkflowStep(sqliteContext(), input);
}

export function updateWorkflowStep(id: string, patch: UpdateWorkflowStepPatch): void {
  sqlite.updateWorkflowStep(sqliteContext(), id, patch);
}

export function getWorkflowSteps(runId: string): WorkflowStepRow[] {
  return sqlite.getWorkflowSteps(sqliteContext(), runId);
}

export function resetWorkflowStepsForLoop(runId: string, phaseIds: string[]): void {
  sqlite.resetWorkflowStepsForLoop(sqliteContext(), runId, phaseIds);
}

export type { WorkflowRunRow, WorkflowRunStatus, WorkflowStepRow, WorkflowStepStatus };
