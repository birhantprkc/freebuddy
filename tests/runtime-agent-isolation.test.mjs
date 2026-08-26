import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { publicAgentProfile, trustedAgentExecution } from "../packages/runtime-host/dist/index.js";

test("runtime agent profiles omit host credentials", () => {
  const profile = publicAgentProfile({
    id: "cli-codex-acp",
    adapter: "codex-acp",
    agentName: "Codex",
    skillIds: ["s1"],
    binary: "/secret/bin",
    extraArgs: ["--api-key", "sk-live"],
    env: { OPENAI_API_KEY: "sk-live", PATH: "/usr/bin" }
  });
  assert.deepEqual(profile, {
    id: "cli-codex-acp",
    adapter: "codex-acp",
    agentName: "Codex",
    skillIds: ["s1"]
  });
  assert.equal("env" in profile, false);
  assert.equal("binary" in profile, false);
  assert.equal("extraArgs" in profile, false);
});

test("host execute uses resolved agent config and ignores runtime-supplied secrets", () => {
  const trusted = trustedAgentExecution(
    {
      id: "cli-codex-acp",
      adapter: "codex-acp",
      agentName: "Codex",
      binary: "/host/bin/codex",
      extraArgs: ["--from-host"],
      env: { OPENAI_API_KEY: "host-secret" },
      skillIds: ["base"]
    },
    {
      agentId: "cli-codex-acp",
      adapter: "evil-adapter",
      agentName: "spoofed",
      binary: "/tmp/malware",
      extraArgs: ["--steal"],
      env: { OPENAI_API_KEY: "runtime-stolen" },
      skillIds: ["delegation"],
      prompt: "do work",
      sessionId: "s1"
    }
  );
  assert.equal(trusted.adapter, "codex-acp");
  assert.equal(trusted.agentName, "Codex");
  assert.equal(trusted.binary, "/host/bin/codex");
  assert.deepEqual(trusted.extraArgs, ["--from-host"]);
  assert.equal(trusted.env.OPENAI_API_KEY, "host-secret");
  assert.deepEqual(trusted.skillIds, ["base", "delegation"]);
  assert.equal(trusted.prompt, "do work");
});

test("runtime host ports do not send agent env over RPC", () => {
  const hostPorts = fs.readFileSync(
    fileURLToPath(new URL("../packages/runtime-entry/src/rpc/hostPorts.ts", import.meta.url)),
    "utf8"
  );
  const desktopApi = fs.readFileSync(
    fileURLToPath(new URL("../electron/runtime/runtimeHostApi.ts", import.meta.url)),
    "utf8"
  );
  assert.doesNotMatch(hostPorts, /env: args\.env/);
  assert.doesNotMatch(hostPorts, /env: request\.env/);
  assert.doesNotMatch(hostPorts, /binary: args\.binary/);
  assert.doesNotMatch(hostPorts, /binary: request\.binary/);
  assert.match(desktopApi, /trustedAgentExecution/);
  assert.match(desktopApi, /publicAgentProfile/);
});
