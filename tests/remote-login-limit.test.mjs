import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

async function loadLimiter() {
  const source = fs.readFileSync(
    new URL("../electron/remoteLoginLimit.ts", import.meta.url),
    "utf8"
  );
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`
  );
}

test("the first few attempts are free, then lockouts grow exponentially", async () => {
  const limiter = await loadLimiter();
  limiter.resetLoginLimits();
  const key = limiter.loginAttemptKey("192.168.1.9", "owner");
  const now = 1_000_000;

  for (let i = 0; i < 5; i += 1) {
    assert.equal(limiter.recordLoginFailure(key, now), 0, `attempt ${i + 1} is free`);
    assert.equal(limiter.checkLoginAllowed(key, now).allowed, true);
  }

  assert.equal(limiter.recordLoginFailure(key, now), 2000);
  assert.equal(limiter.checkLoginAllowed(key, now).allowed, false);
  assert.equal(limiter.checkLoginAllowed(key, now + 2000).allowed, true, "lock expires");

  assert.equal(limiter.recordLoginFailure(key, now), 4000);
  assert.equal(limiter.recordLoginFailure(key, now), 8000);
});

test("the lockout is capped and a success clears the counter", async () => {
  const limiter = await loadLimiter();
  limiter.resetLoginLimits();
  const key = limiter.loginAttemptKey("10.0.0.1", "member");
  const now = 2_000_000;

  let delay = 0;
  for (let i = 0; i < 40; i += 1) delay = limiter.recordLoginFailure(key, now);
  assert.equal(delay, 15 * 60 * 1000, "capped at fifteen minutes");

  limiter.recordLoginSuccess(key);
  assert.equal(limiter.checkLoginAllowed(key, now).allowed, true);
  assert.equal(limiter.recordLoginFailure(key, now), 0, "counter restarted");
});

test("counters are scoped per ip and username, and reset when idle", async () => {
  const limiter = await loadLimiter();
  limiter.resetLoginLimits();
  const now = 3_000_000;
  const a = limiter.loginAttemptKey("192.168.1.9", "alice");
  const b = limiter.loginAttemptKey("192.168.1.9", "bob");
  const c = limiter.loginAttemptKey("192.168.1.10", "alice");
  assert.notEqual(a, b);
  assert.notEqual(a, c);

  for (let i = 0; i < 6; i += 1) limiter.recordLoginFailure(a, now);
  assert.equal(limiter.checkLoginAllowed(a, now).allowed, false);
  assert.equal(limiter.checkLoginAllowed(b, now).allowed, true, "other users unaffected");

  const later = now + 31 * 60 * 1000;
  assert.equal(limiter.checkLoginAllowed(a, later).allowed, true);
  assert.equal(limiter.recordLoginFailure(a, later), 0, "idle period cleared the history");
});

test("the login route consults the limiter before verifying the password", () => {
  const server = fs.readFileSync(
    new URL("../electron/webUIServer.ts", import.meta.url),
    "utf8"
  );
  const block = server.slice(
    server.indexOf("async function handleLogin"),
    server.indexOf("async function handleLogout")
  );
  assert.match(block, /checkLoginAllowed\(attemptKey\)/);
  assert.ok(
    block.indexOf("checkLoginAllowed") < block.indexOf("verifyUserLogin"),
    "throttling happens before the password check"
  );
  assert.match(block, /sendJson\(res, 429/, "locked attempts answer with 429");
  assert.match(block, /recordLoginFailure\(attemptKey\)/);
  assert.match(block, /recordLoginSuccess\(attemptKey\)/);
  assert.match(block, /event: "login\.success"/, "successful logins are audited");
});
