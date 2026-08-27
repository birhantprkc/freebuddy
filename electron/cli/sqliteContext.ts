import { getCallerUserId, isCallerAdmin } from "./callerContext.js";
import { getDb } from "./db.js";
import type { SqliteStoreContext } from "@freebuddy/storage-sqlite";

export function sqliteContext(): SqliteStoreContext {
  return {
    db: getDb(),
    owner: {
      ownerUserId: getCallerUserId(),
      isAdmin: isCallerAdmin()
    }
  };
}
