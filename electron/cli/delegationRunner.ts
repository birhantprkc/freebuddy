import type { WebContents } from "electron";
import { cliRun } from "./runtime.js";
import type { CliRunArgs } from "./runtimeShared.js";

export interface DelegateRunResult {
  summary: string;
  exitCode: number | null;
  error: string | null;
}

export type DelegateAgentRunner = (args: CliRunArgs) => Promise<DelegateRunResult>;

const MAX_SUMMARY_CHARS = 12_000;

export function summarizeDelegateOutput(items: unknown[]): string {
  const texts: string[] = [];
  for (const raw of items) {
    const item = raw as { type?: string; text?: string };
    if (item && item.type === "text" && typeof item.text === "string") {
      texts.push(item.text);
    }
  }
  const joined = texts.join("").trim();
  if (joined) {
    if (joined.length <= MAX_SUMMARY_CHARS) return joined;
    const head = joined.slice(0, Math.floor(MAX_SUMMARY_CHARS / 2));
    const tail = joined.slice(joined.length - Math.floor(MAX_SUMMARY_CHARS / 2));
    return `${head}\n…[truncated]…\n${tail}`;
  }
  const toolCount = items.filter((i) => (i as { type?: string }).type === "tool_call").length;
  return toolCount > 0 ? `Completed ${toolCount} tool action${toolCount > 1 ? "s" : ""}.` : "(no output)";
}

export function createDelegateAgentRunner(webContents: WebContents | undefined): DelegateAgentRunner {
  return async (args: CliRunArgs): Promise<DelegateRunResult> => {
    const collected: unknown[] = [];
    let exitCode: number | null = null;
    let errored: string | null = null;
    await cliRun(webContents as WebContents, args, (e) => {
      if (e.type === "items") {
        const items = (e as { items?: unknown[] }).items;
        if (items?.length) collected.push(...items);
      } else if (e.type === "done") {
        exitCode = (e as { exitCode: number }).exitCode;
      } else if (e.type === "error") {
        errored = (e as { message: string }).message;
      }
    });
    return {
      summary: summarizeDelegateOutput(collected),
      exitCode,
      error: errored
    };
  };
}
