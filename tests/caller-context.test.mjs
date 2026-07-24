import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

async function loadCallerContext() {
  const source = fs.readFileSync(
    new URL("../electron/cli/callerContext.ts", import.meta.url),
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

test("getCallerUserId returns null outside a caller context", async () => {
  const { getCallerUserId } = await loadCallerContext();
  assert.equal(getCallerUserId(), null);
});

test("runAsCaller exposes the userId synchronously and across awaits", async () => {
  const { runAsCaller, getCallerUserId } = await loadCallerContext();

  const result = runAsCaller("u1", () => {
    assert.equal(getCallerUserId(), "u1");
    return 42;
  });
  assert.equal(result, 42);
  assert.equal(getCallerUserId(), null, "cleared after run");

  await runAsCaller("u2", async () => {
    assert.equal(getCallerUserId(), "u2");
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(getCallerUserId(), "u2", "preserved across await");
  });
  assert.equal(getCallerUserId(), null);
});

test("nested runAsCaller overrides then restores", async () => {
  const { runAsCaller, getCallerUserId } = await loadCallerContext();

  await runAsCaller("outer", async () => {
    assert.equal(getCallerUserId(), "outer");
    runAsCaller("inner", () => {
      assert.equal(getCallerUserId(), "inner");
    });
    assert.equal(getCallerUserId(), "outer", "restored after nested run");
  });
});

test("isCallerAdmin reflects the admin flag passed to runAsCaller", async () => {
  const { runAsCaller, isCallerAdmin } = await loadCallerContext();

  assert.equal(isCallerAdmin(), false, "default outside a run is not admin");
  runAsCaller("alice", () => {
    assert.equal(isCallerAdmin(), false, "regular user is not admin");
  });
  runAsCaller(
    "owner",
    () => {
      assert.equal(isCallerAdmin(), true, "admin flag is threaded through");
    },
    true
  );
});
