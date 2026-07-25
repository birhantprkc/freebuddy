import { backfillMissingOwners } from "./conversations.js";
import { backfillScheduledTaskOwners } from "./scheduledTasks.js";
import { migrateGlobalRootsToOwner } from "./users.js";

// Rows created before per-user ownership existed have no owner_id, which would
// hide them from every remote user. Attach them to the desktop owner as soon as
// an owner exists, not just on the next launch.
export function applyOwnerBackfill(ownerId: string): void {
  backfillMissingOwners(ownerId);
  backfillScheduledTaskOwners(ownerId);
  migrateGlobalRootsToOwner(ownerId);
}
