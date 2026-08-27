import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCliRuntimeHost } from "./fixtures/runtime-cli-host.mjs";
import { createMemoryWorkflowRepository } from "../packages/workflow-runtime/dist/index.js";
import {
  DEFAULT_HOST_CAPABILITIES,
  HOST_API_VERSION
} from "../packages/protocol/dist/runtime.js";

const { createRuntimeManager, createNodeRuntimeProcessLauncher } = await import(
  "../packages/runtime-host/dist/index.js"
);

test("node cli host can construct a runtime manager without electron", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-cli-host-"));
  const { createHealthyRuntimeLauncher, writeDummyRuntimeEntry } = await import(
    "./fixtures/runtime-healthy-launcher.mjs"
  );
  writeDummyRuntimeEntry(dataDir);
  const manager = createCliRuntimeHost({
    dataDir,
    bundledRuntimePath: dataDir,
    launcher: createHealthyRuntimeLauncher()
  });
  await manager.activate("bundled");
  const status = await manager.status();
  assert.equal(status.hostId, "freebuddy-cli");
  assert.equal(status.activeVersion, "bundled");
});

test("runtime-host source has no electron imports", () => {
  const src = fs.readFileSync(
    new URL("../packages/runtime-host/src/index.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(src, /from ["']electron["']/);
});

test("node cli host serves a workflow request through the shared runtime process", async () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const bootstrapEntry = path.join(root, "packages/runtime-entry/dist/bootstrap.js");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-cli-rpc-"));
  const repo = createMemoryWorkflowRepository();
  const manager = createRuntimeManager(
    {
      hostId: "freebuddy-cli",
      hostVersion: "0.0.0-test",
      hostApiVersion: HOST_API_VERSION,
      hostCapabilities: [...DEFAULT_HOST_CAPABILITIES],
      dataDir,
      allowUnsignedDevelopmentRuntime: true,
      launcher: createNodeRuntimeProcessLauncher(),
      http: { fetch },
      trustedKeys: { get: () => undefined, list: () => [] },
      clock: { now: () => new Date(), nowIso: () => new Date().toISOString() }
    },
    {
      async invoke(method, params, meta) {
        const args = Array.isArray(params) ? params : [params];
        if (method === "agent.list.v1") {
          return [{ id: "cli-codex-acp", adapter: "codex-acp", agentName: "Codex" }];
        }
        if (method === "language.get.v1") return "en";
        if (method === "events.publish.v1" || method === "telemetry.track.v1") return true;
        if (method === "agent.execute.v1") {
          meta?.emit?.("agent.event", {
            requestId: args[0]?.requestId,
            event: { type: "done", exitCode: 0 }
          });
          return { ok: true };
        }
        if (method === "workflow.repository.v1.createRun") {
          return repo.createRun({
            ...args[0],
            runtimeVersion: args[0].runtimeVersion ?? meta?.runtimeVersion
          });
        }
        if (method === "workflow.repository.v1.createStep") {
          repo.createStep(args[0]);
          return true;
        }
        if (method === "workflow.repository.v1.getRun") return repo.getRun(args[0]) ?? null;
        if (method === "workflow.repository.v1.getSteps") return repo.getSteps(args[0]);
        if (method === "workflow.repository.v1.updateRun") {
          repo.updateRun(args[0], args[1]);
          return true;
        }
        if (method === "delegation.repository.v1.createRun") {
          return { id: "del-1", goal: args[0]?.goal, status: "running" };
        }
        if (method === "delegation.repository.v1.insertEvent") return "evt-1";
        return null;
      }
    }
  );
  await manager.ensureProcess("bundled", bootstrapEntry);
  const created = await manager.request("bundled", "workflow.createPendingRun", {
    plan: {
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
    },
    agents: [{ id: "cli-codex-acp", name: "Codex", adapter: "codex-acp", enabled: true }]
  });
  assert.equal(created.ok, true);
  const health = await manager.request("bundled", "runtime.health", {});
  assert.equal(health.ok, true);
  await manager.shutdown();
});
