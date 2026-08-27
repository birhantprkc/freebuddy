import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { RuntimeHostEnvironment } from "@freebuddy/runtime-host";
import { createElectronRuntimeProcessLauncher } from "./electronRuntimeProcessLauncher.js";
import { bundledRuntimePath } from "./bundledRuntime.js";

const RELEASE_REPO = "maojindao55/freebuddy-runtime";
const CHANNEL_BASE_URL = `https://raw.githubusercontent.com/${RELEASE_REPO}/main/channels`;

function bundledPublicKey(): { keyId: string; publicKey: string } | undefined {
  const candidates = [
    path.join(process.resourcesPath, "runtime-keys", "runtime-release.pub"),
    path.join(process.cwd(), "electron", "runtime", "keys", "runtime-release.pub"),
    path.join(app.getAppPath(), "electron", "runtime", "keys", "runtime-release.pub")
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const publicKey = fs.readFileSync(file, "utf8").trim();
    if (!publicKey) continue;
    return { keyId: "runtime-prod", publicKey };
  }
  return undefined;
}

export function createElectronRuntimeEnvironment(): RuntimeHostEnvironment {
  const trusted = bundledPublicKey();
  return {
    hostId: "freebuddy-desktop",
    hostVersion: app.getVersion(),
    hostApiVersion: "1.0.0",
    hostCapabilities: [
      "agent.execute.v1",
      "workflow.repository.v1",
      "delegation.repository.v1",
      "events.publish.v1"
    ],
    dataDir: app.getPath("userData"),
    bundledRuntimePath: bundledRuntimePath(),
    allowUnsignedDevelopmentRuntime: !app.isPackaged,
    launcher: createElectronRuntimeProcessLauncher(),
    http: { fetch: (url, init) => fetch(url, init) },
    trustedKeys: {
      get: (keyId) => (trusted && keyId === trusted.keyId ? trusted.publicKey : undefined),
      list: () => (trusted ? [trusted] : [])
    },
    clock: {
      now: () => new Date(),
      nowIso: () => new Date().toISOString()
    },
    // Last-known-good is never auto-promoted until the remaining update
    // safety gates are closed. Keep desktop hot updates off.
    update: {
      enabled: false,
      baseUrl: CHANNEL_BASE_URL
    }
  };
}
