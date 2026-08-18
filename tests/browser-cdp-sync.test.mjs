import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("CDP cookie sync service exports findChromeExecutable, checkCdpStatus, launchDebugChrome, syncCookiesFromCdp", async () => {
  const cdpModule = await import("../dist-electron/cdpCookieSyncService.js");
  assert.equal(typeof cdpModule.findChromeExecutable, "function");
  assert.equal(typeof cdpModule.checkCdpStatus, "function");
  assert.equal(typeof cdpModule.launchDebugChrome, "function");
  assert.equal(typeof cdpModule.syncCookiesFromCdp, "function");
});

test("checkCdpStatus returns connected false when debugging port is inactive", async () => {
  const { checkCdpStatus } = await import("../dist-electron/cdpCookieSyncService.js");
  const result = await checkCdpStatus(59999);
  assert.equal(result.connected, false);
});

test("syncCookiesFromCdp returns CDP_NOT_RUNNING when debugging port is inactive", async () => {
  const { syncCookiesFromCdp } = await import("../dist-electron/cdpCookieSyncService.js");
  const result = await syncCookiesFromCdp(59999);
  assert.equal(result.success, false);
  assert.equal(result.error, "CDP_NOT_RUNNING");
});

test("IPC and remoteChannelPolicy expose CDP synchronization channels", () => {
  const policySource = fs.readFileSync(
    new URL("../electron/shared/remoteChannelPolicy.ts", import.meta.url),
    "utf8"
  );
  assert.match(policySource, /"cli:checkCdpStatus"/);
  assert.match(policySource, /"cli:launchDebugChrome"/);
  assert.match(policySource, /"cli:syncCookiesFromCdp"/);

  const ipcSource = fs.readFileSync(
    new URL("../electron/cli/ipc.ts", import.meta.url),
    "utf8"
  );
  assert.match(ipcSource, /registerHandler\("cli:checkCdpStatus"/);
  assert.match(ipcSource, /registerHandler\("cli:launchDebugChrome"/);
  assert.match(ipcSource, /registerHandler\("cli:syncCookiesFromCdp"/);
  assert.match(ipcSource, /registerHandler\("cli:importCookiesFromJson"/);
});

test("importCookiesFromJson parses valid cookie array and reports injected count", async () => {
  const { importCookiesFromJson } = await import("../dist-electron/cdpCookieSyncService.js");
  const sample = JSON.stringify([
    {
      name: "SUB",
      value: "test_val",
      domain: ".weibo.com",
      path: "/",
      secure: true
    },
    {
      name: "user_session",
      value: "sess_123",
      domain: "github.com",
      path: "/"
    }
  ]);
  const result = await importCookiesFromJson(sample);
  assert.equal(result.success, true);
  assert.equal(result.count, 2);
  assert.deepEqual(result.domains.sort(), ["github.com", "weibo.com"]);
});

test("importCookiesFromJson returns error for invalid JSON", async () => {
  const { importCookiesFromJson } = await import("../dist-electron/cdpCookieSyncService.js");
  const result = await importCookiesFromJson("not-valid-json");
  assert.equal(result.success, false);
  assert.equal(result.error, "INVALID_JSON");
});

