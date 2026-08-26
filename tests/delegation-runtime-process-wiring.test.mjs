import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

test("desktop delegation IPC routes orchestration through the runtime process client", () => {
  const ipc = read("electron/cli/delegationIpc.ts");
  assert.match(ipc, /createDelegationRuntimeHandle/);
  assert.match(ipc, /handleDelegationFollowUp/);
  const client = read("electron/runtime/delegationRuntimeClient.ts");
  assert.match(client, /delegation\.prepareRun/);
  assert.match(client, /delegation\.runEntry/);
  assert.match(client, /delegation\.stopRun/);
  assert.match(client, /delegation\.followUp/);
  const handlers = read("packages/runtime-entry/src/rpc/serviceHandlers.ts");
  assert.match(handlers, /"delegation\.stopRun"/);
  assert.match(handlers, /"delegation\.pauseRun"/);
  assert.match(handlers, /"delegation\.resumeRun"/);
  assert.match(handlers, /"delegation\.followUp"/);
});
