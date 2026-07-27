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
    sandbox,
    /entry\.replaceAll\("@localhost:",\s*"@127\.0\.0\.1:"\)/,
    "CodeBuddy must not perform a blocked localhost DNS lookup for the SRT proxy"
  );
  assert.match(
    acpRuntime,
    /if \(args\.conversationId && !sandboxedCaller\)/,
    "remote WebUI sessions must not receive desktop-only Draft/Browser MCP servers"
  );
});

test("remote terminal events are broadcast before their session owner is cleared", () => {
  const acpRuntime = fs.readFileSync(
    new URL("../electron/cli/acpRuntime.ts", import.meta.url),
    "utf8"
  );
  const legacyRuntime = fs.readFileSync(
    new URL("../electron/cli/legacyRuntime.ts", import.meta.url),
    "utf8"
  );

  const acpFinish = acpRuntime.slice(
    acpRuntime.indexOf("const finish ="),
    acpRuntime.indexOf("const cancelRun")
  );
  assert.ok(
    acpFinish.indexOf('emit({ type: "done"') <
      acpFinish.indexOf("clearSessionOwner(args.sessionId)"),
    "ACP done must retain the owner mapping while the WebUI broadcaster routes it"
  );

  const legacyClose = legacyRuntime.slice(
    legacyRuntime.indexOf('child.on("close"'),
    legacyRuntime.indexOf("capturedSessions.delete")
  );
  assert.ok(
    legacyClose.indexOf('emit({ type: "done"') <
      legacyClose.indexOf("clearSessionOwner(args.sessionId)"),
    "legacy done must retain the owner mapping while the WebUI broadcaster routes it"
  );
});

test("remote callers cannot resume renderer-supplied desktop agent sessions", () => {
  const runtime = fs.readFileSync(
    new URL("../electron/cli/runtime.ts", import.meta.url),
    "utf8"
  );
  const selection = runtime.slice(
    runtime.indexOf("const sandboxed = shouldSandboxCurrentCaller()"),
    runtime.indexOf("insertTask(")
  );
  const remoteBranch = selection.slice(
    selection.indexOf("if (sandboxed)"),
    selection.indexOf("} else {")
  );
  assert.match(remoteBranch, /prev\?\.adapter === args\.adapter/);
  assert.doesNotMatch(
    remoteBranch,
    /args\.toolSessionId/,
    "a WebUI-supplied session id must not cross the owner/workspace boundary"
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
