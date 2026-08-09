const STORAGE_KEY = "freebuddy.conversations.unread.v1";

export type UnreadConversationKind = "message" | "success" | "failure";

export interface UnreadConversationEntry {
  kind: UnreadConversationKind;
  at: string;
}

export type UnreadConversationMap = Record<string, UnreadConversationEntry>;

const LEGACY_UNREAD_AT = new Date(0).toISOString();
const UNREAD_KINDS = new Set<UnreadConversationKind>([
  "message",
  "success",
  "failure"
]);

function isUnreadEntry(value: unknown): value is UnreadConversationEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (
    UNREAD_KINDS.has(entry.kind as UnreadConversationKind) &&
    typeof entry.at === "string" &&
    entry.at.length > 0
  );
}

export function loadUnreadConversations(): UnreadConversationMap {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const value = JSON.parse(raw);
    if (Array.isArray(value)) {
      return Object.fromEntries(
        value
          .filter((id): id is string => typeof id === "string" && id.length > 0)
          .map((id) => [
            id,
            {
              kind: "message",
              at: LEGACY_UNREAD_AT
            } satisfies UnreadConversationEntry
          ] as const)
      );
    }
    if (!value || typeof value !== "object") return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, UnreadConversationEntry] =>
          entry[0].length > 0 && isUnreadEntry(entry[1])
      )
    );
  } catch {
    return {};
  }
}

export function persistUnreadConversations(unread: UnreadConversationMap): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(unread));
  } catch {
    // Unread state is a progressive enhancement; storage can be unavailable.
  }
}
