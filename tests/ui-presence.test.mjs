import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

async function loadTs(relativePath) {
  const source = fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
  );
}

const valid = {
  workspaceView: "scheduledTasks",
  settingsOpen: false,
  settingsTab: null,
  activeConversation: {
    id: "c1",
    title: "每周汇报",
    agentId: "cli-codex-acp",
    agentName: "Codex"
  },
  streaming: false,
  unreadCount: 0,
  updatedAt: "2026-08-07T00:00:00.000Z"
};

test("uiPresence stores valid snapshots and rejects malformed ones", async () => {
  const mod = await loadTs("../electron/uiPresence.ts");
  mod.clearMainWindowPresence();
  assert.equal(mod.getMainWindowPresence(), null);
  assert.equal(mod.setMainWindowPresence(valid), true);
  assert.deepEqual(mod.getMainWindowPresence(), valid);
  assert.equal(mod.setMainWindowPresence({ workspaceView: "nope" }), false);
  assert.deepEqual(mod.getMainWindowPresence(), valid);
  mod.clearMainWindowPresence();
  assert.equal(mod.getMainWindowPresence(), null);
});

test("uiPresence formats a stable one-line main-window summary", async () => {
  const mod = await loadTs("../electron/uiPresence.ts");
  const line = mod.formatMainWindowPresenceSummary(valid);
  assert.match(line, /\[FreeBuddy main window\]/);
  assert.match(line, /view=scheduledTasks/);
  assert.match(line, /settings=closed/);
  assert.match(line, /conversation="每周汇报" \(cli-codex-acp\)/);
  assert.match(line, /streaming=false/);
  assert.equal(line.includes("\n"), false);

  const multiline = mod.formatMainWindowPresenceSummary({
    ...valid,
    activeConversation: {
      ...valid.activeConversation,
      title: "一行\n两行"
    }
  });
  assert.equal(multiline.includes("\n"), false);
  assert.match(multiline, /conversation="一行 两行"/);
});

test("main window presence is published through preload and App", () => {
  const preload = fs.readFileSync(
    new URL("../electron/preload.ts", import.meta.url),
    "utf8"
  );
  const main = fs.readFileSync(
    new URL("../electron/main.ts", import.meta.url),
    "utf8"
  );
  const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const types = fs.readFileSync(
    new URL("../src/types/freebuddy.d.ts", import.meta.url),
    "utf8"
  );
  assert.match(preload, /setUiPresence/);
  assert.match(preload, /freebuddy:uiPresence/);
  assert.match(main, /freebuddy:uiPresence/);
  assert.match(main, /clearMainWindowPresence/);
  assert.match(main, /event\.sender !== win\.webContents/);
  assert.match(app, /setUiPresence/);
  assert.match(types, /setUiPresence/);
});

test("status_get and butler skill expose mainWindow presence", () => {
  const service = fs.readFileSync(
    new URL("../electron/butlerToolService.ts", import.meta.url),
    "utf8"
  );
  const mcp = fs.readFileSync(
    new URL("../electron/mcp/butlerMcpServer.ts", import.meta.url),
    "utf8"
  );
  const skill = fs.readFileSync(
    new URL("../assets/skills/butlerbuddy/SKILL.md", import.meta.url),
    "utf8"
  );
  assert.match(service, /getMainWindowPresence/);
  assert.match(service, /mainWindow/);
  assert.match(mcp, /mainWindow/);
  assert.match(skill, /main window|mainWindow|主端/i);
});

test("cli:run prefixes ButlerBuddy prompts with main window summary", () => {
  const ipc = fs.readFileSync(
    new URL("../electron/cli/ipc.ts", import.meta.url),
    "utf8"
  );
  assert.match(ipc, /formatMainWindowPresenceSummary/);
  assert.match(ipc, /BUTLERBUDDY_AGENT_ID/);
  assert.match(ipc, /getMainWindowPresence/);
});
