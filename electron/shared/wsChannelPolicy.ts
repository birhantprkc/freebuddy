export type WsChannelClass =
  | { kind: "global" }
  | { kind: "session"; sessionId: string }
  | { kind: "drop" };

const GLOBAL_CHANNELS = new Set([
  "cli://runtime",
  "infoCards://changed",
  "conversations://changed",
  "messages://changed"
]);
const CLI_SESSION_PREFIX = "cli://";
const NON_SESSION_CLI_CHANNELS = new Set(["cli://runtime", "cli://install"]);

export function classifyWsChannel(channel: string): WsChannelClass {
  if (GLOBAL_CHANNELS.has(channel)) return { kind: "global" };
  if (channel.startsWith(CLI_SESSION_PREFIX) && !NON_SESSION_CLI_CHANNELS.has(channel)) {
    const sessionId = channel.slice(CLI_SESSION_PREFIX.length);
    if (sessionId) return { kind: "session", sessionId };
  }
  return { kind: "drop" };
}
