import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("remote runs and ACP terminal commands use the lightweight sandbox", () => {
  const runtime = fs.readFileSync(
    new URL("../electron/cli/runtime.ts", import.meta.url),
    "utf8"
  );
  const acpRuntime = fs.readFileSync(
    new URL("../electron/cli/acpRuntime.ts", import.meta.url),
    "utf8"
  );
  const sandbox = fs.readFileSync(
    new URL("../electron/cli/sandboxRuntime.ts", import.meta.url),
    "utf8"
  );

  assert.match(runtime, /prepareSandboxedSpawn/);
  assert.match(runtime, /shouldSandboxCurrentCaller/);
  assert.match(
    runtime,
    /await isolateRemoteCwdForCaller\(effectiveArgs\.cwd\)/,
    "every remote agent run must map its cwd to a managed clone"
  );
  assert.match(acpRuntime, /const sandboxedCaller = shouldSandboxCurrentCaller\(\)/);
  assert.match(acpRuntime, /prepareSpawn:\s*sandboxedCaller/);
  assert.match(acpRuntime, /forbidden_path: terminal cwd/);
  assert.match(sandbox, /allowAppleEvents:\s*false/);
  assert.match(sandbox, /allowUnixSockets:\s*\[\]/);
  assert.match(sandbox, /allowLocalBinding:\s*true/);
  assert.match(sandbox, /remote_sandbox_unavailable/);
  assert.match(
    sandbox,
    /env:\s*\{\s*\.\.\.input\.env,\s*\.\.\.wrapped\.env,\s*\.\.\.adapterSandbox\.env\s*\}/,
    "sandbox proxy environment must override inherited host proxy settings before fixed adapter paths"
  );
  assert.match(sandbox, /\{\s*HOME:\s*sandboxHome\s*\}/);
  assert.match(sandbox, /QODER_CONFIG_DIR:\s*qoderConfig/);
  assert.match(sandbox, /TMPDIR:\s*sandboxTmp/);
  assert.match(sandbox, /\.local",\s*"share",\s*"opencode"/);
  assert.match(sandbox, /\.kimi-code/);
  assert.match(sandbox, /CodeBuddyExtension/);
  assert.match(sandbox, /\.grok/);
  assert.match(sandbox, /applicationRuntimeReadPaths/);
  assert.match(sandbox, /host:\s*"::1"/);
  assert.match(sandbox, /entry\.replaceAll\("@localhost:",\s*"@\[::1\]:"\)/);
  assert.match(
    acpRuntime,
    /if \(args\.conversationId && !sandboxedCaller\)/,
    "remote WebUI sessions must not receive desktop-only Draft/Browser MCP servers"
  );
});

test("remote sessions gate task control and interactive decisions by owner", () => {
  const ipc = fs.readFileSync(
    new URL("../electron/cli/ipc.ts", import.meta.url),
    "utf8"
  );
  for (const channel of [
    "cli:kill",
    "cli:permissionDecision",
    "cli:authenticationDecision",
    "cli:authenticationTerminalInput",
    "cli:authenticationTerminalCancel"
  ]) {
    const start = ipc.indexOf(`"${channel}"`);
    assert.notEqual(start, -1, `${channel} handler missing`);
    assert.match(
      ipc.slice(start, start + 1_000),
      /callerCanControlSession/,
      `${channel} must verify the session owner`
    );
  }
});
