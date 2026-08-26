import type { WebContents } from "electron";

import type { CliPromptAttachment, CliRunArgs } from "./runtimeShared.js";
import { cliRun } from "./runtime.js";
import {
  conversationContextPromptPrefix,
  listResolvedConversationContextPayloads
} from "./conversationContext.js";
import { applyAgentLanguagePreference } from "./agentLanguage.js";
import { getLanguage } from "./settings.js";
import { requireOwnedConversation } from "./conversations.js";
import { resolveWorkspaceRootsForConversation } from "./projects.js";
import { resolveSkillSnapshots } from "./skills.js";
import { WorkflowRuntime, type StepExecutor } from "@freebuddy/workflow-runtime";
import { createElectronWorkflowPorts } from "../runtime/adapters.js";

export { WorkflowRuntime };
export type { StepExecutor, ResolvedAgent } from "@freebuddy/workflow-runtime";
export type { WorkflowRuntimePorts as RuntimeDeps } from "@freebuddy/workflow-runtime";

export { createElectronWorkflowPorts };

/** Production StepExecutor backed by the existing cliRun task runner. */
export function createCliStepExecutor(
  webContents: WebContents | undefined
): StepExecutor {
  return {
    async run(args) {
      if (!webContents) {
        throw new Error("workflow step execution requires an active window");
      }
      const runArgs: CliRunArgs = {
        sessionId: args.sessionId,
        conversationId: args.conversationId,
        agentId: args.agentId,
        agentName: args.agentName,
        adapter: args.adapter as any,
        binary: args.binary,
        extraArgs: args.extraArgs,
        env: args.env,
        configOptionOverrides: args.configOptionOverrides,
        prompt: args.prompt,
        promptAttachments: args.promptAttachments as CliPromptAttachment[] | undefined,
        toolSessionScope: args.toolSessionScope,
        toolSessionId: args.toolSessionId,
        cwd: args.cwd,
        workspaceRoots: args.conversationId
          ? resolveWorkspaceRootsForConversation(
              requireOwnedConversation(args.conversationId) ?? {
                cwd: args.cwd
              }
            )
          : resolveWorkspaceRootsForConversation({ cwd: args.cwd }),
        approvalMode: "auto",
        resumeToolSession: args.resumeToolSession,
        skills: resolveSkillSnapshots(args.skillIds ?? []),
        announceSkills: !args.resumeToolSession || !args.toolSessionId
      };
      const contextReferences = args.conversationId
        ? listResolvedConversationContextPayloads(args.conversationId)
        : [];
      if (contextReferences.length > 0) {
        runArgs.prompt = applyAgentLanguagePreference(
          `${conversationContextPromptPrefix(contextReferences)}` +
            runArgs.prompt,
          getLanguage()
        );
        runArgs.contextReferences = contextReferences;
      }
      await cliRun(webContents, runArgs, args.onEvent as CliRunArgs extends never ? never : any);
    }
  };
}
