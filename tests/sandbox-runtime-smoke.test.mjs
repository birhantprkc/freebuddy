import "./fixtures/electron-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
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

function connectToProxy(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("proxy connection timed out"));
    }, 5_000);
    socket.on("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve();
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
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
  const { getDataDir, migrate, setDbForTest } =
    await import("../dist-electron/cli/db.js");
  migrate(db);
  setDbForTest(db);
  const { runAsCaller } = await import("../dist-electron/cli/callerContext.js");
  const { prepareSandboxedSpawn } =
    await import("../dist-electron/cli/sandboxRuntime.js");
  const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");

  const userId = `sandbox-write-user-${process.pid}`;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "freebuddy-sandbox-"));
  const inside = path.join(workspace, "inside.txt");
  const outside = path.join(
    os.homedir(),
    `.freebuddy-sandbox-denied-${process.pid}-${Date.now()}`
  );
  const sandboxHome = path.join(
    getDataDir(),
    "remote-workspaces",
    userId,
    "sandbox-home"
  );

  try {
    const prepared = await runAsCaller(userId, () =>
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
    assert.equal(
      fs.realpathSync.native(prepared.env.TMPDIR),
      fs.realpathSync.native(path.join(sandboxHome, "tmp"))
    );
    assert.notEqual(
      result.status,
      0,
      "the shell should report the denied host-home write"
    );
  } finally {
    await SandboxManager.reset();
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
    fs.rmSync(path.dirname(sandboxHome), { recursive: true, force: true });
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
  const { getDataDir, migrate, setDbForTest } =
    await import("../dist-electron/cli/db.js");
  migrate(db);
  setDbForTest(db);
  const { runAsCaller } = await import("../dist-electron/cli/callerContext.js");
  const { prepareSandboxedSpawn } =
    await import("../dist-electron/cli/sandboxRuntime.js");
  const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");

  const userId = `sandbox-launcher-user-${process.pid}`;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "freebuddy-sandbox-"));
  const sandboxUserRoot = path.join(
    getDataDir(),
    "remote-workspaces",
    userId
  );
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
    const prepared = await runAsCaller(userId, () =>
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
    fs.rmSync(sandboxUserRoot, { recursive: true, force: true });
    fs.rmSync(executableDir, { recursive: true, force: true });
    fs.rmSync(userBinDir, { recursive: true, force: true });
    setDbForTest(null);
    db.close();
  }
});

test("macOS lightweight sandbox permits Agent-internal loopback IPC", async (t) => {
  if (process.platform !== "darwin") {
    t.skip("macOS Seatbelt smoke test");
    return;
  }
  if (!bindingAvailable) {
    t.skip("better-sqlite3 native binding unavailable");
    return;
  }

  const db = new Database(":memory:");
  const { getDataDir, migrate, setDbForTest } =
    await import("../dist-electron/cli/db.js");
  migrate(db);
  setDbForTest(db);
  const { runAsCaller } = await import("../dist-electron/cli/callerContext.js");
  const { prepareSandboxedSpawn } =
    await import("../dist-electron/cli/sandboxRuntime.js?loopback-ipc");
  const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");

  const userId = `sandbox-loopback-user-${process.pid}`;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "freebuddy-sandbox-"));
  const sandboxUserRoot = path.join(
    getDataDir(),
    "remote-workspaces",
    userId
  );
  const script = path.join(workspace, "loopback.mjs");
  fs.writeFileSync(
    script,
    [
      'import net from "node:net";',
      "const server = net.createServer((socket) => socket.end('ok'));",
      'server.listen({ host: "127.0.0.1", port: 0 }, () => {',
      "  const address = server.address();",
      '  const client = net.connect(address.port, "127.0.0.1");',
      '  client.setEncoding("utf8");',
      '  client.on("data", (chunk) => process.stdout.write(chunk));',
      '  client.on("close", () => server.close());',
      "});"
    ].join("\n")
  );

  try {
    const prepared = await runAsCaller(userId, () =>
      prepareSandboxedSpawn({
        adapter: "codebuddy-acp",
        bin: process.execPath,
        args: [script],
        cwd: workspace,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
      })
    );
    const result = spawnSync(prepared.bin, prepared.args, {
      cwd: workspace,
      env: prepared.env,
      encoding: "utf8",
      timeout: 5_000
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "ok");
  } finally {
    await SandboxManager.reset();
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(sandboxUserRoot, { recursive: true, force: true });
    setDbForTest(null);
    db.close();
  }
});

test("Qoder receives a per-user HOME without exposing the host home", async (t) => {
  if (process.platform !== "darwin") {
    t.skip("macOS Seatbelt smoke test");
    return;
  }
  if (!bindingAvailable) {
    t.skip("better-sqlite3 native binding unavailable");
    return;
  }

  const db = new Database(":memory:");
  const { getDataDir, migrate, setDbForTest } =
    await import("../dist-electron/cli/db.js");
  migrate(db);
  setDbForTest(db);
  const { runAsCaller } = await import("../dist-electron/cli/callerContext.js");
  // Previous tests reset the SandboxManager singleton. Import a fresh runtime
  // instance so its one-time initialization state matches that reset manager.
  const { prepareSandboxedSpawn } =
    await import("../dist-electron/cli/sandboxRuntime.js?qoder-proxy");
  const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");

  const userId = `sandbox-qoder-user-${process.pid}`;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "freebuddy-sandbox-"));
  const sandboxHome = path.join(
    getDataDir(),
    "remote-workspaces",
    userId,
    "sandbox-home"
  );

  try {
    const prepared = await runAsCaller(userId, () =>
      prepareSandboxedSpawn({
        adapter: "qoder-acp",
        bin: "/bin/sh",
        args: [
          "-c",
          'realpath "$HOME"; printf "%s\\n" "$QODER_CONFIG_DIR"; realpath "$TMPDIR"; printf agent-tmp > "$TMPDIR/qoder-tool.tmp"'
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
    assert.equal(result.status, 0, result.stderr);
    const outputLines = result.stdout.trim().split("\n");
    assert.equal(outputLines[0], fs.realpathSync.native(sandboxHome));
    const hostQoderConfig = path.join(os.homedir(), ".qoder");
    if (fs.existsSync(hostQoderConfig)) {
      assert.equal(outputLines[1], hostQoderConfig);
    } else {
      assert.equal(prepared.env.QODER_CONFIG_DIR, undefined);
    }
    assert.equal(
      outputLines[2],
      fs.realpathSync.native(path.join(sandboxHome, "tmp"))
    );
    assert.equal(
      fs.readFileSync(path.join(sandboxHome, "tmp", "qoder-tool.tmp"), "utf8"),
      "agent-tmp"
    );
    assert.notEqual(prepared.env.HOME, os.homedir());
    const proxyPort = SandboxManager.getProxyPort();
    assert.ok(proxyPort);
    await connectToProxy("::1", proxyPort);
  } finally {
    await SandboxManager.reset();
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(path.dirname(sandboxHome), { recursive: true, force: true });
    setDbForTest(null);
    db.close();
  }
});
