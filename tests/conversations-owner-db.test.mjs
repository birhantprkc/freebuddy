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

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  return db;
}

const baseInput = (id) => ({
  id,
  title: id,
  agentId: "agent",
  agentName: "Agent",
  adapter: "codex"
});

test("createConversation stamps the caller as owner; listConversations filters by caller", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  const db = makeDb();
  const { migrate, setDbForTest } = await import("../dist-electron/cli/db.js");
  migrate(db);
  setDbForTest(db);
  const { createConversation, listConversations } = await import("../dist-electron/cli/conversations.js");
  const { runAsCaller } = await import("../dist-electron/cli/callerContext.js");

  runAsCaller("alice", () => createConversation(baseInput("a1")));
  runAsCaller("bob", () => createConversation(baseInput("b1")));

  const aliceView = runAsCaller("alice", () => listConversations().map((c) => c.id));
  assert.deepEqual(aliceView, ["a1"]);
  const bobView = runAsCaller("bob", () => listConversations().map((c) => c.id));
  assert.deepEqual(bobView, ["b1"]);

  // Internal calls with no caller see everything (trusted main-process).
  assert.equal(listConversations().length, 2);
});

test("createConversation records ownerId on the row", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  const db = makeDb();
  const { migrate, setDbForTest } = await import("../dist-electron/cli/db.js");
  migrate(db);
  setDbForTest(db);
  const { createConversation, getConversation } = await import("../dist-electron/cli/conversations.js");
  const { runAsCaller } = await import("../dist-electron/cli/callerContext.js");

  runAsCaller("alice", () => createConversation(baseInput("a1")));
  assert.equal(getConversation("a1")?.ownerId, "alice");
});

test("requireOwnedConversation hides other users' conversations", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  const db = makeDb();
  const { migrate, setDbForTest } = await import("../dist-electron/cli/db.js");
  migrate(db);
  setDbForTest(db);
  const { createConversation, requireOwnedConversation } = await import("../dist-electron/cli/conversations.js");
  const { runAsCaller } = await import("../dist-electron/cli/callerContext.js");

  runAsCaller("alice", () => createConversation(baseInput("a1")));
  runAsCaller("bob", () => createConversation(baseInput("b1")));

  assert.equal(runAsCaller("alice", () => requireOwnedConversation("a1")?.id), "a1");
  assert.equal(runAsCaller("alice", () => requireOwnedConversation("b1")), undefined);
  // No caller (internal) still sees the row.
  assert.equal(requireOwnedConversation("b1")?.id, "b1");
});

test("backfillMissingOwners assigns legacy rows to the owner", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  const db = makeDb();
  const { migrate, setDbForTest } = await import("../dist-electron/cli/db.js");
  migrate(db);
  setDbForTest(db);
  const { backfillMissingOwners, getConversation } = await import("../dist-electron/cli/conversations.js");

  db.prepare(
    `INSERT INTO conversations (id, title, agent_id, agent_name, adapter, created_at, updated_at)
     VALUES ('legacy', 'L', 'a', 'A', 'codex', '0', '0')`
  ).run();
  assert.equal(getConversation("legacy")?.ownerId, null);

  const changes = backfillMissingOwners("owner-id");
  assert.equal(changes, 1);
  assert.equal(getConversation("legacy")?.ownerId, "owner-id");
});

test("appendMessage stamps the author username on user messages", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  const db = makeDb();
  const { migrate, setDbForTest } = await import("../dist-electron/cli/db.js");
  migrate(db);
  setDbForTest(db);
  const { createConversation, appendMessage, listMessages } = await import("../dist-electron/cli/conversations.js");

  createConversation(baseInput("c1"));
  appendMessage({
    id: "m1",
    conversationId: "c1",
    role: "user",
    status: "sent",
    content: "hi",
    authorUsername: "alice"
  });
  const msgs = listMessages("c1");
  assert.equal(msgs[0].authorUsername, "alice");
});

test("admin (desktop owner) sees every user's conversations", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  const db = makeDb();
  const { migrate, setDbForTest } = await import("../dist-electron/cli/db.js");
  migrate(db);
  setDbForTest(db);
  const { createConversation, listConversations, requireOwnedConversation } = await import("../dist-electron/cli/conversations.js");
  const { runAsCaller } = await import("../dist-electron/cli/callerContext.js");

  runAsCaller("alice", () => createConversation(baseInput("a1")));
  runAsCaller("bob", () => createConversation(baseInput("b1")));

  // Admin (isAdmin=true) sees all, regardless of the admin's own userId.
  const adminView = runAsCaller(
    "owner",
    () => listConversations().map((c) => c.id).sort(),
    true
  );
  assert.deepEqual(adminView, ["a1", "b1"]);

  // Admin can requireOwnedConversation on another user's conversation.
  assert.equal(
    runAsCaller("owner", () => requireOwnedConversation("a1")?.id, true),
    "a1"
  );

  // A regular user still only sees their own.
  assert.deepEqual(
    runAsCaller("bob", () => listConversations().map((c) => c.id)),
    ["b1"]
  );
});
