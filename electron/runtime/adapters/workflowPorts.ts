import type { WebContents } from "electron";
import type { WorkflowRuntimePorts } from "@freebuddy/workflow-runtime";
import { applyAgentLanguagePreference } from "../../cli/agentLanguage.js";
import {
  appendMessage,
  listMessages,
  requireOwnedConversation,
  updateMessage
} from "../../cli/conversations.js";
import { safeSendToWebContents } from "../../cli/ipcSend.js";
import { cliKill } from "../../cli/runtime.js";
import { getLanguage } from "../../cli/settings.js";
import { getToolSession } from "../../cli/store.js";
import { trackTelemetryEvent } from "../../telemetry.js";
import {
  createWorkflowRun,
  createWorkflowStep,
  getWorkflowRun,
  getWorkflowSteps,
  resetWorkflowStepsForLoop,
  updateWorkflowRun,
  updateWorkflowStep
} from "../../cli/workflows.js";
import type { StepExecutor } from "@freebuddy/workflow-runtime";
import { currentRuntimePin } from "../runtimePin.js";
import { app } from "electron";

function pin() {
  try {
    return currentRuntimePin(app.getPath("userData"));
  } catch {
    return currentRuntimePin();
  }
}

export function createElectronWorkflowPorts(input: {
  executor: StepExecutor;
  resolveAgent: WorkflowRuntimePorts["resolveAgent"];
  webContents?: WebContents;
}): WorkflowRuntimePorts {
  return {
    executor: input.executor,
    resolveAgent: input.resolveAgent,
    repository: {
      createRun(input) {
        const stamped = pin();
        return createWorkflowRun({
          ...input,
          runtimeVersion: input.runtimeVersion ?? stamped.runtimeVersion,
          runtimeApiVersion: input.runtimeApiVersion ?? stamped.runtimeApiVersion
        });
      },
      getRun: getWorkflowRun,
      updateRun: updateWorkflowRun,
      createStep: createWorkflowStep,
      getSteps: getWorkflowSteps,
      updateStep: updateWorkflowStep,
      resetStepsForLoop: resetWorkflowStepsForLoop
    },
    conversations: {
      requireOwned: requireOwnedConversation,
      listMessages,
      appendMessage: ((payload: Record<string, unknown>) =>
        appendMessage(payload as never)) as WorkflowRuntimePorts["conversations"]["appendMessage"],
      updateMessage: ((payload: Record<string, unknown>) =>
        updateMessage(payload as never)) as WorkflowRuntimePorts["conversations"]["updateMessage"]
    },
    events: {
      publish(channel, payload) {
        safeSendToWebContents(input.webContents, channel, payload);
      }
    },
    telemetry: {
      track(event, properties) {
        trackTelemetryEvent(event as never, (properties ?? {}) as never);
      }
    },
    language: {
      getLanguage,
      applyPreference: applyAgentLanguagePreference
    },
    toolSessions: {
      get(agentId, scope) {
        const row = getToolSession(agentId, scope);
        return row ? { sessionId: row.sessionId } : undefined;
      }
    },
    killSession: cliKill
  };
}
