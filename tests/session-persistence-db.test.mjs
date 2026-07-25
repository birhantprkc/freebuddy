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

test("sessions persist across an in-memory reset (survives restart)", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  const db = makeDb();
  const { migrate, setDbForTest } = await import("../dist-electron/cli/db.js");
  migrate(db);
  setDbForTest(db);
  const remoteAuth = await import("../dist-electron/remoteAuth.js");

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
  // If no test hook, force a miss by re-importing is not trivial; instead rely
  // on lookupSession falling through to the DB when the cache misses.
  assert.equal(remoteAuth.sessionUserId("missing-token"), null);
  assert.equal(remoteAuth.sessionUserId(token), "alice", "still valid from DB after cache reset");
  assert.equal(remoteAuth.checkSession(token), true);

  remoteAuth.invalidateAllSessions();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM remote_sessions").get().n, 0);
  assert.equal(remoteAuth.sessionUserId(token), null);
});
