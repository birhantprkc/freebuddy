import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

const updaterSource = read("../electron/updater.ts");
const mainSource = read("../electron/main.ts");
const preloadSource = read("../electron/preload.ts");

test("updater quitAndInstall IPC triggers beforeQuitAndInstall hook", () => {
  assert.match(updaterSource, /registerHandler\("updater:quitAndInstall", async \(\) =>/);
  assert.match(updaterSource, /options\?\.beforeQuitAndInstall/);
  assert.match(updaterSource, /autoUpdater\.quitAndInstall\(false, true\)/);
});

test("main.ts passes beforeQuitAndInstall hook to cleanly unblock quit and destroy windows", () => {
  assert.match(mainSource, /registerUpdaterIpc\(\{/);
  assert.match(mainSource, /beforeQuitAndInstall:\s*async\s*\(\)\s*=>/);
  assert.match(mainSource, /isQuittingApp\s*=\s*true/);
  assert.match(mainSource, /telemetryShutdownStarted\s*=\s*true/);
  assert.match(mainSource, /win\.removeAllListeners\("close"\)/);
  assert.match(mainSource, /win\.destroy\(\)/);
});

test("preload exposes updater.quitAndInstall", () => {
  assert.match(preloadSource, /quitAndInstall:\s*\(\)\s*=>\s*ipcRenderer\.invoke\("updater:quitAndInstall"\)/);
});
