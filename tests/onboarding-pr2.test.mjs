import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PI_BYOK_EXTENSION_SOURCE,
  ensurePiByokExtension
} from "../dist-electron/cli/piRuntime.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(rootDir, rel), "utf8");
}

test("BYOK extension is written into pi's global extension dir and is idempotent", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-pi-byok-"));
  const file = ensurePiByokExtension(dataDir);
  assert.equal(file, path.join(dataDir, "pi-agent", "extensions", "freebuddy-byok.js"));

  const first = fs.readFileSync(file, "utf8");
  assert.match(first, /registerProvider/);
  assert.match(first, /FREEBUDDY_PI_BYOK/);

  // Rewriting identical content leaves the file untouched.
  const before = fs.statSync(file).mtimeMs;
  ensurePiByokExtension(dataDir);
  assert.equal(fs.statSync(file).mtimeMs, before);
});

test("extension never embeds secrets and honours the protocol mapping", () => {
  // Config (including the key) must arrive via env, not be baked into the file.
  assert.match(PI_BYOK_EXTENSION_SOURCE, /process\.env\.FREEBUDDY_PI_BYOK/);
  assert.doesNotMatch(PI_BYOK_EXTENSION_SOURCE, /sk-[A-Za-z0-9]/);
  assert.match(PI_BYOK_EXTENSION_SOURCE, /api: config\.api \|\| "openai-completions"/);
  assert.match(PI_BYOK_EXTENSION_SOURCE, /"freebuddy-relay"/);
});

test("pi BYOK resolves to env + FREEBUDDY_PI_BYOK payload with protocol mapping", () => {
  const store = read("electron/cli/store.ts");
  assert.match(store, /export function resolvePiByokEnv\(/);
  assert.match(store, /resolvePiByokEnv\(agentId, adapter, selectedModel\)/);
  assert.match(store, /export function piApiForProtocol\(/);
  assert.match(store, /if \(protocol === "anthropic"\) return "anthropic-messages"/);
  assert.match(store, /if \(protocol === "openai-responses"\) return "openai-responses"/);
  // Provider-reference and official-member fallback paths.
  assert.match(store, /resolveByokWithProvider\(overrideId, "pi"\)/);
  assert.match(store, /resolveByokWithProvider\("pi-acp", "pi"\)/);
});

test("piByok is persisted end to end (types, column, upsert, read-back)", () => {
  const store = read("electron/cli/store.ts");
  assert.match(store, /export interface CLIPiByokConfig/);
  assert.match(store, /piByok\?: CLIPiByokConfig/);
  assert.match(store, /function normalizePiByokForStorage\(/);
  assert.match(store, /pi_byok: \(\(\) => \{/);
  assert.match(store, /piByok: readByokPublic<CLIPiByokConfig>\(r\.pi_byok\)/);

  const db = read("electron/cli/db.ts");
  assert.match(db, /ALTER TABLE cli_executor_overrides ADD COLUMN pi_byok TEXT/);

  const types = read("src/services/cli/types.ts");
  assert.match(types, /export interface CLIPiByokConfig/);
  assert.match(types, /piByok\?: CLIPiByokConfig/);
});

test("pi providers accept OpenAI/Anthropic/Responses relays", () => {
  const types = read("src/services/providers/types.ts");
  assert.match(types, /if \(id === "pi-acp"\) \{/);
  assert.match(types, /p === "anthropic"/);
});

test("onboarding overlay is model-free and gated by the onboarding store", () => {
  const overlay = read("src/components/Onboarding/OnboardingWelcomeOverlay.tsx");
  // No LLM round-trip on first paint: only the gateway activation call.
  assert.doesNotMatch(overlay, /cliClient\.(run|send|start)/);
  assert.match(overlay, /activateGuideTrial/);
  assert.match(overlay, /markSkipped/);
  assert.match(overlay, /onOpenSettings\("providers"\)/);

  const store = read("src/store/onboardingStore.ts");
  assert.match(store, /ONBOARDING_STATE_SETTING_KEY/);
  assert.match(store, /hasConfiguredModelAccess/);
  // Existing installs with a configured provider must never see the overlay.
  assert.match(store, /if \(hasConfiguredModelAccess\(\)\)/);
  assert.match(store, /resolved: "done", open: false/);

  const app = read("src/App.tsx");
  assert.match(app, /useOnboardingStore\.getState\(\)\.evaluate\(\)/);
  assert.match(app, /<OnboardingWelcomeOverlay onOpenSettings=\{openSettings\} \/>/);
});

test("gateway client posts the device id and never ships a shared key", () => {
  const client = read("src/services/onboarding/gatewayClient.ts");
  assert.match(client, /X-FreeBuddy-Device-Id/);
  assert.match(client, /getOrCreateDeviceId/);
  assert.match(client, /GUIDE_GATEWAY_ACTIVATE_PATH/);
  // A leaked upstream key would look like a hardcoded sk-/Bearer literal.
  assert.doesNotMatch(client, /"sk-[A-Za-z0-9]{8,}"/);
});
