import "./fixtures/electron-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

let Database;
let bindingAvailable = true;
try {
  Database = (await import("better-sqlite3")).default;
  new Database(":memory:").close();
} catch {
  bindingAvailable = false;
}

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  return db;
}

async function setup() {
  const db = makeDb();
  const { migrate, setDbForTest } = await import("../dist-electron/cli/db.js");
  migrate(db);
  setDbForTest(db);
  const projects = await import("../dist-electron/cli/projects.js");
  const conversations = await import("../dist-electron/cli/conversations.js");
  return { db, projects, conversations };
}

const abs = (...parts) => path.resolve("/", ...parts);

test("createProject stores folders JSON and primary", async (t) => {
  if (!bindingAvailable) {
    t.skip("better-sqlite3 native binding unavailable");
    return;
  }
  const { db, projects } = await setup();
  const folderA = abs("tmp", "proj-a");
  const folderB = abs("tmp", "proj-b");

  const created = projects.createProject({
    name: "  My Project  ",
    folders: [folderA, folderB, folderA],
    primaryPath: folderB
  });

  assert.equal(created.name, "My Project");
  assert.deepEqual(created.folders, [folderA, folderB]);
  assert.equal(created.primaryPath, folderB);
  assert.ok(created.id);
  assert.ok(created.createdAt);
  assert.ok(created.updatedAt);

  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(created.id);
  assert.equal(row.name, "My Project");
  assert.equal(JSON.parse(row.folders).length, 2);
  assert.equal(row.primary_path, folderB);

  const listed = projects.listProjects();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, created.id);
  assert.deepEqual(projects.getProject(created.id)?.folders, [folderA, folderB]);
});

test("deleteProject clears conversation projectId but keeps conversation", async (t) => {
  if (!bindingAvailable) {
    t.skip("better-sqlite3 native binding unavailable");
    return;
  }
  const { projects, conversations } = await setup();
  const folder = abs("tmp", "keep-conv");
  const project = projects.createProject({
    name: "Keep Conv",
    folders: [folder],
    primaryPath: folder
  });

  conversations.createConversation({
    id: "c-keep",
    title: "c-keep",
    agentId: "agent",
    agentName: "Agent",
    adapter: "codex",
    cwd: folder,
    projectId: project.id
  });

  assert.equal(conversations.getConversation("c-keep")?.projectId, project.id);

  projects.deleteProject(project.id);

  assert.equal(projects.getProject(project.id), null);
  const conv = conversations.getConversation("c-keep");
  assert.ok(conv, "conversation must remain");
  assert.equal(conv.projectId, undefined);
});

test("migrateCwdGroupsToProjects groups by normalized cwd once", async (t) => {
  if (!bindingAvailable) {
    t.skip("better-sqlite3 native binding unavailable");
    return;
  }
  const { db, projects, conversations } = await setup();
  const cwdA = abs("Users", "me", "App");
  const cwdASlash = cwdA + path.sep;
  const cwdB = abs("Users", "me", "Other");

  conversations.createConversation({
    id: "c1",
    title: "c1",
    agentId: "agent",
    agentName: "Agent",
    adapter: "codex",
    cwd: cwdA
  });
  conversations.createConversation({
    id: "c2",
    title: "c2",
    agentId: "agent",
    agentName: "Agent",
    adapter: "codex",
    cwd: cwdASlash
  });
  conversations.createConversation({
    id: "c3",
    title: "c3",
    agentId: "agent",
    agentName: "Agent",
    adapter: "codex",
    cwd: cwdB
  });
  conversations.createConversation({
    id: "c4",
    title: "c4",
    agentId: "agent",
    agentName: "Agent",
    adapter: "codex"
  });

  const first = projects.migrateCwdGroupsToProjects();
  assert.equal(first.migrated, 2);

  const listed = projects.listProjects();
  assert.equal(listed.length, 2);

  const appProject = listed.find((p) => p.name === "App");
  const otherProject = listed.find((p) => p.name === "Other");
  assert.ok(appProject);
  assert.ok(otherProject);
  assert.deepEqual(appProject.folders, [cwdA]);
  assert.equal(appProject.primaryPath, cwdA);

  assert.equal(conversations.getConversation("c1")?.projectId, appProject.id);
  assert.equal(conversations.getConversation("c2")?.projectId, appProject.id);
  assert.equal(conversations.getConversation("c3")?.projectId, otherProject.id);
  assert.equal(conversations.getConversation("c4")?.projectId, undefined);

  const flag = db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get("projects.cwdMigration.v1");
  assert.equal(flag?.value, "1");

  const second = projects.migrateCwdGroupsToProjects();
  assert.equal(second.migrated, 0);
  assert.equal(projects.listProjects().length, 2);
});
