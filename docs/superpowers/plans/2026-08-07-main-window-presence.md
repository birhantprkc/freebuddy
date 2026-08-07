# Main Window Presence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let ButlerBuddy (pet + main) know which main-window page/conversation the user is on via a one-line prompt summary plus `status_get.mainWindow`.

**Architecture:** Main `App` publishes a throttled `MainWindowPresence` snapshot to the main process. ButlerBuddy `cli:run` prepends a one-line summary; `status_get` returns the full snapshot.

**Tech Stack:** Electron IPC, TypeScript, Node test runner, existing butler MCP bridge.

## Global Constraints

- Presence scope: `workspaceView`, settings open/tab, active conversation metadata, `streaming`, `updatedAt` only — no message bodies, no transient UI.
- Hybrid delivery: one-line auto summary for `cli-butlerbuddy` + full object on `status_get`.
- Malformed payloads must not overwrite a valid snapshot; missing/closed main window → `null`.
- Summary line must be labeled `main window` so pet chat is not confused with main active conversation.
- Follow TDD: failing test before production code each task.

## File map

| File | Responsibility |
|------|----------------|
| `electron/uiPresence.ts` | Validate/store/get/clear presence; format summary line |
| `electron/main.ts` | Register IPC; clear on main window close |
| `electron/preload.ts` | `window.freebuddy.window.setUiPresence` |
| `src/types/freebuddy.d.ts` | Type for `setUiPresence` |
| `src/App.tsx` | Publish presence from UI/store (throttled) |
| `electron/butlerToolService.ts` | Attach `mainWindow` on `status_get` |
| `electron/mcp/butlerMcpServer.ts` | Document `mainWindow` on `freebuddy_status_get` |
| `electron/cli/ipc.ts` | Prepend summary for butler runs |
| `assets/skills/butlerbuddy/SKILL.md` | Teach model to use summary + status tool |
| `tests/ui-presence.test.mjs` | Unit + contract coverage |

---

### Task 1: `uiPresence` module

**Files:**
- Create: `electron/uiPresence.ts`
- Create: `tests/ui-presence.test.mjs`

**Interfaces:**
- Produces:
  - `MainWindowPresence` type (exported)
  - `setMainWindowPresence(raw: unknown): boolean`
  - `getMainWindowPresence(): MainWindowPresence | null`
  - `clearMainWindowPresence(): void`
  - `formatMainWindowPresenceSummary(presence: MainWindowPresence): string`

- [ ] **Step 1: Write the failing test**

Create `tests/ui-presence.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import fs from "node:fs";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-force-exit tests/ui-presence.test.mjs`
Expected: FAIL (cannot resolve / missing exports)

- [ ] **Step 3: Write minimal implementation**

Create `electron/uiPresence.ts`:

```ts
export type MainWorkspaceView =
  | "chat"
  | "scheduledTasks"
  | "workflowTeams"
  | "usage";

export type MainSettingsTab =
  | "general"
  | "cli"
  | "skills"
  | "plugins"
  | "feed"
  | "remote"
  | "about";

export interface MainWindowPresence {
  workspaceView: MainWorkspaceView;
  settingsOpen: boolean;
  settingsTab: MainSettingsTab | null;
  activeConversation: {
    id: string;
    title: string;
    agentId: string;
    agentName: string;
  } | null;
  streaming: boolean;
  updatedAt: string;
}

const WORKSPACE_VIEWS = new Set<MainWorkspaceView>([
  "chat",
  "scheduledTasks",
  "workflowTeams",
  "usage"
]);

const SETTINGS_TABS = new Set<MainSettingsTab>([
  "general",
  "cli",
  "skills",
  "plugins",
  "feed",
  "remote",
  "about"
]);

let latestPresence: MainWindowPresence | null = null;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseMainWindowPresence(
  raw: unknown
): MainWindowPresence | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (!WORKSPACE_VIEWS.has(value.workspaceView as MainWorkspaceView)) return null;
  if (typeof value.settingsOpen !== "boolean") return null;
  if (typeof value.streaming !== "boolean") return null;
  if (!isNonEmptyString(value.updatedAt)) return null;

  let settingsTab: MainSettingsTab | null = null;
  if (value.settingsOpen) {
    if (!SETTINGS_TABS.has(value.settingsTab as MainSettingsTab)) return null;
    settingsTab = value.settingsTab as MainSettingsTab;
  } else if (value.settingsTab !== null && value.settingsTab !== undefined) {
    return null;
  }

  let activeConversation: MainWindowPresence["activeConversation"] = null;
  if (value.activeConversation !== null && value.activeConversation !== undefined) {
    if (
      typeof value.activeConversation !== "object" ||
      Array.isArray(value.activeConversation)
    ) {
      return null;
    }
    const conv = value.activeConversation as Record<string, unknown>;
    if (
      !isNonEmptyString(conv.id) ||
      typeof conv.title !== "string" ||
      !isNonEmptyString(conv.agentId) ||
      typeof conv.agentName !== "string"
    ) {
      return null;
    }
    activeConversation = {
      id: conv.id,
      title: conv.title,
      agentId: conv.agentId,
      agentName: conv.agentName
    };
  }

  return {
    workspaceView: value.workspaceView as MainWorkspaceView,
    settingsOpen: value.settingsOpen,
    settingsTab,
    activeConversation,
    streaming: value.streaming,
    updatedAt: value.updatedAt
  };
}

export function setMainWindowPresence(raw: unknown): boolean {
  const parsed = parseMainWindowPresence(raw);
  if (!parsed) return false;
  latestPresence = parsed;
  return true;
}

export function getMainWindowPresence(): MainWindowPresence | null {
  return latestPresence;
}

export function clearMainWindowPresence(): void {
  latestPresence = null;
}

export function formatMainWindowPresenceSummary(
  presence: MainWindowPresence
): string {
  const settings = presence.settingsOpen
    ? `settings=${presence.settingsTab}`
    : "settings=closed";
  const conversation = presence.activeConversation
    ? `conversation="${presence.activeConversation.title.replace(/"/g, '\\"')}" (${presence.activeConversation.agentId})`
    : "conversation=none";
  return (
    `[FreeBuddy main window] view=${presence.workspaceView}; ${settings}; ` +
    `${conversation}; streaming=${presence.streaming}`
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-force-exit tests/ui-presence.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/uiPresence.ts tests/ui-presence.test.mjs
git commit -m "feat(butlerbuddy): add main window presence store"
```

---

### Task 2: IPC, preload, App publisher

**Files:**
- Modify: `electron/main.ts` (register `ipcMain.on("freebuddy:uiPresence")`; call `clearMainWindowPresence` in mainWindow `closed`)
- Modify: `electron/preload.ts` (`setUiPresence`)
- Modify: `src/types/freebuddy.d.ts`
- Modify: `src/App.tsx`
- Modify: `tests/ui-presence.test.mjs` (contract asserts)

**Interfaces:**
- Consumes: `setMainWindowPresence`, `clearMainWindowPresence` from Task 1
- Produces: renderer `window.freebuddy.window.setUiPresence(snapshot)`

- [ ] **Step 1: Extend failing contract tests**

Append to `tests/ui-presence.test.mjs`:

```js
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
  assert.match(app, /setUiPresence/);
  assert.match(types, /setUiPresence/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-force-exit tests/ui-presence.test.mjs`
Expected: FAIL on contract asserts

- [ ] **Step 3: Wire IPC + preload + types + App**

In `electron/main.ts`:
- `import { clearMainWindowPresence, setMainWindowPresence } from "./uiPresence.js";`
- In `mainWindow.on("closed")`: also `clearMainWindowPresence();`
- Register once near other IPC setup (e.g. after window chrome / with butler IPC):

```ts
ipcMain.on("freebuddy:uiPresence", (_event, payload) => {
  setMainWindowPresence(payload);
});
```

In `electron/preload.ts` window API:

```ts
setUiPresence(snapshot: unknown): void {
  ipcRenderer.send("freebuddy:uiPresence", snapshot);
},
```

In `src/types/freebuddy.d.ts` under `window`:

```ts
setUiPresence(snapshot: {
  workspaceView: "chat" | "scheduledTasks" | "workflowTeams" | "usage";
  settingsOpen: boolean;
  settingsTab:
    | "general"
    | "cli"
    | "skills"
    | "plugins"
    | "feed"
    | "remote"
    | "about"
    | null;
  activeConversation: {
    id: string;
    title: string;
    agentId: string;
    agentName: string;
  } | null;
  streaming: boolean;
  updatedAt: string;
}): void;
```

In `src/App.tsx`, after `activeConversation` / streaming derived values exist, add:

```tsx
useEffect(() => {
  const member = members.find((m) => m.id === activeConversation?.agentId);
  const snapshot = {
    workspaceView,
    settingsOpen,
    settingsTab: settingsOpen ? settingsInitialTab : null,
    activeConversation: activeConversation
      ? {
          id: activeConversation.id,
          title: activeConversation.title,
          agentId: activeConversation.agentId,
          agentName: member?.name ?? activeConversation.agentName ?? activeConversation.agentId
        }
      : null,
    streaming: activeConversationRunning,
    updatedAt: new Date().toISOString()
  };
  const timer = window.setTimeout(() => {
    window.freebuddy?.window?.setUiPresence?.(snapshot);
  }, 250);
  return () => window.clearTimeout(timer);
}, [
  workspaceView,
  settingsOpen,
  settingsInitialTab,
  activeConversation?.id,
  activeConversation?.title,
  activeConversation?.agentId,
  activeConversation?.agentName,
  activeConversationRunning,
  members
]);
```

Only mount this in the main `App` (companions do not render `App`).

- [ ] **Step 4: Run tests**

Run: `node --test --test-force-exit tests/ui-presence.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts electron/preload.ts src/types/freebuddy.d.ts src/App.tsx tests/ui-presence.test.mjs
git commit -m "feat(butlerbuddy): publish main window UI presence"
```

---

### Task 3: Expose presence via `status_get` + skill

**Files:**
- Modify: `electron/butlerToolService.ts` (`status_get` case)
- Modify: `electron/mcp/butlerMcpServer.ts` (`freebuddy_status_get` description)
- Modify: `assets/skills/butlerbuddy/SKILL.md`
- Modify: `tests/ui-presence.test.mjs`

**Interfaces:**
- Consumes: `getMainWindowPresence()`
- Produces: `status_get` result field `mainWindow: MainWindowPresence | null`

- [ ] **Step 1: Write failing contract asserts**

```js
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
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test --test-force-exit tests/ui-presence.test.mjs`
Expected: FAIL

- [ ] **Step 3: Implement**

In `status_get` return object add:

```ts
mainWindow: getMainWindowPresence()
```

Import `getMainWindowPresence` from `./uiPresence.js`.

Update MCP tool description for `freebuddy_status_get` to mention `mainWindow` (current main FreeBuddy UI presence: view, settings, active conversation, streaming).

In skill, extend the `freebuddy_status_get` bullet and add a short "Main window awareness" note:

- Auto prompt summary may include `[FreeBuddy main window] ...`
- For “where am I / current conversation” questions, use that summary; call `freebuddy_status_get` for full `mainWindow` fields
- Never invent presence; if `mainWindow` is null, say so

- [ ] **Step 4: Run tests PASS + commit**

```bash
git add electron/butlerToolService.ts electron/mcp/butlerMcpServer.ts assets/skills/butlerbuddy/SKILL.md tests/ui-presence.test.mjs
git commit -m "feat(butlerbuddy): expose mainWindow on status_get"
```

---

### Task 4: Butler `cli:run` one-line summary

**Files:**
- Modify: `electron/cli/ipc.ts`
- Modify: `tests/ui-presence.test.mjs`

**Interfaces:**
- Consumes: `getMainWindowPresence`, `formatMainWindowPresenceSummary`, `BUTLERBUDDY_AGENT_ID`
- Produces: butler prompts optionally prefixed with summary + `\n\n`

- [ ] **Step 1: Failing contract test**

```js
test("cli:run prefixes ButlerBuddy prompts with main window summary", () => {
  const ipc = fs.readFileSync(
    new URL("../electron/cli/ipc.ts", import.meta.url),
    "utf8"
  );
  assert.match(ipc, /formatMainWindowPresenceSummary/);
  assert.match(ipc, /BUTLERBUDDY_AGENT_ID/);
  assert.match(ipc, /getMainWindowPresence/);
});
```

- [ ] **Step 2: Run fail, then implement in `cli:run` after workspaceRoots / before `cliRun`**

After contextReferences block (~line 728), add:

```ts
if (runArgs.agentId === BUTLERBUDDY_AGENT_ID) {
  const presence = getMainWindowPresence();
  if (presence) {
    runArgs = {
      ...runArgs,
      prompt:
        `${formatMainWindowPresenceSummary(presence)}\n\n` + runArgs.prompt
    };
  }
}
```

Imports at top of `ipc.ts`:
- `BUTLERBUDDY_AGENT_ID` from `./agentProfiles.js`
- `getMainWindowPresence`, `formatMainWindowPresenceSummary` from `../uiPresence.js`

If context language path already rewrote `prompt`, this still prepends to the final `runArgs.prompt`.

- [ ] **Step 3: Run tests**

```bash
node --test --test-force-exit tests/ui-presence.test.mjs tests/butlerbuddy.test.mjs
npx tsc -p tsconfig.electron.json --noEmit
npx tsc --noEmit
```

Expected: all PASS / noEmit clean

- [ ] **Step 4: Commit**

```bash
git add electron/cli/ipc.ts tests/ui-presence.test.mjs
git commit -m "feat(butlerbuddy): inject main window presence into butler prompts"
```

---

## Spec coverage check

| Spec requirement | Task |
|------------------|------|
| Presence model fields (B) | Task 1–2 |
| Main process store + validate | Task 1 |
| App publish throttled | Task 2 |
| Clear on main close | Task 2 |
| `status_get.mainWindow` | Task 3 |
| Skill guidance | Task 3 |
| One-line butler prompt summary | Task 4 |
| Tests | Tasks 1–4 |
