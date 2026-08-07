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
});
