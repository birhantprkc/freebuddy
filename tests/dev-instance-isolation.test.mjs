import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relPath) => fs.readFileSync(new URL(relPath, import.meta.url), "utf8");

test("main.ts isolates userData and app name in development mode", () => {
  const main = read("../electron/main.ts");

  assert.match(main, /if\s*\(!app\.isPackaged\)\s*\{/);
  assert.match(main, /app\.setName\("FreeBuddy Dev"\)/);
  assert.match(main, /app\.setPath\("userData",\s*path\.join\(app\.getPath\("appData"\),\s*"freebuddy-dev"\)\)/);
  assert.match(main, /app\.setAppUserModelId\("dev\.freebuddy\.app\.dev"\)/);
  assert.match(main, /title:\s*app\.isPackaged\s*\?\s*APP_NAME\s*:\s*`\$\{APP_NAME\}\s*\[DEV\]`/);
});
