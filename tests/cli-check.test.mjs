import test from "node:test";
import assert from "node:assert/strict";

import { getAdapterDefinition, getCliCheckProbe, applyDshAcpNpmInstallEnv, dshAcpWindowsResiduePath } from "../dist-electron/cli/adapters.js";

test("Codex ACP checks the new Agent Client Protocol package version", () => {
  assert.deepEqual(getCliCheckProbe("codex-acp"), {
    args: ["--version"],
    versionOptional: false
  });
});

test("Codex ACP install command force-overwrites the retired Zed package binary", () => {
  assert.equal(
    getAdapterDefinition("codex-acp")?.installHint,
    "npm install -g --force @agentclientprotocol/codex-acp"
  );
});

test("Claude ACP checks the delegated CLI version instead of starting ACP", () => {
  assert.deepEqual(getCliCheckProbe("claude-agent-acp"), {
    args: ["--cli", "--version"],
    versionOptional: false
  });
});

test("Claude ACP install includes its optional platform runtime", () => {
  assert.equal(
    getAdapterDefinition("claude-agent-acp")?.installHint,
    "npm install -g --include=optional @agentclientprotocol/claude-agent-acp"
  );
});

test("Grok ACP checks the local Grok CLI version command", () => {
  assert.deepEqual(getCliCheckProbe("grok-acp"), {
    args: ["version"],
    versionOptional: false
  });
});

test("legacy adapters still require a version response", () => {
  assert.deepEqual(getCliCheckProbe("codex"), {
    args: ["--version"],
    versionOptional: false
  });
});

test("agy-acp checks agy-acp binary probe", () => {
  assert.deepEqual(getCliCheckProbe("agy-acp"), {
    args: ["--version"],
    versionOptional: true
  });
});

test("dsh-acp install uses next plus optional koffi prebuilds", () => {
  assert.deepEqual(getCliCheckProbe("dsh-acp"), {
    args: [],
    versionOptional: true,
    skipSpawn: true
  });
  assert.equal(
    getAdapterDefinition("dsh-acp")?.installHint,
    "npm install -g --include=optional --ignore-scripts @deepseek-ai/dsh-acp-demo@next"
  );
  assert.equal(getAdapterDefinition("dsh-acp")?.defaultBinary, "dsh-acp-demo");
});

test("dsh-acp npm installs skip koffi rebuild scripts", () => {
  const env = applyDshAcpNpmInstallEnv("dsh-acp", { PATH: "/usr/bin" });
  assert.equal(env.npm_config_ignore_scripts, "true");
  assert.equal(env.npm_config_include, "optional");
  assert.equal(env.npm_config_optional, "true");
  assert.equal(
    applyDshAcpNpmInstallEnv("codex-acp", { PATH: "/usr/bin" }).npm_config_ignore_scripts,
    undefined
  );
  if (process.platform === "win32") {
    assert.equal(
      dshAcpWindowsResiduePath({ APPDATA: "C:\\Users\\x\\AppData\\Roaming" }),
      "C:\\Users\\x\\AppData\\Roaming\\npm\\node_modules\\@deepseek-ai"
    );
  } else {
    assert.equal(
      dshAcpWindowsResiduePath({ APPDATA: "C:\\Users\\x\\AppData\\Roaming" }),
      undefined
    );
  }
});
