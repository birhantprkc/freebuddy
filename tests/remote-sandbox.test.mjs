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
  assert.match(acpRuntime, /prepareSpawn:\s*shouldSandboxCurrentCaller/);
  assert.match(acpRuntime, /forbidden_path: terminal cwd/);
  assert.match(sandbox, /allowAppleEvents:\s*false/);
  assert.match(sandbox, /allowUnixSockets:\s*\[\]/);
  assert.match(sandbox, /remote_sandbox_unavailable/);
  assert.match(
    sandbox,
    /env:\s*\{\s*\.\.\.input\.env,\s*\.\.\.wrapped\.env,\s*\.\.\.adapterSandbox\.env\s*\}/,
    "sandbox proxy environment must override inherited host proxy settings before fixed adapter paths"
  );
  assert.match(sandbox, /HOME:\s*sandboxHome,/);
  assert.match(sandbox, /QODER_CONFIG_DIR:\s*qoderConfig/);
  assert.match(sandbox, /host:\s*"::1"/);
  assert.match(sandbox, /entry\.replaceAll\("@localhost:",\s*"@\[::1\]:"\)/);
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
