import type { WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { cliRun } from "./runtime.js";
import type { CliRunArgs } from "./runtimeShared.js";
import { appendMessage, updateMessage } from "./conversations.js";
import { safeSendToWebContents } from "./ipcSend.js";

export interface DelegateRunResult {
  summary: string;
  exitCode: number | null;
  error: string | null;
}

export type DelegateAgentRunner = (args: CliRunArgs) => Promise<DelegateRunResult>;

const MAX_SUMMARY_CHARS = 12_000;

export function summarizeDelegateOutput(items: unknown[]): string {
  const texts: string[] = [];
  let toolCount = 0;
  for (const raw of items) {
    const item = raw as { kind?: string; role?: string; content?: string };
    if (!item || typeof item.kind !== "string") continue;
    if (item.kind === "text" && item.role === "assistant" && typeof item.content === "string") {
      texts.push(item.content);
    } else if (item.kind === "tool-call") {
      toolCount += 1;
    }
  }
  const joined = texts.join("").trim();
  if (joined) {
    if (joined.length <= MAX_SUMMARY_CHARS) return joined;
    const head = joined.slice(0, Math.floor(MAX_SUMMARY_CHARS / 2));
    const tail = joined.slice(joined.length - Math.floor(MAX_SUMMARY_CHARS / 2));
    return `${head}\n…[truncated]…\n${tail}`;
  }
  return toolCount > 0 ? `Completed ${toolCount} tool action${toolCount > 1 ? "s" : ""}.` : "(no output)";
}

export function createDelegateAgentRunner(webContents: WebContents | undefined): DelegateAgentRunner {
  return async (args: CliRunArgs): Promise<DelegateRunResult> => {
    const collected: unknown[] = [];
    let exitCode: number | null = null;
    let errored: string | null = null;

    // When a conversation is present, mirror workflowRuntime.executeStep: post
    // a placeholder assistant message (taskId links it to the live cli://
    // stream), stream collected items into it on a debounce, then flip the
    // status once cliRun settles. Without a conversationId we harvest only.
    const conversationId = args.conversationId;
    let messageId: string | undefined;
    let flushTimer: NodeJS.Timeout | undefined;

    const broadcastMsg = (type: "appended" | "updated") => {
      if (messageId && conversationId) {
        safeSendToWebContents(webContents, `workflow://message/${conversationId}`, {
          type,
          conversationId,
          messageId
        });
      }
    };

    const scheduleFlush = () => {
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = undefined;
        if (messageId) {
          updateMessage({ id: messageId, content: JSON.stringify(collected) });
          broadcastMsg("updated");
        }
      }, 300);
    };

    if (conversationId) {
      messageId = randomUUID();
      appendMessage({
        id: messageId,
        conversationId,
        role: "assistant",
        status: "running",
        content: "[]",
        taskId: args.sessionId,
        agentId: args.agentId,
        agentName: args.agentName,
        adapter: args.adapter,
        roleLabel: args.roleLabel
      });
      broadcastMsg("appended");
    }

    try {
      await cliRun(webContents as WebContents, args, (e) => {
        if (e.type === "items") {
          const items = (e as { items?: unknown[] }).items;
          if (items?.length) {
            collected.push(...items);
            if (messageId) scheduleFlush();
          }
        } else if (e.type === "done") {
          exitCode = (e as { exitCode: number }).exitCode;
        } else if (e.type === "error") {
          errored = (e as { message: string }).message;
        }
      });
    } finally {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = undefined;
      }
      if (messageId) {
        updateMessage({
          id: messageId,
          content: JSON.stringify(collected),
          status: errored ? "failed" : "done"
        });
        broadcastMsg("updated");
      }
    }
    return {
      summary: summarizeDelegateOutput(collected),
      exitCode,
      error: errored
    };
  };
}
