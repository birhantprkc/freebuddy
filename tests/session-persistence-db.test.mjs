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

function addUser(db, id, username, isOwner = 0) {
  db.prepare(
    "INSERT INTO remote_users (id, username, password_hash, is_owner, created_at, disabled) VALUES (?, ?, 'scrypt:x', ?, ?, 0)"
  ).run(id, username, isOwner, Date.now());
}

async function setup() {
  const db = makeDb();
  const { migrate, setDbForTest } = await import("../dist-electron/cli/db.js");
  migrate(db);
  setDbForTest(db);
  const remoteAuth = await import("../dist-electron/remoteAuth.js");
  remoteAuth.__resetInMemorySessionsForTest?.();
  remoteAuth.setSessionRevocationListener(null);
  return { db, remoteAuth };
}

test("sessions persist across an in-memory reset (survives restart)", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  const { db, remoteAuth } = await setup();
  addUser(db, "alice", "alice");

  const token = remoteAuth.createSession("alice");
  assert.equal(remoteAuth.sessionUserId(token), "alice");
  assert.equal(remoteAuth.checkSession(token), true);

  // The DB stores only the token hash, never the raw token.
  const rows = db.prepare("SELECT token_hash, user_id FROM remote_sessions").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, "alice");
  assert.notEqual(rows[0].token_hash, token);
  assert.equal(rows[0].token_hash.length, 64, "sha256 hex");

  // Simulate a restart: drop the in-memory cache, keep the DB. The token (held
  // by the browser cookie) must still validate from the persisted row.
  remoteAuth.__resetInMemorySessionsForTest?.();
  assert.equal(remoteAuth.sessionUserId("missing-token"), null);
  assert.equal(remoteAuth.sessionUserId(token), "alice", "still valid from DB after cache reset");
  assert.equal(remoteAuth.checkSession(token), true);

  remoteAuth.invalidateAllSessions();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM remote_sessions").get().n, 0);
  assert.equal(remoteAuth.sessionUserId(token), null);
});

test("a session stops authenticating once its account is gone or disabled", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  const { db, remoteAuth } = await setup();
  addUser(db, "bob", "bob");
  addUser(db, "carol", "carol");

  const bobToken = remoteAuth.createSession("bob");
  const carolToken = remoteAuth.createSession("carol");
  assert.equal(remoteAuth.sessionUserId(bobToken), "bob");

  db.prepare("UPDATE remote_users SET disabled = 1 WHERE id = ?").run("bob");
  remoteAuth.__resetInMemorySessionsForTest?.();
  assert.equal(remoteAuth.sessionUserId(bobToken), null, "disabled accounts cannot authenticate");
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM remote_sessions WHERE user_id = 'bob'").get().n,
    0,
    "the stale row is dropped on the way out"
  );

  db.prepare("DELETE FROM remote_users WHERE id = ?").run("carol");
  remoteAuth.__resetInMemorySessionsForTest?.();
  assert.equal(remoteAuth.sessionUserId(carolToken), null, "deleted accounts cannot authenticate");
});

test("revoking sessions notifies the socket layer", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  const { db, remoteAuth } = await setup();
  addUser(db, "dave", "dave");
  addUser(db, "erin", "erin");

  const revocations = [];
  remoteAuth.setSessionRevocationListener((event) => revocations.push(event));

  const daveToken = remoteAuth.createSession("dave", { ip: "10.0.0.5", userAgent: "Safari" });
  const erinToken = remoteAuth.createSession("erin");

  const records = remoteAuth.listSessionRecords();
  assert.equal(records.length, 2);
  const daveRecord = records.find((r) => r.userId === "dave");
  assert.equal(daveRecord.ip, "10.0.0.5");
  assert.equal(daveRecord.userAgent, "Safari");

  assert.equal(remoteAuth.revokeSessionByHash(daveRecord.tokenHash), true);
  assert.deepEqual(revocations.at(-1), { tokens: [daveRecord.tokenHash] });
  assert.equal(remoteAuth.sessionUserId(daveToken), null);

  remoteAuth.invalidateUserSessions("erin");
  assert.deepEqual(revocations.at(-1), { userIds: ["erin"] });
  assert.equal(remoteAuth.sessionUserId(erinToken), null);

  remoteAuth.setSessionRevocationListener(null);
});

test("logging out destroys the server-side session", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  const { db, remoteAuth } = await setup();
  addUser(db, "frank", "frank");

  const token = remoteAuth.createSession("frank");
  assert.equal(remoteAuth.checkSession(token), true);
  remoteAuth.destroySession(token);
  assert.equal(remoteAuth.checkSession(token), false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM remote_sessions").get().n, 0);
  assert.match(
    remoteAuth.buildExpiredSessionCookieHeader(),
    /Max-Age=0/,
    "the HttpOnly cookie is expired for the browser"
  );
});
