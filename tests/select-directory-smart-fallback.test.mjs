import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relPath) => fs.readFileSync(new URL(relPath, import.meta.url), "utf8");

test("selectDirectory supports defaultPath and persists last selected workspace in electron ipc", () => {
  const ipc = read("../electron/cli/ipc.ts");
  const preload = read("../electron/preload.ts");
  const client = read("../src/services/cli/client.ts");
  const skillsClient = read("../src/services/skills/client.ts");
  const chatView = read("../src/components/CLI/ChatView.tsx");
  const scheduled = read("../src/components/Settings/ScheduledTasksTab.tsx");
  const projectModal = read("../src/components/CLI/ProjectFormModal.tsx");

  assert.match(ipc, /resolveDefaultOpenDirectory/);
  assert.match(ipc, /LAST_SELECTED_WORKSPACE_KEY\s*=\s*"workspace\.lastSelectedDirectory"/);
  assert.match(ipc, /setSetting\(LAST_SELECTED_WORKSPACE_KEY,\s*selected\)/);
  assert.match(ipc, /dialog\.showOpenDialog\(win,\s*\{\s*properties:\s*\["openDirectory"\],\s*defaultPath/);

  assert.match(preload, /selectDirectory:\s*\(defaultPath\?: string\)\s*=>/);
  assert.match(client, /selectDirectory\(defaultPath\?: string\):\s*Promise<string \| null>/);
  assert.match(skillsClient, /selectDirectory:\s*\(defaultPath\?: string\):\s*Promise<string \| null>/);

  assert.match(chatView, /cliClient\.selectDirectory\(cwd\s*\|\|\s*undefined\)/);
  assert.match(scheduled, /cliClient\.selectDirectory\(draft\.cwd\s*\|\|\s*undefined\)/);
  assert.match(projectModal, /cliClient\.selectDirectory\(primaryPath\s*\|\|\s*folders\[0\]\s*\|\|\s*undefined\)/);
});
