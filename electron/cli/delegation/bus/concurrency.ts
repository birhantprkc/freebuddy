import {
  countActiveDelegateLeaves,
  getDelegationEvent,
  isTerminalDelegationStatus,
  listPendingChildEvents,
  transitionDelegationEvent
} from "../../delegationRuns.js";
import type { DelegationPolicy } from "../../delegationTeamTypes.js";

export interface QueuedDelegateJob<TExecArgs> {
  childEventId: string;
  execArgs: TExecArgs;
  timeoutMs: number;
  abortController: AbortController;
}

export interface ConcurrencyDeps<TExecArgs, TResult> {
  getPolicy: (runId: string) => DelegationPolicy | undefined;
  executor: (args: TExecArgs) => Promise<TResult>;
  onResult: (childEventId: string, result: TResult) => void;
  onTimeout: (childEventId: string) => void;
  onError: (childEventId: string, err: unknown) => void;
  onCancelled: (childEventId: string, reason: string) => void;
  /** Bound summary / status write already done in onResult; this fires after settle. */
  onSettled: (childEventId: string, runId: string) => void;
}

export class DelegateTimeout extends Error {
  constructor() {
    super("delegate exceeded timeout");
    this.name = "DelegateTimeout";
  }
}

/**
 * Race `p` against an active-time budget. While `isPaused()` is true the budget
 * does not drain (used when the delegate has unfinished child events).
 */
export function withActiveTimeTimeout<T>(
  p: Promise<T>,
  ms: number,
  isPaused: () => boolean,
  opts?: { tickMs?: number }
): Promise<T> {
  const tickMs = opts?.tickMs ?? 50;
  if (ms <= 0) {
    return Promise.reject(new DelegateTimeout());
  }
  return new Promise<T>((resolve, reject) => {
    let remaining = ms;
    let last = Date.now();
    let settled = false;
    const tick = setInterval(() => {
      if (settled) return;
      const now = Date.now();
      const elapsed = now - last;
      last = now;
      if (isPaused()) return;
      remaining -= elapsed;
      if (remaining <= 0) {
        cleanup();
        reject(new DelegateTimeout());
      }
    }, tickMs);
    const cleanup = () => {
      settled = true;
      clearInterval(tick);
    };
    p.then(
      (v) => {
        cleanup();
        resolve(v);
      },
      (e) => {
        cleanup();
        reject(e);
      }
    );
  });
}

/**
 * Per-run FIFO queue drained by active-leaf concurrency.
 * Only running delegates with no active child occupy a slot.
 */
export class DelegateConcurrencyQueue<TExecArgs, TResult> {
  private runQueues = new Map<string, QueuedDelegateJob<TExecArgs>[]>();
  private activeJobs = new Map<string, Map<string, QueuedDelegateJob<TExecArgs>>>();

  constructor(private deps: ConcurrencyDeps<TExecArgs, TResult>) {}

  enqueue(runId: string, job: QueuedDelegateJob<TExecArgs>): void {
    if (job.abortController.signal.aborted) {
      this.deps.onCancelled(job.childEventId, "cancelled before enqueue");
      this.deps.onSettled(job.childEventId, runId);
      return;
    }
    const queue = this.runQueues.get(runId) ?? [];
    queue.push(job);
    if (queue.length === 1) this.runQueues.set(runId, queue);
    this.drain(runId);
  }

  drain(runId: string): void {
    const policy = this.deps.getPolicy(runId);
    if (!policy) return;
    const max = policy.maxConcurrentDelegates;
    const limit = typeof max === "number" && max > 0 ? max : Infinity;
    const queue = this.runQueues.get(runId);
    while (queue && queue.length > 0 && countActiveDelegateLeaves(runId) < limit) {
      const next = queue.shift()!;
      if (queue.length === 0) this.runQueues.delete(runId);
      const event = getDelegationEvent(next.childEventId);
      if (!event || isTerminalDelegationStatus(event.status)) continue;
      this.start(runId, next);
    }
  }

  cancelRun(runId: string, reason: string): void {
    const queued = this.runQueues.get(runId) ?? [];
    this.runQueues.delete(runId);
    for (const job of queued) {
      job.abortController.abort(new Error(reason));
      this.deps.onCancelled(job.childEventId, reason);
      this.deps.onSettled(job.childEventId, runId);
    }
    for (const job of this.activeJobs.get(runId)?.values() ?? []) {
      job.abortController.abort(new Error(reason));
    }
  }

  private start(runId: string, q: QueuedDelegateJob<TExecArgs>): void {
    if (!transitionDelegationEvent(q.childEventId, "running")) return;
    const active = this.activeJobs.get(runId) ?? new Map();
    active.set(q.childEventId, q);
    this.activeJobs.set(runId, active);
    void withActiveTimeTimeout(
      this.deps.executor(q.execArgs),
      q.timeoutMs,
      () => listPendingChildEvents(runId, q.childEventId).length > 0
    )
      .then((result) => {
        if (q.abortController.signal.aborted) {
          const reason = q.abortController.signal.reason;
          this.deps.onCancelled(
            q.childEventId,
            reason instanceof Error ? reason.message : String(reason ?? "cancelled")
          );
        } else {
          this.deps.onResult(q.childEventId, result);
        }
        this.deps.onSettled(q.childEventId, runId);
        this.finishActive(runId, q.childEventId);
        this.drain(runId);
      })
      .catch((err) => {
        if (q.abortController.signal.aborted) {
          const reason = q.abortController.signal.reason;
          this.deps.onCancelled(
            q.childEventId,
            reason instanceof Error ? reason.message : String(reason ?? "cancelled")
          );
        } else if (err instanceof DelegateTimeout) {
          q.abortController.abort(new DelegateTimeout());
          this.deps.onTimeout(q.childEventId);
        } else {
          this.deps.onError(q.childEventId, err);
        }
        this.deps.onSettled(q.childEventId, runId);
        this.finishActive(runId, q.childEventId);
        this.drain(runId);
      });
  }

  private finishActive(runId: string, childEventId: string): void {
    const active = this.activeJobs.get(runId);
    active?.delete(childEventId);
    if (active && active.size === 0) this.activeJobs.delete(runId);
  }
}
