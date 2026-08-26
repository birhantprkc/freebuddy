import type { IpcMainInvokeEvent } from "electron";
import { getRuntimeManager } from "./runtimeIpc.js";
import { setRuntimeExecutionWebContents } from "./runtimeHostApi.js";
import { shouldUseRuntimeProcess } from "./workflowRuntimeClient.js";
import { getDelegationRun } from "../cli/delegationRuns.js";
import { logMain } from "../debugLog.js";
import type { DelegationRuntime } from "../cli/delegationRuntime.js";

export type DelegationRuntimeHandle = {
  prepareRun: (input: unknown) => string | Promise<string>;
  runEntry: (runId: string, goal: string) => void | Promise<void>;
  stopRun: (runId: string) => void | Promise<void>;
  pauseRun: (runId: string) => boolean | Promise<boolean>;
  resumeRun: (runId: string) => boolean | Promise<boolean>;
  followUp: (runId: string, prompt: string) => void | Promise<void>;
};

async function invokeDelegationRpc(
  event: IpcMainInvokeEvent,
  runId: string | undefined,
  method: string,
  params: unknown
): Promise<unknown> {
  setRuntimeExecutionWebContents(event.sender);
  const manager = getRuntimeManager();
  const pinned = runId ? getDelegationRun(runId)?.runtimeVersion : undefined;
  const route = manager.route({ runtimeVersion: pinned });
  await manager.ensureProcess(route.version);
  const longRunning =
    method === "delegation.runEntry" ||
    method === "delegation.followUp" ||
    method === "delegation.resumeRun";
  return manager.request(route.version, method, params, {
    timeoutMs: longRunning ? 0 : 30_000
  });
}

export function createDelegationRuntimeHandle(
  event: IpcMainInvokeEvent,
  getLocal: () => DelegationRuntime
): DelegationRuntimeHandle {
  const useProcess = shouldUseRuntimeProcess();

  function call<T>(
    runId: string | undefined,
    method: string,
    params: unknown,
    fallback: () => T
  ): T | Promise<T> {
    setRuntimeExecutionWebContents(event.sender);
    if (!useProcess) return fallback();
    return invokeDelegationRpc(event, runId, method, params).catch((error) => {
      const pinned = runId ? getDelegationRun(runId)?.runtimeVersion : undefined;
      if (pinned && pinned !== "bundled") throw error;
      logMain().warn("runtime-process", "delegation falling back in-process", {
        method,
        error: (error as Error).message
      });
      return fallback();
    }) as Promise<T>;
  }

  return {
    prepareRun: (input) =>
      Promise.resolve(
        call(undefined, "delegation.prepareRun", input, () => getLocal().prepareRun(input as never))
      ).then((result) =>
        typeof result === "string" ? result : String((result as { runId?: string })?.runId ?? "")
      ),
    runEntry: (runId, goal) => {
      void call(runId, "delegation.runEntry", { runId, goal }, () => getLocal().runEntry(runId, goal));
    },
    stopRun: (runId) => {
      void call(runId, "delegation.stopRun", { runId }, () => getLocal().stopRun(runId));
    },
    pauseRun: (runId) =>
      call(runId, "delegation.pauseRun", { runId }, () => getLocal().pauseRun(runId)) as Promise<boolean>,
    resumeRun: (runId) =>
      call(runId, "delegation.resumeRun", { runId }, () => getLocal().resumeRun(runId)) as Promise<boolean>,
    followUp: (runId, prompt) => {
      void call(runId, "delegation.followUp", { runId, prompt }, () => getLocal().followUp(runId, prompt));
    }
  };
}
