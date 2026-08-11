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
  assert.match(main, /surface: "butler-pet" \| "butler-chat" \| "butler-screen-ball"/);
  assert.match(main, /alwaysOnTop: true/);
  assert.match(main, /transparent: true/);
  assert.equal(
    main.match(
      /type: process\.platform === "darwin" \? "panel" : undefined/g
    )?.length,
    3,
    "pet, mini chat, and the screen-ball overlay use macOS panels above full-screen Spaces"
  );
  assert.equal(
    main.match(
      /setVisibleOnAllWorkspaces\(true, \{ visibleOnFullScreen: true \}\)/g
    )?.length,
    3,
    "pet, mini chat, and the screen-ball overlay remain visible across macOS workspaces"
  );
  assert.match(main, /startButlerPetDrag|applyButlerPetDrag/);
  assert.match(main, /butlerDragChatOrigin/);
  assert.match(preload, /ipcRenderer\.send\("butlerBuddy:toggleChat"\)/);
  assert.match(preload, /ipcRenderer\.send\("butlerBuddy:hideChat"\)/);
  assert.match(renderer, /surface === "butler-pet"/);
  assert.match(renderer, /surface === "butler-chat"/);
  assert.match(renderer, /surface === "butler-screen-ball"/);
  assert.match(pet, /butlerbuddy\/states/);
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

test("ButlerBuddy entertainment mode expands the pet arena and stays synchronized", () => {
  const main = fs.readFileSync(
    new URL("../electron/main.ts", import.meta.url),
    "utf8"
  );
  const preload = fs.readFileSync(
    new URL("../electron/preload.ts", import.meta.url),
    "utf8"
  );
  const types = fs.readFileSync(
    new URL("../src/types/freebuddy.d.ts", import.meta.url),
    "utf8"
  );
  const settings = fs.readFileSync(
    new URL("../src/components/Settings/GeneralTab.tsx", import.meta.url),
    "utf8"
  );
  const pet = fs.readFileSync(
    new URL("../src/components/ButlerBuddy/ButlerBuddyPet.tsx", import.meta.url),
    "utf8"
  );
  const styles = fs.readFileSync(
    new URL("../styles.css", import.meta.url),
    "utf8"
  );

  assert.match(main, /BUTLER_ENTERTAINMENT_ENABLED_SETTING/);
  assert.match(main, /applyButlerBuddyEntertainmentMode/);
  assert.match(main, /entertainmentEnabled/);
  assert.match(main, /开启小窗弹球/);
  assert.match(main, /结束小窗弹球/);
  assert.match(main, /开启全屏弹球/);
  assert.match(main, /结束全屏弹球/);
  assert.match(preload, /entertainmentEnabled\?: boolean/);
  assert.match(types, /entertainmentEnabled: boolean/);
  assert.match(settings, /butlerEntertainment/);
  assert.match(settings, /butlerScreenBall/);
  assert.match(pet, /onPreferencesChanged/);
  const refreshShortcutHint = pet.slice(
    pet.indexOf("const refreshShortcutHint"),
    pet.indexOf("useEffect(refreshShortcutHint")
  );
  assert.doesNotMatch(refreshShortcutHint, /setEntertainmentEnabled/);
  assert.match(pet, /spawnPetArcadeBall/);
  assert.match(pet, /hitPetArcadeBall/);
  assert.match(pet, /butler-pet-arcade-score/);
  const arcadeBallStyles = styles.slice(
    styles.indexOf(".butler-pet-arcade-ball {"),
    styles.indexOf(".butler-pet-arcade-ball:hover")
  );
  assert.match(
    arcadeBallStyles,
    /transition:\s*filter\s+/,
    "per-frame ball positions must not inherit the global button transition"
  );
  assert.doesNotMatch(arcadeBallStyles, /transition:\s*all/);
});

test("ButlerBuddy full-screen ball mode uses guarded IPC and transparent hit regions", () => {
  const main = fs.readFileSync(
    new URL("../electron/main.ts", import.meta.url),
    "utf8"
  );
  const preload = fs.readFileSync(
    new URL("../electron/preload.ts", import.meta.url),
    "utf8"
  );
  const renderer = fs.readFileSync(
    new URL("../src/components/ButlerBuddy/ButlerBuddyScreenBall.tsx", import.meta.url),
    "utf8"
  );
  assert.match(main, /setIgnoreMouseEvents\(true, \{ forward: true \}\)/);
  assert.match(main, /butlerBuddy:screenBallHitRegions/);
  assert.match(main, /isButlerScreenBallWindowSender/);
  assert.match(main, /displayChangedForScreenBall/);
  assert.match(preload, /screenBallHit/);
  assert.match(preload, /screenBallPointer/);
  assert.match(preload, /onScreenBallSession/);
  assert.match(renderer, /publishScreenBallHitRegions/);
  assert.match(renderer, /onPointerDown/);
  assert.match(renderer, /screenBallIntersectsSegment/);
  assert.match(renderer, /butler-screen-ball-burst/);
  assert.match(renderer, /butler-screen-ball-swipe-trail/);
  assert.match(renderer, /screenBallSwipeHint/);
  assert.doesNotMatch(
    renderer,
    /const isSwiping = \(event\.buttons & 1\)/,
    "forwarded mouse movement must not require a button flag"
  );
  assert.match(renderer, /screenBallReplay/);
  assert.doesNotMatch(
    renderer,
    /butler-screen-ball-launcher|butlerbuddy-pet\.png/,
    "the full-display overlay must not render a second pet"
  );
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

test("Butler UI tools notify the main FreeBuddy window from the pet chat companion", () => {
  // Pet/chat cli:run binds butler tools to the companion webContents. Theme and
  // settings IPC must still target the main App window, which owns the UI shell.
  const service = fs.readFileSync(
    new URL("../electron/butlerToolService.ts", import.meta.url),
    "utf8"
  );
  const main = fs.readFileSync(
    new URL("../electron/main.ts", import.meta.url),
    "utf8"
  );

  assert.match(service, /export function setButlerAppWindowGetter/);
  assert.match(service, /function resolveButlerAppWebContents/);
  assert.match(
    service,
    /case "set_appearance":[\s\S]*?resolveButlerAppWebContents\(binding\.webContents\)/
  );
  assert.match(
    service,
    /case "settings_open":[\s\S]*?resolveButlerAppWebContents\(binding\.webContents\)/
  );
  assert.match(
    service,
    /case "settings_open":[\s\S]*?focusButlerAppWindow\(\)/
  );
  assert.match(main, /setButlerAppWindowGetter\(\(\) =>/);
});

test("Butler navigation tools can open a conversation or main workspace view", () => {
  const service = fs.readFileSync(
    new URL("../electron/butlerToolService.ts", import.meta.url),
    "utf8"
  );
  const mcp = fs.readFileSync(
    new URL("../electron/mcp/butlerMcpServer.ts", import.meta.url),
    "utf8"
  );
  const preload = fs.readFileSync(
    new URL("../electron/preload.ts", import.meta.url),
    "utf8"
  );
  const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const skill = fs.readFileSync(
    new URL("../assets/skills/butlerbuddy/SKILL.md", import.meta.url),
    "utf8"
  );
  const types = fs.readFileSync(
    new URL("../src/types/freebuddy.d.ts", import.meta.url),
    "utf8"
  );

  assert.match(service, /case "conversation_open"/);
  assert.match(service, /case "view_open"/);
  assert.match(service, /window:open-conversation/);
  assert.match(service, /freebuddy:\/\/open-view/);
  assert.match(mcp, /freebuddy_conversation_open/);
  assert.match(mcp, /freebuddy_view_open/);
  assert.match(preload, /onOpenView/);
  assert.match(preload, /freebuddy:\/\/open-view/);
  assert.match(app, /onOpenView/);
  assert.match(types, /onOpenView/);
  assert.match(skill, /freebuddy_conversation_open/);
  assert.match(skill, /freebuddy_view_open/);
});

test("Butler mutations sync conversation list and skills UI across windows", () => {
  const conversations = fs.readFileSync(
    new URL("../electron/cli/conversations.ts", import.meta.url),
    "utf8"
  );
  const skills = fs.readFileSync(
    new URL("../electron/cli/skills.ts", import.meta.url),
    "utf8"
  );
  const service = fs.readFileSync(
    new URL("../electron/butlerToolService.ts", import.meta.url),
    "utf8"
  );
  const preload = fs.readFileSync(
    new URL("../electron/preload.ts", import.meta.url),
    "utf8"
  );
  const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.match(conversations, /export function notifyConversationsChanged/);
  assert.match(
    service,
    /case "conversation_archive":[\s\S]*?notifyConversationsChanged\(\)/
  );
  assert.match(
    service,
    /case "conversation_delete":[\s\S]*?notifyConversationsChanged\(\)/
  );
  assert.match(skills, /export function notifySkillsChanged/);
  assert.match(skills, /notifySkillsChanged\(\)/);
  assert.match(preload, /skills:\/\/changed/);
  assert.match(app, /freebuddy\?\.skills\?\.onChanged/);
});

test("conversation_open supports fuzzy title and failed-status lookup", () => {
  const service = fs.readFileSync(
    new URL("../electron/butlerToolService.ts", import.meta.url),
    "utf8"
  );
  const mcp = fs.readFileSync(
    new URL("../electron/mcp/butlerMcpServer.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    service,
    /case "conversation_open":[\s\S]*?titleQuery[\s\S]*?lastMessageStatus/
  );
  assert.match(mcp, /titleQuery|lastMessageStatus/);
});

test("butler chat follows main FreeBuddy theme", () => {
  const chat = fs.readFileSync(
    new URL("../src/components/ButlerBuddy/ButlerBuddyChat.tsx", import.meta.url),
    "utf8"
  );
  const service = fs.readFileSync(
    new URL("../electron/butlerToolService.ts", import.meta.url),
    "utf8"
  );
  const settings = fs.readFileSync(
    new URL("../src/store/settingsStore.ts", import.meta.url),
    "utf8"
  );
  const styles = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const preload = fs.readFileSync(
    new URL("../electron/preload.ts", import.meta.url),
    "utf8"
  );

  assert.match(chat, /useSettingsStore/);
  assert.match(chat, /onAppearanceChanged/);
  assert.match(chat, /dataset\.theme|data-theme/);
  assert.match(service, /BrowserWindow\.getAllWindows[\s\S]*appearance-changed|appearance-changed[\s\S]*getAllWindows/);
  assert.match(settings, /syncPeers|broadcastTheme/);
  assert.match(preload, /broadcastTheme/);
  assert.match(styles, /\[data-theme="dark"\][\s\S]*?\.butler-chat-window/);
});

test("Butler can read a conversation's messages as plain text pages", () => {
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

  assert.match(service, /case "conversation_messages"/);
  assert.match(service, /listMessages/);
  assert.match(service, /tail/);
  assert.match(mcp, /freebuddy_conversation_messages/);
  assert.match(skill, /freebuddy_conversation_messages/);
});

test("ButlerBuddy runtime state is owned by main and synchronized over a bounded IPC bridge", () => {
  const main = fs.readFileSync(
    new URL("../electron/main.ts", import.meta.url),
    "utf8"
  );
  const preload = fs.readFileSync(
    new URL("../electron/preload.ts", import.meta.url),
    "utf8"
  );
  const types = fs.readFileSync(
    new URL("../src/types/freebuddy.d.ts", import.meta.url),
    "utf8"
  );

  assert.match(main, /createButlerBuddyStateCoordinator/);
  assert.match(main, /butlerBuddy:getRuntimeState/);
  assert.match(main, /butlerBuddy:runtimeStateChanged/);
  assert.match(main, /butlerBuddy:reportTaskResult/);
  assert.match(
    main,
    /setMainWindowPresence\(payload\)[\s\S]*?setStreaming\(/
  );
  assert.match(main, /isButlerBuddyWindowSender/);
  assert.match(main, /isButlerBuddyTaskResultSender/);
  assert.match(main, /scheduleButlerBuddySleepBoundary/);
  assert.match(main, /normalizeButlerBuddyTaskText/);
  assert.match(main, /resolveButlerBuddyTaskPresence/);
  assert.match(main, /taskText/);
  assert.match(preload, /getRuntimeState/);
  assert.match(preload, /onRuntimeStateChanged/);
  assert.match(preload, /reportTaskResult/);
  assert.match(types, /interface ButlerBuddyRuntimeState/);
  assert.match(types, /ButlerBuddyVisualState/);
  assert.match(types, /taskText\?: string/);
});

test("every completed task reaches ButlerBuddy before foreground notification suppression", () => {
  const sounds = fs.readFileSync(
    new URL("../src/utils/soundEffects.ts", import.meta.url),
    "utf8"
  );
  const notifyBlock = sounds.slice(sounds.indexOf("export function notifyTaskFinished"));
  const reportIndex = notifyBlock.indexOf("reportTaskResult");
  const backgroundReturnIndex = notifyBlock.indexOf("if (!background) return");

  assert.ok(reportIndex >= 0, "task result is reported to ButlerBuddy");
  assert.ok(
    reportIndex < backgroundReturnIndex,
    "task result is reported before foreground notifications return early"
  );
  assert.match(notifyBlock, /reportTaskResult\?\.\(kind\)/);
});

test("the pet renderer subscribes to all five states and preserves click and drag behavior", () => {
  const pet = fs.readFileSync(
    new URL("../src/components/ButlerBuddy/ButlerBuddyPet.tsx", import.meta.url),
    "utf8"
  );
  const styles = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");

  for (const state of [
    "idle",
    "working",
    "celebrating",
    "comforting",
    "sleeping"
  ]) {
    assert.match(pet, new RegExp(`${state}:`));
  }
  assert.match(pet, /butlerbuddy\/states\/v2/);
  assert.match(pet, /getRuntimeState/);
  assert.match(pet, /onRuntimeStateChanged/);
  assert.match(pet, /classifyPetPointerRelease/);
  assert.match(pet, /classifyPetClick/);
  assert.match(pet, /data-interaction/);
  assert.match(pet, /butler-pet-task-bubble/);
  assert.match(pet, /<button[\s\S]*?butler-pet-task-bubble/);
  assert.match(pet, /openCurrentTask/);
  assert.match(pet, /taskKind/);
  assert.match(pet, /taskCount/);
  assert.match(pet, /data-task-kind/);
  assert.match(styles, /\.butler-pet-task-bubble[\s\S]*?pointer-events: auto/);
  assert.match(pet, /runtimeState\.taskConversationId/);
  assert.match(pet, /runtimeState\.taskText/);
  assert.doesNotMatch(pet, /butler-pet-online/);
  assert.doesNotMatch(pet, /setInterval/);
  assert.match(styles, /butler-pet-task-track/);
  assert.match(styles, /@keyframes butler-pet-task-scroll/);
  assert.doesNotMatch(
    styles,
    /@keyframes butler-pet-(?:idle|working|celebrating|comforting|sleeping)/
  );
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?butler-pet-art-motion[\s\S]*?butler-pet-task-track/
  );
});

test("ButlerBuddy task bubble opens the authoritative running task in the main window", () => {
  const main = fs.readFileSync(
    new URL("../electron/main.ts", import.meta.url),
    "utf8"
  );
  const preload = fs.readFileSync(
    new URL("../electron/preload.ts", import.meta.url),
    "utf8"
  );
  const types = fs.readFileSync(
    new URL("../src/types/freebuddy.d.ts", import.meta.url),
    "utf8"
  );
  const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.match(main, /butlerBuddy:openCurrentTask/);
  assert.match(main, /hideButlerChat\(\)[\s\S]*?revealMainWindow\(\)[\s\S]*?window:open-conversation/);
  assert.match(main, /resolveButlerBuddyTaskPresence/);
  assert.match(preload, /openCurrentTask.*butlerBuddy:openCurrentTask/);
  assert.match(types, /openCurrentTask\(\): void/);
  assert.match(types, /taskConversationId\?: string/);
  assert.match(types, /taskKind\?: ButlerBuddyTaskKind/);
  assert.match(types, /taskCount\?: number/);
  assert.match(app, /runningTasks/);
  assert.match(app, /runningConversationIds/);
  assert.match(app, /completedUnreadTasks/);
  assert.match(app, /markConversationCompletedUnread/);
});

test("five transparent state assets and reduced-motion posters ship within budget", () => {
  const states = [
    "idle",
    "working",
    "celebrating",
    "comforting",
    "sleeping"
  ];
  let totalBytes = 0;

  for (const state of states) {
    const webpUrl = new URL(
      `../public/butlerbuddy/states/v2/${state}.webp`,
      import.meta.url
    );
    const posterUrl = new URL(
      `../public/butlerbuddy/states/v2/posters/${state}.png`,
      import.meta.url
    );
    const webp = fs.readFileSync(webpUrl);
    const poster = fs.readFileSync(posterUrl);
    const bytes = fs.statSync(webpUrl).size;
    totalBytes += bytes;

    assert.equal(webp.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(webp.subarray(8, 12).toString("ascii"), "WEBP");
    assert.ok(webp.includes(Buffer.from("ANIM")), `${state} is animated`);
    const frameCount = webp.toString("latin1").match(/ANMF/g)?.length ?? 0;
    assert.equal(frameCount, 7, `${state} contains the intended keyframe loop`);
    assert.ok(bytes <= 500 * 1024, `${state} stays under 500 KB`);
    assert.equal(poster.readUInt32BE(16), 512);
    assert.equal(poster.readUInt32BE(20), 512);
  }

  assert.ok(totalBytes <= 3 * 1024 * 1024, "state asset set stays under 3 MB");
});

test("task receipts are recorded, opened from ButlerBuddy, and saved as PNG", () => {
  const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const dialog = fs.readFileSync(
    new URL("../src/components/ButlerBuddy/TaskReceiptDialog.tsx", import.meta.url),
    "utf8"
  );
  const sounds = fs.readFileSync(
    new URL("../src/utils/soundEffects.ts", import.meta.url),
    "utf8"
  );
  const main = fs.readFileSync(
    new URL("../electron/main.ts", import.meta.url),
    "utf8"
  );
  const preload = fs.readFileSync(
    new URL("../electron/preload.ts", import.meta.url),
    "utf8"
  );
  const types = fs.readFileSync(
    new URL("../src/types/freebuddy.d.ts", import.meta.url),
    "utf8"
  );

  assert.match(app, /<TaskReceiptDialog \/>/);
  assert.match(app, /onOpenTaskReceipt/);
  assert.match(sounds, /recordCompletion/);
  assert.match(dialog, /renderTaskReceiptPng/);
  assert.match(dialog, /copyToClipboard/);
  assert.match(main, /今日战报/);
  assert.match(main, /window:open-task-receipt/);
  assert.match(main, /window:save-image/);
  assert.match(main, /dialog\.showSaveDialog/);
  assert.match(preload, /onOpenTaskReceipt/);
  assert.match(preload, /saveImage/);
  assert.match(types, /onOpenTaskReceipt/);
  assert.match(types, /saveImage/);
});
