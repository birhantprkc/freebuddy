import "./fixtures/electron-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";

let Database;
let bindingAvailable = true;
try {
  Database = (await import("better-sqlite3")).default;
  new Database(":memory:").close();
} catch {
  bindingAvailable = false;
}

test("seeding builtin workflow teams preserves role skills", async (t) => {
  if (!bindingAvailable) {
    t.skip("better-sqlite3 native binding unavailable");
    return;
  }

  const db = new Database(":memory:");
  const { migrate, setDbForTest } = await import("../dist-electron/cli/db.js");
  const {
    getWorkflowTeam,
    seedBuiltinWorkflowTeams,
    updateWorkflowTeam
  } = await import("../dist-electron/cli/workflowTeams.js");
  migrate(db);
  setDbForTest(db);
  t.after(() => {
    setDbForTest(null);
    db.close();
  });

  seedBuiltinWorkflowTeams();
  const team = getWorkflowTeam("team-delivery-example");
  assert.ok(team);

  const roleId = "role-planner";
  const skillIds = ["skill-debug", "skill-review"];
  updateWorkflowTeam(team.id, {
    roles: team.roles.map((role) =>
      role.id === roleId ? { ...role, skillIds } : role
    )
  });

  seedBuiltinWorkflowTeams();

  const restartedTeam = getWorkflowTeam(team.id);
  const restartedRole = restartedTeam?.roles.find((role) => role.id === roleId);
  assert.deepEqual(restartedRole?.skillIds, skillIds);
});
