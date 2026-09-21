import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCommand, dshAcpCompositionReady, patchDshAcpManagedRuntime, patchDshAcpRuntimeFromBin } from "../dist-electron/cli/adapters.js";

test("modern standalone owns configuration and is protected from legacy overlays", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "freebuddy-modern-dsh-"));
  try {
    const pkg = path.join(root, "node_modules", "deepseek-harness-acp");
    fs.mkdirSync(path.join(pkg, "lib"), { recursive: true });
    const entry = path.join(pkg, "lib", "bin.js");
    fs.writeFileSync(entry, "");
    fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({
      name: "deepseek-harness-acp", dependencies: { "@deepseek-ai/dsh-base": "0.1.6-alpha.2" }
    }));
    const oldConfig = path.join(root, "cordis.yml");
    fs.writeFileSync(oldConfig, "- name: '@deepseek-ai/dsh-acp-demo'\n");
    assert.equal(dshAcpCompositionReady(entry, oldConfig), false);
    for (const name of ["dsh-base", "dsh-acp", "dsh-app-boot"]) {
      const dep = path.join(pkg, "node_modules", "@deepseek-ai", name);
      fs.mkdirSync(dep, { recursive: true });
      fs.writeFileSync(path.join(dep, "package.json"), "{}");
    }
    assert.equal(dshAcpCompositionReady(entry, oldConfig), true);
    const built = buildCommand({ adapter: "dsh-acp", prompt: "hello", dshAcpRuntimeRoot: root });
    assert.equal(built.bin, "node");
    assert.deepEqual(built.args, ["--disable-warning=ExperimentalWarning", entry]);
    assert.equal(built.env?.NODE_OPTIONS, undefined);
    const custom = buildCommand({ adapter: "dsh-acp", prompt: "hello", binary: entry, extraArgs: ["--config", "custom.yml"] });
    assert.deepEqual(custom.args, ["--disable-warning=ExperimentalWarning", entry, "--config", "custom.yml"]);
    for (const extraArgs of [["--model", "vendor/custom"], ["--model=vendor/custom"], ["-m", "vendor/custom"]]) {
      const byok = buildCommand({ adapter: "dsh-acp", prompt: "hello", binary: entry, extraArgs });
      assert.deepEqual(byok.args, ["--disable-warning=ExperimentalWarning", entry]);
      assert.equal(byok.env.DEEPSEEK_MODEL, "vendor/custom");
    }
    const jsonl = path.join(root, "node_modules", "@deepseek-ai", "dsh-session-persistence-jsonl", "lib");
    fs.mkdirSync(jsonl, { recursive: true });
    const sentinel = path.join(jsonl, "index.js");
    fs.writeFileSync(sentinel, "modern persistence");
    assert.equal(patchDshAcpManagedRuntime(root), 0);
    patchDshAcpRuntimeFromBin(entry);
    assert.equal(fs.readFileSync(sentinel, "utf8"), "modern persistence");
    // Protect a current JSONL package even when scanning a legacy/mixed prefix.
    fs.writeFileSync(path.join(path.dirname(jsonl), "package.json"), JSON.stringify({ version: "0.1.6-alpha.2" }));
    fs.writeFileSync(path.join(pkg, "package.json"), "{}");
    assert.equal(patchDshAcpManagedRuntime(root), 0);
    assert.equal(fs.readFileSync(sentinel, "utf8"), "modern persistence");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
