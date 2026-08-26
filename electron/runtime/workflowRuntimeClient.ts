import fs from "node:fs";
import path from "node:path";
import type { IpcMainInvokeEvent } from "electron";
import { BrowserWindow } from "electron";
import { getRuntimeManager } from "./runtimeIpc.js";
import { bundledRuntimePath } from "./bundledRuntime.js";
import { setRuntimeExecutionWebContents } from "./runtimeHostApi.js";
import { createCliStepExecutor, WorkflowRuntime, createElectronWorkflowPorts } from "../cli/workflowRuntime.js";
import { listCliMembers } from "../cli/members.js";
import { getWorkflowRun } from "../cli/workflows.js";
import { logMain } from "../debugLog.js";

let inProcessRuntime: WorkflowRuntime | null = null;

function bundledEntryExists(): boolean {
  try {
    return fs.existsSync(path.join(bundledRuntimePath(), "runtime", "index.mjs"));
  } catch {
    return false;
  }
}

export function shouldUseRuntimeProcess(): boolean {
  if (process.env.FREEBUDDY_RUNTIME_IN_PROCESS === "1") return false;
  if (process.env.FREEBUDDY_RUNTIME_PROCESS === "1") return true;
  return bundledEntryExists();
}

function ensureInProcessRuntime(event: IpcMainInvokeEvent): WorkflowRuntime {
  if (inProcessRuntime) return inProcessRuntime;
  const win = BrowserWindow.fromWebContents(event.sender);
  const executor = createCliStepExecutor(win?.webContents);
  inProcessRuntime = new WorkflowRuntime(
    createElectronWorkflowPorts({
      executor,
      webContents: win?.webContents,
      resolveAgent(agentId) {
        const member = listCliMembers().find((m) => m.id === agentId);
        if (!member) return undefined;
        return {
          adapter: member.cli.adapter,
          agentName: member.name,
          binary: member.cli.binary,
          extraArgs: member.cli.extraArgs,
          env: member.cli.env,
          skillIds: member.cli.skillIds
        };
      }
    })
  );
  return inProcessRuntime;
}

async function invokeWorkflowRpc(
  event: IpcMainInvokeEvent,
  runId: string | undefined,
  method: string,
  params: unknown
): Promise<unknown> {
  setRuntimeExecutionWebContents(event.sender);
  const manager = getRuntimeManager();
  const pinned = runId ? getWorkflowRun(runId)?.runtimeVersion : undefined;
  const route = manager.route({ runtimeVersion: pinned });
  try {
    await manager.ensureProcess(route.version);
    const longRunning = method === "workflow.requestGateChanges";
    return await manager.request(route.version, method, params, {
      timeoutMs: longRunning ? 0 : 30_000
    });
  } catch (error) {
    if (route.pinned) throw error;
    logMain().warn("runtime-process", "falling back in-process", {
      method,
      version: route.version,
      error: (error as Error).message
    });
    throw error;
  }
}

export function createWorkflowRuntimeHandle(event: IpcMainInvokeEvent) {
  const local = () => ensureInProcessRuntime(event);
  const useProcess = shouldUseRuntimeProcess();

  function call<T>(
    runId: string | undefined,
    method: string,
    params: unknown,
    fallback: () => T
  ): T | Promise<T> {
    setRuntimeExecutionWebContents(event.sender);
    if (!useProcess) return fallback();
    return invokeWorkflowRpc(event, runId, method, params).catch((error) => {
      const pinned = runId ? getWorkflowRun(runId)?.runtimeVersion : undefined;
      if (pinned && pinned !== "bundled") throw error;
      logMain().warn("runtime-process", "falling back in-process", {
        method,
        error: (error as Error).message
      });
      return fallback();
    }) as Promise<T>;
  }

  return {
    createPendingRun: ((input) =>
      call(undefined, "workflow.createPendingRun", input, () => local().createPendingRun(input))) as WorkflowRuntime["createPendingRun"],
    start: ((runId: string) => {
      void call(runId, "workflow.start", { runId }, () => local().start(runId));
    }) as WorkflowRuntime["start"],
    pause: ((runId: string) => {
      void call(runId, "workflow.pause", { runId }, () => local().pause(runId));
    }) as WorkflowRuntime["pause"],
    resume: ((runId: string) => {
      void call(runId, "workflow.resume", { runId }, () => local().resume(runId));
    }) as WorkflowRuntime["resume"],
    stop: ((runId: string) => {
      void call(runId, "workflow.stop", { runId }, () => local().stop(runId));
    }) as WorkflowRuntime["stop"],
    retryStep: ((runId: string, stepRowId: string) =>
      call(runId, "workflow.retryStep", { runId, stepRowId }, () =>
        local().retryStep(runId, stepRowId)
      )) as WorkflowRuntime["retryStep"],
    approveGate: ((runId: string, phaseId: string) =>
      call(runId, "workflow.approveGate", { runId, phaseId }, () =>
        local().approveGate(runId, phaseId)
      )) as WorkflowRuntime["approveGate"],
    requestGateChanges: ((runId: string, phaseId: string, feedback: string) =>
      call(runId, "workflow.requestGateChanges", { runId, phaseId, feedback }, () =>
        local().requestGateChanges(runId, phaseId, feedback)
      )) as WorkflowRuntime["requestGateChanges"],
    continueImplementReview: ((runId: string) =>
      call(runId, "workflow.continueImplementReview", { runId }, () =>
        local().continueImplementReview(runId)
      )) as WorkflowRuntime["continueImplementReview"]
  };
}
