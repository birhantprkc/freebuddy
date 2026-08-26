import type { WebContents } from "electron";
import { randomUUID } from "node:crypto";
import type { WorkflowRuntimePorts } from "@freebuddy/workflow-runtime";
import { applyAgentLanguagePreference } from "../cli/agentLanguage.js";
import {
  appendMessage,
  listMessages,
  requireOwnedConversation,
  updateMessage
} from "../cli/conversations.js";
import { safeSendToWebContents } from "../cli/ipcSend.js";
import { cliKill } from "../cli/runtime.js";
import { getLanguage } from "../cli/settings.js";
import { getToolSession } from "../cli/store.js";
import { trackTelemetryEvent } from "../telemetry.js";
import {
  createWorkflowRun,
  createWorkflowStep,
  getWorkflowRun,
  getWorkflowSteps,
  resetWorkflowStepsForLoop,
  updateWorkflowRun,
  updateWorkflowStep
} from "../cli/workflows.js";
import type { StepExecutor } from "@freebuddy/workflow-runtime";

export function createElectronWorkflowPorts(input: {
  executor: StepExecutor;
  resolveAgent: WorkflowRuntimePorts["resolveAgent"];
  webContents?: WebContents;
}): WorkflowRuntimePorts {
  return {
    executor: input.executor,
    resolveAgent: input.resolveAgent,
    repository: {
      createRun: createWorkflowRun,
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
      appendMessage: ((input: Record<string, unknown>) =>
        appendMessage(input as never)) as WorkflowRuntimePorts["conversations"]["appendMessage"],
      updateMessage: ((input: Record<string, unknown>) =>
        updateMessage(input as never)) as WorkflowRuntimePorts["conversations"]["updateMessage"]
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

export { randomUUID };
