import type { CLIStreamMode, CliStreamItem, ParseContext } from "@freebuddy/protocol/cli";

export type {
  CLIStreamMode,
  CliStreamItem,
  ParseContext,
  ToolCallStatus,
  ToolKind,
  ToolOutputItem
} from "@freebuddy/protocol/cli";

export interface AdapterStreamParser {
  parseStdoutLine(line: string, ctx: ParseContext): CliStreamItem[];
  parseStderrLine?(line: string, ctx: ParseContext): CliStreamItem[];
}

export function tryJson(line: string): any | undefined {
  const t = line.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

export const rawParser: AdapterStreamParser = {
  parseStdoutLine(line) {
    return line ? [{ kind: "raw", content: line }] : [];
  }
};

const registry: Record<CLIStreamMode, AdapterStreamParser | undefined> = {
  "codex-json": undefined,
  "claude-json": undefined,
  "opencode-json": undefined,
  raw: rawParser
};

export function registerParser(mode: CLIStreamMode, parser: AdapterStreamParser) {
  registry[mode] = parser;
}

export function getParser(mode: CLIStreamMode | string): AdapterStreamParser {
  return registry[mode as CLIStreamMode] ?? rawParser;
}
