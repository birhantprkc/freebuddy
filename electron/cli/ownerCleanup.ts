import { getDb } from "./db.js";
import { deleteConversation } from "./conversations.js";
import { deleteScheduledTask } from "./scheduledTasks.js";
import type { UserDataFootprint } from "./users.js";

/**
 * Removes everything a remote account owns before the account row goes away.
 *
 * The per-record helpers are used deliberately: `deleteConversation` also
 * releases managed attachment files, and `deleteScheduledTask` refuses to drop
 * a task that is mid-run and notifies subscribers.
 */
export function deleteUserOwnedData(userId: string): UserDataFootprint {
  const db = getDb();
  const conversationIds = (
    db
      .prepare("SELECT id FROM conversations WHERE owner_id = ?")
      .all(userId) as Array<{ id: string }>
  ).map((row) => row.id);
  const taskIds = (
    db
      .prepare("SELECT id FROM scheduled_tasks WHERE owner_id = ?")
      .all(userId) as Array<{ id: string }>
  ).map((row) => row.id);

  let scheduledTasks = 0;
  for (const id of taskIds) {
    if (deleteScheduledTask(id)) scheduledTasks += 1;
  }
  for (const id of conversationIds) {
    deleteConversation(id);
  }
  return { conversations: conversationIds.length, scheduledTasks };
}
