import "./fixtures/electron-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

let Database;
let bindingAvailable = true;
try {
  Database = (await import("better-sqlite3")).default;
  new Database(":memory:").close();
} catch {
  bindingAvailable = false;
}

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test("remote workspaces create and reuse an independent clone per user", async (t) => {
  if (!bindingAvailable) {
    t.skip("better-sqlite3 native binding unavailable");
    return;
  }
  const db = new Database(":memory:");
  const { migrate, setDbForTest } = await import("../dist-electron/cli/db.js");
  migrate(db);
  setDbForTest(db);
  const { ensureRemoteWorkspace, listRemoteWorkspaces, removeRemoteWorkspacesForUser } =
    await import("../dist-electron/cli/remoteWorkspaces.js");

  const source = fs.mkdtempSync(path.join(os.tmpdir(), "freebuddy-source-"));
  const userId = `workspace-test-${process.pid}`;
  git(["init"], source);
  fs.writeFileSync(path.join(source, "README.md"), "source\n");
  git(["add", "README.md"], source);
  git(
    [
      "-c",
      "user.name=FreeBuddy Test",
      "-c",
      "user.email=test@freebuddy.invalid",
      "commit",
      "-m",
      "initial"
    ],
    source
  );

  try {
    const first = await ensureRemoteWorkspace(userId, source, [source]);
    const second = await ensureRemoteWorkspace(userId, source, [source]);
    assert.equal(first, second);
    assert.notEqual(fs.realpathSync(first), fs.realpathSync(source));
    assert.equal(fs.readFileSync(path.join(first, "README.md"), "utf8"), "source\n");
    assert.equal(listRemoteWorkspaces(userId).length, 1);
    assert.equal(
      git(["remote", "get-url", "--push", "origin"], first),
      "disabled://freebuddy-managed-workspace"
    );

    fs.writeFileSync(path.join(first, "README.md"), "isolated\n");
    assert.equal(
      fs.readFileSync(path.join(source, "README.md"), "utf8"),
      "source\n",
      "editing the managed clone must not modify the assigned source checkout"
    );
  } finally {
    removeRemoteWorkspacesForUser(userId);
    fs.rmSync(source, { recursive: true, force: true });
    setDbForTest(null);
    db.close();
  }
});
