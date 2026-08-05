import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const dialog = read("../src/components/Settings/ExportDebugLogsDialog.tsx");
const chatView = read("../src/components/CLI/ChatView.tsx");
const newTaskStore = read("../src/store/newTaskUiStore.ts");
const promptBuilder = read("../src/utils/agentLogSelfCheck.ts");
const exporter = read("../electron/debugLogExport.ts");
const ipc = read("../electron/cli/ipc.ts");
const preload = read("../electron/preload.ts");
const types = read("../src/types/freebuddy.d.ts");
const remotePolicy = read("../electron/shared/remoteChannelPolicy.ts");
const en = JSON.parse(read("../src/locales/en.json"));
const zh = JSON.parse(read("../src/locales/zh-CN.json"));

test("Agent self-check is the first and recommended conversation mode", () => {
  const agentIndex = dialog.indexOf('t("debugLogs.modeAgent")');
  const standardIndex = dialog.indexOf('t("debugLogs.modeStandard")');
  const fullIndex = dialog.indexOf('t("debugLogs.modeFull")');
  assert.ok(agentIndex >= 0);
  assert.ok(agentIndex < standardIndex);
  assert.ok(standardIndex < fullIndex);
  assert.match(dialog, /setMode\(conversationId \? "agent" : "standard"\)/);
  assert.match(dialog, /mode === "standard" \? "standard" : "full"/);
  assert.match(en.debugLogs.modeAgent, /recommended/i);
  assert.match(zh.debugLogs.modeAgent, /推荐/);
});

test("self-check opens the new conversation page instead of creating one", () => {
  assert.match(dialog, /await debugLogs\.prepareSelfCheck\(\{ conversationId \}\)/);
  assert.match(dialog, /setTaskMode\("normal"\)/);
  assert.match(dialog, /requestNewTask\(\{ cwd: prepared\.path, draft: prompt \}\)/);
  assert.match(dialog, /await setActiveConversation\(undefined\)/);
  assert.doesNotMatch(dialog, /createConversation|requestComposerDraft|members\.find/);
  assert.doesNotMatch(dialog, /sendMessage\(/);
});

test("new conversation page applies the self-check draft and keeps Agent selection", () => {
  assert.match(newTaskStore, /requestedDraft\?: string/);
  assert.match(newTaskStore, /draft\?: string/);
  assert.match(chatView, /setNewTaskDraft\(requestedDraft \?\? ""\)/);
  assert.match(chatView, /<AgentPicker/);
  assert.match(chatView, /selectedMemberId=\{selectedMemberId\}/);
});

test("self-check writes full logs to a temporary directory", () => {
  assert.match(exporter, /collectBundle\(\s*"full"/);
  assert.match(exporter, /readmeText\("full", exportedAt, "conversation"\)/);
  assert.match(exporter, /fs\.mkdtempSync\(path\.join\(os\.tmpdir\(\), SELF_CHECK_DIR_PREFIX\)\)/);
  assert.match(exporter, /path\.join\(target, "environment\.json"\)/);
  assert.match(exporter, /path\.join\(target, "logs"\)/);
  assert.match(exporter, /path\.join\(target, "sessions"\)/);
  assert.match(exporter, /SELF_CHECK_RETENTION_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(ipc, /debugLogs:prepareSelfCheck/);
  assert.match(preload, /prepareSelfCheck:/);
  assert.match(types, /prepareSelfCheck:/);
  assert.match(remotePolicy, /"debugLogs:prepareSelfCheck"/);
});

test("diagnostic prompt contains the temporary directory path, not log contents", () => {
  const prepareIndex = dialog.indexOf("prepareSelfCheck");
  const promptIndex = dialog.lastIndexOf("buildAgentLogSelfCheckPrompt({");
  assert.ok(prepareIndex >= 0 && prepareIndex < promptIndex);
  assert.match(dialog, /logDirectory: prepared\.path/);
  assert.match(promptBuilder, /logDirectory: string/);
  assert.match(promptBuilder, /Review the full diagnostic logs/);
  assert.match(promptBuilder, /Read README\.txt, environment\.json, logs\/, and sessions\//);
  assert.match(promptBuilder, /Separate confirmed facts from possible causes/);
  assert.match(promptBuilder, /Do not modify or delete files in the temporary directory/);
  assert.match(promptBuilder, /conversation\.id/);
  assert.doesNotMatch(promptBuilder, /preview\.environment|lines\.join|MAX_PROMPT_CHARS/);
});
