import "./fixtures/electron-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";

let Database, bindingAvailable = true;
try { Database = (await import("better-sqlite3")).default; new Database(":memory:").close(); } catch { bindingAvailable = false; }

test("delegation skill seeds as builtin trusted with id 'delegation'", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 unavailable"); return; }
  const db = new Database(":memory:");
  const { migrate, setDbForTest } = await import("../dist-electron/cli/db.js");
  migrate(db); setDbForTest(db);
  t.after(() => { setDbForTest(null); db.close(); });
  const { seedBuiltinSkills, getSkill } = await import("../dist-electron/cli/skills.js");
  seedBuiltinSkills();
  const skill = getSkill("delegation");
  assert.ok(skill, "delegation skill not seeded");
  assert.equal(skill.source, "builtin");
  assert.equal(skill.trusted === 1 || skill.trusted === true, true);
  assert.equal(skill.enabled === 1 || skill.enabled === true, true);
});
