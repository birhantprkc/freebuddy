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

test("macOS lightweight sandbox writes inside the workspace but not the host home", async (t) => {
  if (process.platform !== "darwin") {
    t.skip("macOS Seatbelt smoke test");
    return;
  }
  if (!bindingAvailable) {
    t.skip("better-sqlite3 native binding unavailable");
    return;
  }

  const db = new Database(":memory:");
  const { migrate, setDbForTest } = await import("../dist-electron/cli/db.js");
  migrate(db);
  setDbForTest(db);
  const { runAsCaller } = await import("../dist-electron/cli/callerContext.js");
  const { prepareSandboxedSpawn } =
    await import("../dist-electron/cli/sandboxRuntime.js");
  const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "freebuddy-sandbox-"));
  const inside = path.join(workspace, "inside.txt");
  const outside = path.join(
    os.homedir(),
    `.freebuddy-sandbox-denied-${process.pid}-${Date.now()}`
  );

  try {
    const prepared = await runAsCaller("sandbox-user", () =>
      prepareSandboxedSpawn({
        adapter: "codex",
        bin: "/bin/sh",
        args: [
          "-c",
          `printf inside > "${inside}"; printf outside > "${outside}"`
        ],
        cwd: workspace,
        env: { ...process.env }
      })
    );
    const result = spawnSync(prepared.bin, prepared.args, {
      cwd: workspace,
      env: prepared.env,
      encoding: "utf8"
    });
    assert.equal(fs.readFileSync(inside, "utf8"), "inside");
    assert.equal(fs.existsSync(outside), false);
    assert.notEqual(
      result.status,
      0,
      "the shell should report the denied host-home write"
    );
  } finally {
    await SandboxManager.reset();
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
    setDbForTest(null);
    db.close();
  }
});

test("macOS lightweight sandbox resolves a user-local launcher before isolation", async (t) => {
  if (process.platform !== "darwin") {
    t.skip("macOS Seatbelt smoke test");
    return;
  }
  if (!bindingAvailable) {
    t.skip("better-sqlite3 native binding unavailable");
    return;
  }

  const db = new Database(":memory:");
  const { migrate, setDbForTest } = await import("../dist-electron/cli/db.js");
  migrate(db);
  setDbForTest(db);
  const { runAsCaller } = await import("../dist-electron/cli/callerContext.js");
  const { prepareSandboxedSpawn } =
    await import("../dist-electron/cli/sandboxRuntime.js");
  const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "freebuddy-sandbox-"));
  const executableDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "freebuddy-sandbox-executable-")
  );
  const userBinDir = fs.mkdtempSync(
    path.join(os.homedir(), ".freebuddy-sandbox-bin-")
  );
  const executable = path.join(executableDir, "agent-cli");
  const launcher = path.join(userBinDir, "agent-cli");
  fs.writeFileSync(executable, "#!/bin/sh\nprintf launcher-ok\n", {
    mode: 0o700
  });
  fs.symlinkSync(executable, launcher);

  try {
    const prepared = await runAsCaller("sandbox-user", () =>
      prepareSandboxedSpawn({
        adapter: "test-agent",
        bin: "agent-cli",
        args: [],
        cwd: workspace,
        env: {
          ...process.env,
          PATH: `${userBinDir}${path.delimiter}${process.env.PATH ?? ""}`
        }
      })
    );
    const result = spawnSync(prepared.bin, prepared.args, {
      cwd: workspace,
      env: prepared.env,
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "launcher-ok");
  } finally {
    await SandboxManager.reset();
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(executableDir, { recursive: true, force: true });
    fs.rmSync(userBinDir, { recursive: true, force: true });
    setDbForTest(null);
    db.close();
  }
});
