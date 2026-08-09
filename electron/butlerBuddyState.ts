export const BUTLER_BUDDY_TRANSIENT_DURATION_MS = 4_000;

export type ButlerBuddyVisualState =
  | "idle"
  | "working"
  | "celebrating"
  | "comforting"
  | "sleeping";

export type ButlerBuddyTaskResult =
  | "success"
  | "failure"
  | "killed"
  | "stopped";

export interface ButlerBuddyTransientState {
  visualState: "celebrating" | "comforting";
  until: number;
}

export interface ButlerBuddyStateContext {
  streaming: boolean;
  transient: ButlerBuddyTransientState | null;
}

export interface ButlerBuddyRuntimeState {
  visualState: ButlerBuddyVisualState;
  since: string;
  transientUntil?: string;
}

export type ButlerBuddyStateEvent =
  | { type: "streaming-changed"; streaming: boolean }
  | { type: "task-result"; result: ButlerBuddyTaskResult }
  | { type: "clock-tick" };

export interface ButlerBuddyStateReduction {
  accepted: boolean;
  context: ButlerBuddyStateContext;
}

type TimeoutHandle = unknown;

export interface ButlerBuddyStateDependencies {
  now: () => number;
  schedule: (callback: () => void, delayMs: number) => TimeoutHandle;
  cancel: (handle: TimeoutHandle) => void;
}

export interface ButlerBuddyStateCoordinator {
  getState: () => ButlerBuddyRuntimeState;
  setStreaming: (streaming: unknown) => boolean;
  reportTaskResult: (result: unknown) => boolean;
  refresh: () => boolean;
  subscribe: (
    listener: (state: ButlerBuddyRuntimeState) => void
  ) => () => void;
  dispose: () => void;
}

const TASK_RESULTS = new Set<ButlerBuddyTaskResult>([
  "success",
  "failure",
  "killed",
  "stopped"
]);

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function parseStateEvent(raw: unknown): ButlerBuddyStateEvent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const event = raw as Record<string, unknown>;

  if (event.type === "clock-tick") {
    return hasOnlyKeys(event, ["type"]) ? { type: "clock-tick" } : null;
  }

  if (event.type === "streaming-changed") {
    if (!hasOnlyKeys(event, ["type", "streaming"])) return null;
    return typeof event.streaming === "boolean"
      ? { type: "streaming-changed", streaming: event.streaming }
      : null;
  }

  if (event.type === "task-result") {
    if (!hasOnlyKeys(event, ["type", "result"])) return null;
    if (!TASK_RESULTS.has(event.result as ButlerBuddyTaskResult)) return null;
    return {
      type: "task-result",
      result: event.result as ButlerBuddyTaskResult
    };
  }

  return null;
}

function withoutExpiredTransient(
  context: ButlerBuddyStateContext,
  at: number
): ButlerBuddyStateContext {
  if (!context.transient || context.transient.until > at) return context;
  return { ...context, transient: null };
}

function contextsEqual(
  left: ButlerBuddyStateContext,
  right: ButlerBuddyStateContext
): boolean {
  return (
    left.streaming === right.streaming &&
    left.transient?.visualState === right.transient?.visualState &&
    left.transient?.until === right.transient?.until
  );
}

function runtimeStatesEqual(
  left: ButlerBuddyRuntimeState,
  right: ButlerBuddyRuntimeState
): boolean {
  return (
    left.visualState === right.visualState &&
    left.since === right.since &&
    left.transientUntil === right.transientUntil
  );
}

function toIsoString(at: number): string {
  return new Date(at).toISOString();
}

export function resolveButlerBuddyVisualState(
  context: ButlerBuddyStateContext,
  at = Date.now()
): ButlerBuddyVisualState {
  if (context.transient && context.transient.until > at) {
    return context.transient.visualState;
  }
  if (context.streaming) return "working";

  const localHour = new Date(at).getHours();
  if (localHour >= 0 && localHour < 7) return "sleeping";
  return "idle";
}

export function millisecondsUntilNextButlerBuddySleepBoundary(
  at = Date.now()
): number {
  const current = new Date(at);
  const nextBoundary = new Date(at);

  if (current.getHours() < 7) {
    nextBoundary.setHours(7, 0, 0, 0);
  } else {
    nextBoundary.setDate(current.getDate() + 1);
    nextBoundary.setHours(0, 0, 0, 0);
  }

  return Math.max(0, nextBoundary.getTime() - at);
}

export function normalizeButlerBuddyTaskText(
  value: unknown
): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return Array.from(normalized).slice(0, 80).join("");
}

export function reduceButlerBuddyState(
  context: ButlerBuddyStateContext,
  rawEvent: unknown,
  at = Date.now()
): ButlerBuddyStateReduction {
  const event = parseStateEvent(rawEvent);
  if (!event) return { accepted: false, context };

  const current = withoutExpiredTransient(context, at);

  if (event.type === "clock-tick") {
    return { accepted: true, context: current };
  }

  if (event.type === "streaming-changed") {
    if (current.streaming === event.streaming) {
      return { accepted: true, context: current };
    }
    return {
      accepted: true,
      context: { ...current, streaming: event.streaming }
    };
  }

  if (event.result === "killed" || event.result === "stopped") {
    return { accepted: true, context: current };
  }

  return {
    accepted: true,
    context: {
      ...current,
      transient: {
        visualState:
          event.result === "success" ? "celebrating" : "comforting",
        until: at + BUTLER_BUDDY_TRANSIENT_DURATION_MS
      }
    }
  };
}

function createRuntimeState(
  context: ButlerBuddyStateContext,
  at: number,
  previous?: ButlerBuddyRuntimeState
): ButlerBuddyRuntimeState {
  const visualState = resolveButlerBuddyVisualState(context, at);
  const transientUntil =
    context.transient && context.transient.until > at
      ? toIsoString(context.transient.until)
      : undefined;
  const since =
    previous && previous.visualState === visualState
      ? previous.since
      : toIsoString(at);
  return Object.freeze({
    visualState,
    since,
    ...(transientUntil ? { transientUntil } : {})
  });
}

const defaultDependencies: ButlerBuddyStateDependencies = {
  now: () => Date.now(),
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

export function createButlerBuddyStateCoordinator(
  dependencies: Partial<ButlerBuddyStateDependencies> = {}
): ButlerBuddyStateCoordinator {
  const now = dependencies.now ?? defaultDependencies.now;
  const schedule = dependencies.schedule ?? defaultDependencies.schedule;
  const cancel = dependencies.cancel ?? defaultDependencies.cancel;
  const listeners = new Set<(state: ButlerBuddyRuntimeState) => void>();

  let disposed = false;
  let context: ButlerBuddyStateContext = {
    streaming: false,
    transient: null
  };
  let runtimeState = createRuntimeState(context, now());
  let expiryTimer: TimeoutHandle | null = null;
  let scheduledTransientUntil: number | null = null;

  const synchronizeTimer = (): void => {
    const nextUntil = context.transient?.until ?? null;
    if (nextUntil === scheduledTransientUntil) return;

    if (expiryTimer !== null) cancel(expiryTimer);
    expiryTimer = null;
    scheduledTransientUntil = nextUntil;

    if (nextUntil === null) return;
    expiryTimer = schedule(() => {
      expiryTimer = null;
      scheduledTransientUntil = null;
      dispatch({ type: "clock-tick" });
    }, Math.max(0, nextUntil - now()));
  };

  const publishIfChanged = (at: number): void => {
    const next = createRuntimeState(context, at, runtimeState);
    if (runtimeStatesEqual(runtimeState, next)) return;
    runtimeState = next;
    for (const listener of listeners) listener(runtimeState);
  };

  const dispatch = (event: unknown): boolean => {
    if (disposed) return false;
    const at = now();
    const reduction = reduceButlerBuddyState(context, event, at);
    if (!reduction.accepted) return false;

    if (!contextsEqual(context, reduction.context)) {
      context = reduction.context;
    }
    synchronizeTimer();
    publishIfChanged(at);
    return true;
  };

  return {
    getState: () => runtimeState,
    setStreaming: (streaming) =>
      dispatch({ type: "streaming-changed", streaming }),
    reportTaskResult: (result) => dispatch({ type: "task-result", result }),
    refresh: () => dispatch({ type: "clock-tick" }),
    subscribe: (listener) => {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (expiryTimer !== null) cancel(expiryTimer);
      expiryTimer = null;
      scheduledTransientUntil = null;
      listeners.clear();
    }
  };
}
