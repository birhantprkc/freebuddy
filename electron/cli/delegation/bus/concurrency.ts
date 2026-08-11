import {
  countActiveDelegateLeaves,
  updateDelegationEvent
} from "../../delegationRuns.js";
import type { DelegationPolicy } from "../../delegationTeamTypes.js";

export interface QueuedDelegateJob<TExecArgs> {
  childEventId: string;
  execArgs: TExecArgs;
  timeoutMs: number;
}

export interface ConcurrencyDeps<TExecArgs, TResult> {
  getPolicy: (runId: string) => DelegationPolicy | undefined;
  executor: (args: TExecArgs) => Promise<TResult>;
  onResult: (childEventId: string, result: TResult) => void;
  onTimeout: (childEventId: string) => void;
  onError: (childEventId: string, err: unknown) => void;
  /** Bound summary / status write already done in onResult; this fires after settle. */
  onSettled: (childEventId: string, runId: string) => void;
}

class DelegateTimeout extends Error {
  constructor() {
    super("delegate exceeded timeout");
    this.name = "DelegateTimeout";
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    p.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new DelegateTimeout()), ms);
    })
  ]);
}

/**
 * Per-run FIFO queue drained by active-leaf concurrency.
 * Only running delegates with no active child occupy a slot.
 */
export class DelegateConcurrencyQueue<TExecArgs, TResult> {
  private runQueues = new Map<string, QueuedDelegateJob<TExecArgs>[]>();

  constructor(private deps: ConcurrencyDeps<TExecArgs, TResult>) {}

  enqueue(runId: string, job: QueuedDelegateJob<TExecArgs>): void {
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
      this.start(runId, next);
    }
  }

  private start(runId: string, q: QueuedDelegateJob<TExecArgs>): void {
    updateDelegationEvent(q.childEventId, { status: "running" });
    void withTimeout(this.deps.executor(q.execArgs), q.timeoutMs)
      .then((result) => {
        this.deps.onResult(q.childEventId, result);
        this.deps.onSettled(q.childEventId, runId);
        this.drain(runId);
      })
      .catch((err) => {
        if (err instanceof DelegateTimeout) {
          this.deps.onTimeout(q.childEventId);
        } else {
          this.deps.onError(q.childEventId, err);
        }
        this.deps.onSettled(q.childEventId, runId);
        this.drain(runId);
      });
  }
}
