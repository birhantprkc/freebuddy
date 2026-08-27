import { createSqliteDelegationRepository } from "@freebuddy/storage-sqlite";
import { sqliteContext } from "../../cli/sqliteContext.js";

export function electronDelegationRepository() {
  return createSqliteDelegationRepository(sqliteContext());
}
