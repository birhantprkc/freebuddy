import type { WorkflowRunStatus } from "./workflowTypes.js";
import type {
  DelegationArtifact,
  DelegationEvent,
  DelegationEventStatus,
  DelegationResult,
  DelegationVerdict
} from "./delegationTeamTypes.js";
import * as sqlite from "@freebuddy/storage-sqlite";
import { sqliteContext } from "./sqliteContext.js";

export type CreateDelegationRunInput = sqlite.CreateDelegationRunInput;
export type DelegationRunRow = NonNullable<ReturnType<typeof sqlite.getDelegationRun>>;
export type DelegationRunFinishedEvent = sqlite.DelegationRunFinishedEvent;
export type DelegationEventRow = DelegationEvent;
export type InsertDelegationEventInput = sqlite.InsertDelegationEventInput;
export type UpdateDelegationEventPatch = {
  status?: DelegationEventStatus;
  resultSummary?: string | null;
  verdict?: DelegationVerdict | null;
  verdictSummary?: string | null;
};

let delegationRunFinishedHandler:
  | ((event: DelegationRunFinishedEvent) => void)
  | null = null;

export function bindDelegationRunFinishedNotifier(
  fn: ((event: DelegationRunFinishedEvent) => void) | null
): void {
  delegationRunFinishedHandler = fn;
}

export function callerCanAccessDelegationRun(runId: string): boolean {
  return sqlite.callerCanAccessDelegationRun(sqliteContext(), runId);
}

export function getDelegationRunOwnerId(runId: string): string | null {
  return sqlite.lookupDelegationRunOwnerId(sqliteContext(), runId);
}

export function createDelegationRun(input: CreateDelegationRunInput): string {
  return sqlite.createDelegationRun(sqliteContext(), input);
}

export function getDelegationRun(id: string): DelegationRunRow | undefined {
  return sqlite.getDelegationRun(sqliteContext(), id);
}

export function getDelegationRunByConversation(
  conversationId: string
): DelegationRunRow | undefined {
  return sqlite.getDelegationRunByConversation(sqliteContext(), conversationId);
}

export function setDelegationRunStatus(
  id: string,
  status: WorkflowRunStatus,
  options?: { allowReopen?: boolean }
): boolean {
  const { ok, previous } = sqlite.setDelegationRunStatus(sqliteContext(), id, status, options);
  if (!ok || !previous) return false;
  const terminal = new Set(["completed", "failed", "killed", "partial"]);
  if (!terminal.has(previous.status) && terminal.has(status) && status !== "killed") {
    delegationRunFinishedHandler?.({
      runId: id,
      conversationId: previous.conversationId ?? undefined,
      status,
      name: previous.name || previous.goal || "Delegation run"
    });
  }
  return true;
}

export function insertDelegationEvent(input: InsertDelegationEventInput): string {
  return sqlite.insertDelegationEvent(sqliteContext(), input);
}

export function insertDelegationEventsAtomic(inputs: InsertDelegationEventInput[]): string[] {
  return sqlite.insertDelegationEventsAtomic(sqliteContext(), inputs);
}

export const buildDelegationResult = sqlite.buildDelegationResult;

export function transitionDelegationEvent(
  id: string,
  status: DelegationEventStatus,
  resultSummary?: string | null,
  options?: { allowReopen?: boolean; result?: DelegationResult | null }
): boolean {
  return sqlite.transitionDelegationEvent(sqliteContext(), id, status, resultSummary, options);
}

export function updateDelegationEvent(id: string, patch: UpdateDelegationEventPatch): void {
  sqlite.updateDelegationEvent(sqliteContext(), id, patch);
}

export function listDelegationEvents(runId: string): DelegationEventRow[] {
  return sqlite.listDelegationEvents(sqliteContext(), runId);
}

export function getDelegationEvent(id: string): DelegationEventRow | undefined {
  return sqlite.getDelegationEvent(sqliteContext(), id);
}

export const isTerminalDelegationStatus = sqlite.isTerminalDelegationStatus;

export function countActiveDelegationEvents(runId: string): number {
  return sqlite.countActiveDelegationEvents(sqliteContext(), runId);
}

export function countRunningDelegationEvents(runId: string): number {
  return sqlite.countRunningDelegationEvents(sqliteContext(), runId);
}

export function countActiveDelegateLeaves(runId: string): number {
  return sqlite.countActiveDelegateLeaves(sqliteContext(), runId);
}

export function cancelActiveDelegationEvents(runId: string, reason: string): string[] {
  return sqlite.cancelActiveDelegationEvents(sqliteContext(), runId, reason);
}

export function listPendingChildEvents(runId: string, parentEventId: string): DelegationEventRow[] {
  return sqlite.listPendingChildEvents(sqliteContext(), runId, parentEventId);
}

export type { DelegationArtifact, DelegationResult, WorkflowRunStatus };
