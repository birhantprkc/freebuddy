import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMemoryWorkflowRepository } from "../packages/workflow-runtime/dist/index.js";
import {
  DEFAULT_HOST_CAPABILITIES,
  HOST_API_VERSION,
  RUNTIME_RPC_VERSION
} from "../packages/protocol/dist/runtime.js";
import {
  createNodeRuntimeProcessLauncher,
  createRuntimeManager,
  createRuntimeProcessPool,
  resolveRuntimeEntryPath,
  RuntimeRpcSession
} from "../packages/runtime-host/dist/index.js";
import { createHealthyRuntimeLauncher, writeDummyRuntimeEntry } from "./fixtures/runtime-healthy-launcher.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bootstrapEntry = path.join(root, "packages/runtime-entry/dist/bootstrap.js");

const PLAN = {
  name: "One",
  goal: "Ship",
  phases: [
    {
      id: "p1",
      title: "Do",
      parallelism: 1,
      steps: [
        {
          id: "s1",
          title: "Work",
          agentId: "cli-codex-acp",
          mode: "research",
          prompt: "Do the work"
        }
      ]
    }
  ]
};
const AGENTS = [{ id: "cli-codex-acp", name: "Codex", adapter: "codex-acp", enabled: true }];

function helloParams() {
  return {
    hostId: "freebuddy-cli",
    hostVersion: "0.0.0-test",
    hostApiVersion: HOST_API_VERSION,
    hostCapabilities: [...DEFAULT_HOST_CAPABILITIES],
    rpcVersion: RUNTIME_RPC_VERSION
  };
}

function createHostApi(repo) {
  return {
    async invoke(method, params, meta) {
      const args = Array.isArray(params) ? params : [params];
      if (method === "agent.list.v1") {
        return AGENTS.map((agent) => ({
          id: agent.id,
          adapter: agent.adapter,
          agentName: agent.name
        }));
      }
      if (method === "language.get.v1") return "en";
      if (method === "events.publish.v1" || method === "telemetry.track.v1") return true;
      if (method === "delegation.repository.v1.createRun") {
        return { id: "del-1", goal: args[0]?.goal, status: "running", runtimeVersion: meta?.runtimeVersion };
      }
      if (method === "delegation.repository.v1.insertEvent") return "evt-1";
      if (method === "delegation.repository.v1.getRun") return null;
      if (method === "delegation.repository.v1.listEvents") return [];
      if (method === "agent.execute.v1") {
        const payload = args[0] ?? {};
        meta?.emit?.("agent.event", {
          requestId: payload.requestId,
          event: { type: "items", items: [{ kind: "text", content: "ok" }] }
        });
        meta?.emit?.("agent.event", {
          requestId: payload.requestId,
          event: { type: "done", exitCode: 0 }
        });
        return { ok: true };
      }
      if (!method.startsWith("workflow.repository.v1.")) return null;
      const op = method.slice("workflow.repository.v1.".length);
      if (op === "createRun") {
        const input = {
          ...args[0],
          runtimeVersion: args[0].runtimeVersion ?? meta?.runtimeVersion ?? "bundled"
        };
        return repo.createRun(input);
      }
      if (op === "getRun") return repo.getRun(args[0]) ?? null;
      if (op === "updateRun") {
        repo.updateRun(args[0], args[1]);
        return true;
      }
      if (op === "createStep") {
        repo.createStep(args[0]);
        return true;
      }
      if (op === "getSteps") return repo.getSteps(args[0]);
      if (op === "updateStep") {
        repo.updateStep(args[0], args[1]);
        return true;
      }
      if (op === "resetStepsForLoop") {
        repo.resetStepsForLoop(args[0], args[1]);
        return true;
      }
      throw new Error(`unknown host method ${method}`);
    }
  };
}

function testEnv(dataDir, launcher) {
  return {
    hostId: "freebuddy-cli",
    hostVersion: "0.0.0-test",
    hostApiVersion: "1.0.0",
    hostCapabilities: [...DEFAULT_HOST_CAPABILITIES],
    dataDir,
    bundledRuntimePath: dataDir,
    allowUnsignedDevelopmentRuntime: true,
    launcher: launcher ?? createNodeRuntimeProcessLauncher(),
    http: { fetch },
    trustedKeys: { get: () => undefined, list: () => [] },
    clock: { now: () => new Date(), nowIso: () => new Date().toISOString() }
  };
}

test("resolveRuntimeEntryPath prefers bundled runtime/index.mjs", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-entry-"));
  const bundled = path.join(dataDir, "bundled");
  fs.mkdirSync(path.join(bundled, "runtime"), { recursive: true });
  const entry = path.join(bundled, "runtime", "index.mjs");
  fs.writeFileSync(entry, "export {}\n");
  const resolved = resolveRuntimeEntryPath(
    {
      ...testEnv(dataDir),
      bundledRuntimePath: bundled
    },
    "bundled"
  );
  assert.equal(resolved, entry);
});

test("node runtime process handshake, workflow RPC, shutdown, and forced kill", async () => {
  assert.equal(fs.existsSync(bootstrapEntry), true, "bootstrap must be compiled");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-proc-"));
  const repo = createMemoryWorkflowRepository();
  const hostApi = createHostApi(repo);
  const pool = createRuntimeProcessPool({
    environment: testEnv(dataDir),
    hostApi
  });
  const client = await pool.ensure("bundled", bootstrapEntry);
  const hello = await client.request("runtime.hello", helloParams());
  assert.equal(hello.rpcVersion, RUNTIME_RPC_VERSION);
  assert.equal(hello.bundleId, "dev.freebuddy.runtime");

  const health = await client.request("runtime.health", {});
  assert.equal(health.ok, true);

  const created = await client.request("workflow.createPendingRun", {
    plan: PLAN,
    agents: AGENTS
  });
  assert.equal(created.ok, true);
  assert.ok(created.run.id);
  assert.equal(created.run.runtimeVersion, "bundled");
  assert.equal(repo.getRun(created.run.id)?.runtimeVersion, "bundled");

  await client.request("workflow.start", { runId: created.run.id });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const run = repo.getRun(created.run.id);
  assert.ok(run);
  assert.notEqual(run.status, "pending_approval");

  const prepared = await client.request("delegation.prepareRun", {
    goal: "delegate",
    teamId: "team-1",
    teamSnapshot: {
      entryRoleId: "lead",
      roster: [
        {
          id: "lead",
          label: "Lead",
          agentId: "cli-codex-acp",
          capability: "general",
          canWrite: false
        }
      ],
      policy: {
        allowWrites: false,
        requireApprovalBeforeDelegateWrite: false,
        maxDepth: 1,
        delegateTimeoutMs: 1000,
        maxConcurrentDelegates: 1,
        stopOnDelegateFailure: true
      }
    }
  });
  assert.equal(typeof prepared.runId, "string");
  assert.ok(prepared.runId.length > 0);

  await client.shutdown();

  const crashed = createNodeRuntimeProcessLauncher().launch({
    entryPath: bootstrapEntry,
    env: { ...process.env, FB_RUNTIME_PROCESS: "1" }
  });
  const exitCode = await new Promise((resolve) => {
    crashed.onExit((code) => resolve(code));
    setTimeout(() => crashed.kill(), 100);
  });
  assert.notEqual(exitCode, undefined);
});

test("incompatible handshake is rejected before serving work", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-badhello-"));
  const pool = createRuntimeProcessPool({
    environment: testEnv(dataDir),
    hostApi: { invoke: async () => null }
  });
  const client = await pool.ensure("bundled", bootstrapEntry);
  await assert.rejects(
    () =>
      client.request("runtime.hello", {
        ...helloParams(),
        hostApiVersion: "9.0.0"
      }),
    /unsupported host api|handler_failed|rpc error/
  );
  await client.shutdown();
});

test("handshake timeout kills a silent process", async () => {
  const silent = path.join(os.tmpdir(), `fb-silent-${Date.now()}.mjs`);
  fs.writeFileSync(silent, "setInterval(() => {}, 1000);\n");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-to-"));
  process.env.FB_RUNTIME_HELLO_TIMEOUT_MS = "400";
  const pool = createRuntimeProcessPool({
    environment: testEnv(dataDir),
    hostApi: { invoke: async () => null }
  });
  try {
    await assert.rejects(() => pool.ensure("bundled", silent), /rpc timeout|runtime entry/);
  } finally {
    delete process.env.FB_RUNTIME_HELLO_TIMEOUT_MS;
  }
});

test("activating a new default version does not kill pinned process handles", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-pinlive-"));
  writeDummyRuntimeEntry(dataDir);
  const healthy = createHealthyRuntimeLauncher();
  const manager = createRuntimeManager(
    testEnv(dataDir, healthy),
    { invoke: async () => null }
  );
  await manager.activate("bundled");
  assert.equal(manager.route({}).version, "bundled");
  const pinned = manager.route({ runtimeVersion: "1.0.0" });
  assert.equal(pinned.version, "1.0.0");
  assert.equal(pinned.pinned, true);
  assert.equal(healthy.kills.count, 1);
  await manager.shutdown();
  assert.equal(healthy.kills.count, 1);
});
