import { registerHandler } from "../invokeRegistry.js";
import {
  listDelegationTeams,
  getDelegationTeam,
  insertDelegationTeam,
  updateDelegationTeam,
  deleteDelegationTeam,
  type UpsertDelegationTeamInput,
  type UpdateDelegationTeamPatch
} from "./delegationTeams.js";
import { getDelegationRun, listDelegationEvents } from "./delegationRuns.js";

export function registerDelegationTeamIpc(): void {
  registerHandler("delegation:listTeams", () => listDelegationTeams());
  registerHandler("delegation:getTeam", (_e, id: string) => getDelegationTeam(id));
  registerHandler("delegation:createTeam", (_e, input: UpsertDelegationTeamInput) =>
    insertDelegationTeam(input)
  );
  registerHandler(
    "delegation:updateTeam",
    (_e, args: { id: string; patch: UpdateDelegationTeamPatch }) =>
      updateDelegationTeam(args.id, args.patch)
  );
  registerHandler("delegation:deleteTeam", (_e, id: string) => deleteDelegationTeam(id));
  registerHandler("delegation:getRun", (_e, runId: string) => getDelegationRun(runId));
  registerHandler("delegation:listEvents", (_e, runId: string) =>
    listDelegationEvents(runId)
  );
}
