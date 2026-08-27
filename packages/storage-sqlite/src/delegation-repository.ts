import type { DelegationRunRepository } from "@freebuddy/delegation-runtime";
import type { SqliteStoreContext } from "./types.js";
import {
  cancelActiveDelegationEvents,
  countActiveDelegateLeaves,
  createDelegationRun,
  getDelegationEvent,
  getDelegationRun,
  insertDelegationEvent,
  listDelegationEvents,
  listPendingChildEvents,
  lookupDelegationRunOwnerId,
  setDelegationRunStatus,
  transitionDelegationEvent,
  updateDelegationEvent
} from "./delegation-runs.js";

export function createSqliteDelegationRepository(
  ctx: SqliteStoreContext
): DelegationRunRepository {
  return {
    createRun(input) {
      const id = createDelegationRun(ctx, {
        id: input.id,
        goal: input.goal,
        cwd: input.cwd ?? undefined,
        teamId: input.teamId ?? "",
        teamSnapshotJson: input.teamSnapshotJson ?? "{}",
        conversationId: input.conversationId ?? undefined,
        runtimeVersion: input.runtimeVersion,
        runtimeApiVersion: input.runtimeApiVersion
      });
      return getDelegationRun(ctx, id)!;
    },
    getRun(id) {
      return getDelegationRun(ctx, id);
    },
    setStatus(id, status, options) {
      return setDelegationRunStatus(ctx, id, status, options).ok;
    },
    insertEvent(input) {
      return insertDelegationEvent(ctx, input);
    },
    updateEvent(id, patch) {
      updateDelegationEvent(ctx, id, {
        status: patch.status,
        resultSummary: patch.resultSummary,
        verdict: patch.verdict,
        verdictSummary: patch.verdictSummary
      });
    },
    transitionEvent(id, to, resultSummary, options) {
      return transitionDelegationEvent(ctx, id, to, resultSummary ?? null, options);
    },
    getEvent(id) {
      return getDelegationEvent(ctx, id);
    },
    listEvents(runId) {
      return listDelegationEvents(ctx, runId);
    },
    listPendingChildEvents(runId, parentEventId) {
      return listPendingChildEvents(ctx, runId, parentEventId);
    },
    countActiveDelegateLeaves(runId) {
      return countActiveDelegateLeaves(ctx, runId);
    },
    cancelActiveEvents(runId, reason) {
      return cancelActiveDelegationEvents(ctx, runId, reason ?? "cancelled");
    },
    getOwnerId(runId) {
      return lookupDelegationRunOwnerId(ctx, runId) ?? undefined;
    }
  };
}
