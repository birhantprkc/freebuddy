import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getAdapterDefinition, getCliCheckProbe, applyDshAcpNpmInstallEnv, dshAcpWindowsResiduePath, dshAcpInstallCommand, parseDshAcpCompositionPackages, bundledDshAcpConfigPath, dshAcpCompositionReady, dshAcpManagedDemoBin, resolveDshAcpDemoDirFromBinary } from "../dist-electron/cli/adapters.js";

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
  const hint = getAdapterDefinition("dsh-acp")?.installHint;
  assert.equal(hint, dshAcpInstallCommand());
  assert.match(hint ?? "", /^npm install -g --include=optional --ignore-scripts /);
  assert.match(hint ?? "", /@deepseek-ai\/dsh-acp-demo@next/);
  assert.match(hint ?? "", /@deepseek-ai\/dsh-llm-deepseek@next/);
  assert.equal(getAdapterDefinition("dsh-acp")?.defaultBinary, "dsh-acp-demo");
});

test("dsh-acp install command includes every bundled cordis plugin package", () => {
  const yaml = fs.readFileSync(bundledDshAcpConfigPath(), "utf8");
  const hint = dshAcpInstallCommand();
  for (const pkg of parseDshAcpCompositionPackages(yaml)) {
    assert.match(hint, new RegExp(`${pkg.replace("/", "\\/")}@next`));
  }
  const renderer = fs.readFileSync(
    new URL("../src/config/cliAdapters.ts", import.meta.url),
    "utf8"
  );
  assert.equal(renderer.includes(hint), true);
  const prefixed = dshAcpInstallCommand({ prefix: "/tmp/freebuddy-dsh" });
  assert.match(prefixed, /--prefix /);
  assert.equal(prefixed.includes(" -g "), false);
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

test("dsh-acp composition ready requires llm-deepseek beside the demo", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-acp-ready-"));
  const demo = path.join(root, "node_modules", "@deepseek-ai", "dsh-acp-demo");
  fs.mkdirSync(path.join(demo, "lib"), { recursive: true });
  fs.writeFileSync(path.join(demo, "package.json"), "{}");
  const bin = path.join(demo, "lib", "bin.js");
  fs.writeFileSync(bin, "");
  assert.equal(dshAcpCompositionReady(bin), false);

  const probe = path.join(root, "node_modules", "@deepseek-ai", "dsh-llm-deepseek");
  fs.mkdirSync(probe, { recursive: true });
  fs.writeFileSync(path.join(probe, "package.json"), "{}");
  assert.equal(dshAcpCompositionReady(bin), true);
  assert.equal(resolveDshAcpDemoDirFromBinary(bin), demo);
  assert.equal(
    dshAcpManagedDemoBin("/data"),
    path.join(
      "/data",
      "runtimes",
      "dsh-acp",
      "node_modules",
      "@deepseek-ai",
      "dsh-acp-demo",
      "lib",
      "bin.js"
    )
  );
});
