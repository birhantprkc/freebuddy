import type { OwnerContext, SqliteDatabase } from "./types.js";

export function ownsConversation(
  db: SqliteDatabase,
  owner: OwnerContext,
  conversationId: string | null | undefined
): boolean {
  if (owner.isAdmin || owner.ownerUserId === null) return true;
  if (!conversationId) return false;
  const row = db
    .prepare("SELECT owner_id FROM conversations WHERE id = ?")
    .get(conversationId) as { owner_id: string | null } | undefined;
  return row?.owner_id === owner.ownerUserId;
}

export function canAccessDelegationRun(
  db: SqliteDatabase,
  owner: OwnerContext,
  runId: string
): boolean {
  if (owner.isAdmin || owner.ownerUserId === null) return true;
  const row = db
    .prepare(
      `SELECT wr.conversation_id, c.owner_id
       FROM workflow_runs wr
       LEFT JOIN conversations c ON c.id = wr.conversation_id
       WHERE wr.id = ? AND wr.kind = 'delegation'`
    )
    .get(runId) as
    | { conversation_id: string | null; owner_id: string | null }
    | undefined;
  return Boolean(row?.conversation_id) && row?.owner_id === owner.ownerUserId;
}

export function getDelegationRunOwnerId(
  db: SqliteDatabase,
  runId: string
): string | null {
  const row = db
    .prepare(
      `SELECT c.owner_id
       FROM workflow_runs wr
       LEFT JOIN conversations c ON c.id = wr.conversation_id
       WHERE wr.id = ? AND wr.kind = 'delegation'`
    )
    .get(runId) as { owner_id: string | null } | undefined;
  return row?.owner_id ?? null;
}
