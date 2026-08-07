import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

async function loadTypeScriptModule(relativePath) {
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

test("ButlerBuddy is a first-class Agent profile backed by Codex ACP", () => {
  const rendererMembers = fs.readFileSync(
    new URL("../src/config/aiMembers.ts", import.meta.url),
    "utf8"
  );
  const electronMembers = fs.readFileSync(
    new URL("../electron/cli/cliMemberBuiltins.ts", import.meta.url),
    "utf8"
  );

  for (const source of [rendererMembers, electronMembers]) {
    assert.match(source, /id: "cli-butlerbuddy"/);
    assert.match(source, /name: "ButlerBuddy"/);
    assert.match(source, /profile: "butler"/);
    assert.match(source, /runtimeKey: "codex-acp"/);
    assert.match(source, /requiredSkillIds: \["butlerbuddy"\]/);
    assert.match(source, /approvalMode: "auto"/);
  }
});

test("ButlerBuddy reuses the underlying runtime availability", async () => {
  const { agentRuntimeKey, buildAgentAvailabilityGroups } =
    await loadTypeScriptModule("../src/utils/agentAvailability.ts");
  const butler = {
    id: "cli-butlerbuddy",
    kind: "cli",
    name: "ButlerBuddy",
    source: "builtin",
    profile: "butler",
    runtimeKey: "codex-acp",
    cli: { adapter: "codex-acp" }
  };
  const codex = {
    id: "cli-codex-acp",
    kind: "cli",
    name: "Codex",
    source: "builtin",
    cli: { adapter: "codex-acp" }
  };
  const groups = buildAgentAvailabilityGroups(
    [butler, codex],
    {
      "codex-acp": {
        adapter: "codex-acp",
        installed: true,
        lastCheckAt: "2026-08-06T00:00:00.000Z",
        updatedAt: "2026-08-06T00:00:00.000Z"
      }
    },
    Date.parse("2026-08-06T01:00:00.000Z")
  );

  assert.equal(agentRuntimeKey(butler), "codex-acp");
  assert.deepEqual(groups.available.map((entry) => entry.member.id), [
    "cli-codex-acp",
    "cli-butlerbuddy"
  ]);
});

test("required ButlerBuddy skills are merged and enforced in Electron", async () => {
  const { mergeRequiredSkillIds } = await loadTypeScriptModule(
    "../electron/cli/agentProfiles.ts"
  );
  assert.deepEqual(
    mergeRequiredSkillIds("cli-butlerbuddy", ["verify-change", "butlerbuddy"]),
    ["butlerbuddy", "verify-change"]
  );
  assert.deepEqual(mergeRequiredSkillIds("cli-codex-acp", ["verify-change"]), [
    "verify-change"
  ]);

  const conversations = fs.readFileSync(
    new URL("../electron/cli/conversations.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    conversations,
    /mergeRequiredSkillIds\(input\.agentId, input\.skillIds\)/
  );
  assert.match(
    conversations,
    /mergeRequiredSkillIds\(conversation\.agentId, skillIds\)/
  );
});

test("the built-in skill and composer expose the protected core capability", () => {
  const skill = fs.readFileSync(
    new URL("../assets/skills/butlerbuddy/SKILL.md", import.meta.url),
    "utf8"
  );
  const composer = fs.readFileSync(
    new URL("../src/components/CLI/ComposerAddMenu.tsx", import.meta.url),
    "utf8"
  );
  const design = fs.readFileSync(
    new URL("../docs/butlerbuddy-design.md", import.meta.url),
    "utf8"
  );

  assert.match(skill, /^---\r?\nname: butlerbuddy\r?\n/);
  assert.match(skill, /request confirmation/i);
  assert.match(skill, /Never write directly to FreeBuddy databases/);
  assert.match(composer, /disabled=\{required\.has\(skill\.id\)\}/);
  assert.match(design, /first-class built-in Agent/);
  assert.match(design, /freebuddy-admin-controlled/);
});

test("ButlerBuddy exposes an always-on-top pet and lightweight chat surface", () => {
  const main = fs.readFileSync(
    new URL("../electron/main.ts", import.meta.url),
    "utf8"
  );
  const preload = fs.readFileSync(
    new URL("../electron/preload.ts", import.meta.url),
    "utf8"
  );
  const renderer = fs.readFileSync(
    new URL("../src/main.tsx", import.meta.url),
    "utf8"
  );
  const pet = fs.readFileSync(
    new URL("../src/components/ButlerBuddy/ButlerBuddyPet.tsx", import.meta.url),
    "utf8"
  );

  assert.match(main, /function createButlerBuddyWindows\(\)/);
  assert.match(main, /surface: "butler-pet" \| "butler-chat"/);
  assert.match(main, /alwaysOnTop: true/);
  assert.match(main, /transparent: true/);
  assert.match(main, /startButlerPetDrag|applyButlerPetDrag/);
  assert.match(main, /butlerDragChatOrigin/);
  assert.match(preload, /ipcRenderer\.send\("butlerBuddy:toggleChat"\)/);
  assert.match(preload, /ipcRenderer\.send\("butlerBuddy:hideChat"\)/);
  assert.match(renderer, /surface === "butler-pet"/);
  assert.match(renderer, /surface === "butler-chat"/);
  assert.match(pet, /butlerbuddy-pet\.png/);
});

test("ButlerBuddy preferences expose a global shortcut with conflict feedback", () => {
  const main = fs.readFileSync(
    new URL("../electron/main.ts", import.meta.url),
    "utf8"
  );
  const preload = fs.readFileSync(
    new URL("../electron/preload.ts", import.meta.url),
    "utf8"
  );
  const settings = fs.readFileSync(
    new URL("../src/components/Settings/GeneralTab.tsx", import.meta.url),
    "utf8"
  );

  assert.match(main, /CommandOrControl\+Shift\+Space/);
  assert.match(main, /globalShortcut\.register\(shortcut, toggleButlerChat\)/);
  assert.match(main, /butlerBuddy:updatePreferences/);
  assert.match(preload, /butlerBuddy:getPreferences/);
  assert.match(settings, /butler-shortcut-recorder/);
  assert.match(settings, /butlerShortcutUnavailable/);
  assert.match(settings, /DEFAULT_BUTLER_SHORTCUT/);
});
test("the ButlerBuddy popover is a persisted real conversation, not a fake panel", () => {
  const chat = fs.readFileSync(
    new URL("../src/components/ButlerBuddy/ButlerBuddyChat.tsx", import.meta.url),
    "utf8"
  );

  assert.match(chat, /butlerbuddy\.petConversationId/);
  assert.match(chat, /entry\.id === BUTLERBUDDY_AGENT_ID/);
  assert.match(chat, /state\.newConversation\(/);
  assert.match(chat, /getState\(\)\.loadMessages\(conversation\.id\)/);
  assert.match(chat, /sendMessage\(\{/);
  assert.match(chat, /butler\.inputPlaceholder/);
  assert.match(chat, /MessageCirclePlus/);
  assert.match(chat, /butler-chat-header-controls/);
  assert.doesNotMatch(chat, /打开插件管理|检查所有 Agent|查看更新/);
});
