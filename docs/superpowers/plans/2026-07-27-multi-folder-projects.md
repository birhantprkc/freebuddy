# Multi-Folder Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class sidebar Project that can mount multiple local folders, migrate cwd-derived groups into Projects, and expose multi-root read/write to Agents only via a FreeBuddy workspace FS MCP.

**Architecture:** Persist `projects` in SQLite; conversations gain `projectId` while keeping `cwd` as Primary for ACP. When `workspaceRoots.length > 1`, register `freebuddy-workspace-fs` into ACP `mcpServers`. Sidebar lists Projects (not derived cwd groups); create/edit uses a Project form modal.

**Tech Stack:** Electron IPC, React, Zustand, TypeScript, better-sqlite3, `@modelcontextprotocol/sdk`, Node test runner (`node --test`), ACP JSON-RPC.

**Spec:** `docs/superpowers/specs/2026-07-27-multi-folder-projects-design.zh-CN.md`

## Global Constraints

- Agent multi-root access: **MCP file bridge only** — no prompt injection, no adapter-native multi-root.
- Register FS MCP **only when** `workspaceRoots.length > 1`.
- Delete project: remove Project row; **keep** conversations; clear `projectId`.
- Do not sync with `remote.workspaceRoots`.
- Do not change Draft / Browser MCP multi-root semantics in v1.
- Folders stored as JSON TEXT on `projects.folders`.
- `cwd` on conversations remains Primary (or legacy path); sidebar grouping uses `projectId`.

---

## File map

| File | Responsibility |
|------|----------------|
| `electron/shared/workspacePathGuard.ts` | Resolve relative/absolute paths; enforce within roots |
| `electron/cli/projects.ts` | Project CRUD + one-shot cwd→project migration |
| `electron/cli/db.ts` | `projects` table; `conversations.project_id`; migration flag via `app_settings` |
| `electron/cli/conversations.ts` | Read/write `projectId` |
| `electron/cli/ipc.ts` + `electron/preload.ts` + `src/services/cli/client.ts` + `src/types/freebuddy.d.ts` | Project IPC |
| `src/services/cli/types.ts` | `Project`, `Conversation.projectId`, `CliRunArgs.workspaceRoots` |
| `electron/cli/runtimeShared.ts` | `CliRunArgs.workspaceRoots` |
| `src/components/CLI/conversationProjectGrouping.ts` | Group by `projectId` + attach project metadata |
| `src/store/pinnedProjectsStore.ts` | Pin by `projectId`; remap helper from cwd keys |
| `src/store/projectStore.ts` | Load/CRUD projects in renderer |
| `src/components/CLI/ProjectFormModal.tsx` | New/Edit project UI |
| `src/components/CLI/ConversationList.tsx` | Header `+`, edit/delete menu, always show Projects header |
| `electron/mcp/workspaceFsMcpServer.ts` | MCP tools: list / read / write |
| `electron/workspaceFsToolService.ts` | Bridge HTTP + `registerWorkspaceFsToolSession` |
| `electron/cli/acpRuntime.ts` | Register FS MCP when multi-root |
| `electron/cli/workspaceFiles.ts` | Search across multiple roots |
| `src/hooks/useWorkspaceFileMentions.ts` | Pass roots / project folders into search |
| `src/locales/en.json` + `zh-CN.json` | Copy |
| `tests/workspace-path-guard.test.mjs` | Path guard unit tests |
| `tests/projects-db.test.mjs` | DB + migration tests |
| `tests/conversation-project-grouping.test.mjs` | Update grouping tests |
| `tests/workspace-fs-mcp.test.mjs` | MCP contract tests |

---

### Task 1: Workspace path guard

**Files:**
- Create: `electron/shared/workspacePathGuard.ts`
- Test: `tests/workspace-path-guard.test.mjs`

**Interfaces:**
- Produces:
  - `normalizeWorkspaceRoot(raw: string): string | null`
  - `resolveWithinRoots(inputPath: string, roots: string[], primary: string): { ok: true; absolute: string } | { ok: false; error: string }`
  - `assertWithinRoots(absolutePath: string, roots: string[]): boolean` (thin wrapper over existing `isPathWithinRoots` or re-export)

- [ ] **Step 1: Write the failing test**

Create `tests/workspace-path-guard.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

async function load() {
  const source = fs.readFileSync(
    new URL("../electron/shared/workspacePathGuard.ts", import.meta.url),
    "utf8"
  );
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

test("relative paths resolve against primary", async () => {
  const { resolveWithinRoots } = await load();
  const primary = "/Users/me/a";
  const roots = [primary, "/Users/me/b"];
  const r = resolveWithinRoots("src/x.ts", roots, primary);
  assert.equal(r.ok, true);
  assert.equal(r.absolute, path.resolve(primary, "src/x.ts"));
});

test("absolute path inside secondary root is allowed", async () => {
  const { resolveWithinRoots } = await load();
  const primary = "/Users/me/a";
  const roots = [primary, "/Users/me/b"];
  const r = resolveWithinRoots("/Users/me/b/pkg.json", roots, primary);
  assert.equal(r.ok, true);
  assert.equal(r.absolute, path.resolve("/Users/me/b/pkg.json"));
});

test("path outside roots is rejected", async () => {
  const { resolveWithinRoots } = await load();
  const r = resolveWithinRoots("/etc/passwd", ["/Users/me/a"], "/Users/me/a");
  assert.equal(r.ok, false);
});

test("path traversal escapes are rejected", async () => {
  const { resolveWithinRoots } = await load();
  const primary = "/Users/me/a";
  const r = resolveWithinRoots("../../etc/passwd", [primary], primary);
  assert.equal(r.ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/workspace-path-guard.test.mjs`  
Expected: FAIL (module / export missing)

- [ ] **Step 3: Implement**

Create `electron/shared/workspacePathGuard.ts`:

```ts
import path from "node:path";
import { isPathWithinRoots } from "./workspaceRoots.js";

export function normalizeWorkspaceRoot(raw: string): string | null {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;
  try {
    return path.resolve(trimmed);
  } catch {
    return null;
  }
}

export function resolveWithinRoots(
  inputPath: string,
  roots: string[],
  primary: string
): { ok: true; absolute: string } | { ok: false; error: string } {
  const normalizedRoots = roots
    .map((r) => normalizeWorkspaceRoot(r))
    .filter((r): r is string => Boolean(r));
  const primaryAbs = normalizeWorkspaceRoot(primary) || normalizedRoots[0];
  if (!primaryAbs || normalizedRoots.length === 0) {
    return { ok: false, error: "No workspace roots configured." };
  }
  const raw = (inputPath || "").trim();
  if (!raw) return { ok: false, error: "Path is required." };

  const absolute = path.isAbsolute(raw)
    ? path.resolve(raw)
    : path.resolve(primaryAbs, raw);

  if (!isPathWithinRoots(absolute, normalizedRoots)) {
    return { ok: false, error: "Path is outside project workspace roots." };
  }
  return { ok: true, absolute };
}

export function assertWithinRoots(absolutePath: string, roots: string[]): boolean {
  const normalizedRoots = roots
    .map((r) => normalizeWorkspaceRoot(r))
    .filter((r): r is string => Boolean(r));
  return isPathWithinRoots(path.resolve(absolutePath), normalizedRoots);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/workspace-path-guard.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/shared/workspacePathGuard.ts tests/workspace-path-guard.test.mjs
git commit -m "feat(projects): add workspace path guard for multi-root FS"
```

---

### Task 2: Projects DB + conversation projectId + migration

**Files:**
- Create: `electron/cli/projects.ts`
- Modify: `electron/cli/db.ts`
- Modify: `electron/cli/conversations.ts`
- Test: `tests/projects-db.test.mjs`

**Interfaces:**
- Produces:
  - `export interface Project { id: string; name: string; folders: string[]; primaryPath: string; createdAt: string; updatedAt: string }`
  - `listProjects(): Project[]`
  - `getProject(id: string): Project | null`
  - `createProject(input: { name: string; folders: string[]; primaryPath: string }): Project`
  - `updateProject(id: string, input: { name: string; folders: string[]; primaryPath: string }): Project`
  - `deleteProject(id: string): void` — clears `conversations.project_id` for that id; does **not** delete conversations
  - `migrateCwdGroupsToProjects(): { migrated: number }` — idempotent via `app_settings` key `projects.cwdMigration.v1`
  - `Conversation.projectId?: string`

- [ ] **Step 1: Write the failing test**

Follow patterns in `tests/conversations-owner-db.test.mjs` / `tests/session-persistence-db.test.mjs` (temp DB via existing test helpers if present; otherwise open `getDb` against a temp file after `build:electron`).

Minimal cases:

```js
test("createProject stores folders JSON and primary", async () => { /* ... */ });
test("deleteProject clears conversation projectId but keeps conversation", async () => { /* ... */ });
test("migrateCwdGroupsToProjects groups by normalized cwd once", async () => { /* ... */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build:electron && node --test tests/projects-db.test.mjs`  
Expected: FAIL

- [ ] **Step 3: Schema + implementation**

In `electron/cli/db.ts` schema bootstrap:

```sql
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  folders TEXT NOT NULL,
  primary_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Alter conversations (guarded like other columns):

```ts
db.exec("ALTER TABLE conversations ADD COLUMN project_id TEXT");
```

Implement `electron/cli/projects.ts`:

- Validate: `name.trim()`, `folders.length >= 1`, every folder absolute+normalized, `primaryPath` ∈ folders, dedupe folders.
- Migration:
  1. If `app_settings` has `projects.cwdMigration.v1` = `"1"`, return.
  2. Select conversations with non-null cwd and null project_id.
  3. Group by lowercase trimmed cwd (same as `projectKeyFromCwd`).
  4. Create one Project per group; `name` = last path segment; `folders`/`primaryPath` = cwd.
  5. `UPDATE conversations SET project_id = ? WHERE cwd matches group`.
  6. Set setting flag.
- Call `migrateCwdGroupsToProjects()` from DB init after schema (or from first `listProjects`).

Update `conversations.ts` row mapping to include `projectId: row.project_id ?? undefined` and accept `projectId` on create/update.

- [ ] **Step 4: Run tests**

Run: `npm run build:electron && node --test tests/projects-db.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/cli/db.ts electron/cli/projects.ts electron/cli/conversations.ts tests/projects-db.test.mjs
git commit -m "feat(projects): persist projects and migrate cwd groups"
```

---

### Task 3: IPC + shared types + client

**Files:**
- Modify: `electron/cli/ipc.ts`
- Modify: `electron/preload.ts`
- Modify: `src/services/cli/client.ts`
- Modify: `src/types/freebuddy.d.ts`
- Modify: `src/services/cli/types.ts`
- Modify: `electron/cli/runtimeShared.ts` (add `workspaceRoots?: string[]` on `CliRunArgs` now so later tasks compile)
- Test: extend wiring style from `tests/workflow-ipc-wiring.test.mjs` or add `tests/projects-ipc-wiring.test.mjs` that asserts channel names exist in ipc/preload/client

**Interfaces:**
- Produces IPC channels:
  - `cli:listProjects` → `Project[]`
  - `cli:createProject` → `Project`
  - `cli:updateProject` → `Project`
  - `cli:deleteProject` → `{ ok: true }`
  - `cli:getProject` → `Project | null`
- Types: mirror `Project` in `src/services/cli/types.ts`; `Conversation.projectId?; CreateConversationInput.projectId?`
- `CliRunArgs.workspaceRoots?: string[]` in both `runtimeShared.ts` and `types.ts`

- [ ] **Step 1: Write failing wiring test**

```js
test("project IPC channels are registered end-to-end", () => {
  const ipc = fs.readFileSync("electron/cli/ipc.ts", "utf8");
  const preload = fs.readFileSync("electron/preload.ts", "utf8");
  const client = fs.readFileSync("src/services/cli/client.ts", "utf8");
  for (const name of [
    "cli:listProjects",
    "cli:createProject",
    "cli:updateProject",
    "cli:deleteProject",
    "cli:getProject"
  ]) {
    assert.match(ipc, new RegExp(name.replace(":", "\\:")));
  }
  assert.match(preload, /listProjects/);
  assert.match(client, /listProjects/);
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Wire handlers** following existing `cli:listConversations` pattern; validate inputs in IPC layer (string id, arrays of strings).

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(projects): expose project CRUD over IPC"
```

---

### Task 4: Sidebar grouping by projectId + pin remap

**Files:**
- Modify: `src/components/CLI/conversationProjectGrouping.ts`
- Modify: `src/store/pinnedProjectsStore.ts`
- Modify: `tests/conversation-project-grouping.test.mjs`

**Interfaces:**
- Consumes: `Conversation.projectId`, `Project`
- Produces:
  - `ConversationProjectGroup` gains `projectId?: string; folders?: string[]; primaryPath?: string` (keep `key` = `projectId` when present, else legacy cwd key for safety)
  - `groupConversationsByProjects(conversations, projects: Project[]): ConversationProjectGroup[]`
  - Projects with zero conversations still appear (empty `items`) when passed in `projects` list
  - `remapPinnedKeys(oldKeys: string[], projects: Project[]): string[]` — if key matches a project's single-folder cwd key, replace with `project.id`

- [ ] **Step 1: Update / extend failing tests** in `tests/conversation-project-grouping.test.mjs`:

```js
test("groups by projectId and includes empty projects", async () => {
  const { groupConversationsByProjects } = await loadGrouping();
  const projects = [
    {
      id: "p1",
      name: "App",
      folders: ["/a", "/b"],
      primaryPath: "/a",
      createdAt: "t",
      updatedAt: "t"
    },
    {
      id: "p2",
      name: "Empty",
      folders: ["/z"],
      primaryPath: "/z",
      createdAt: "t",
      updatedAt: "t"
    }
  ];
  const groups = groupConversationsByProjects(
    [
      conversation({
        id: "c1",
        projectId: "p1",
        cwd: "/a",
        lastMessageAt: "2026-07-22T10:00:00.000Z"
      })
    ],
    projects
  );
  assert.equal(groups.length, 2);
  assert.equal(groups.find((g) => g.key === "p1")?.items.length, 1);
  assert.equal(groups.find((g) => g.key === "p2")?.items.length, 0);
});
```

Keep `recentConversations` = conversations without `projectId` and without `cwd` (or without projectId only — prefer: no `projectId` ⇒ recent if also no cwd; if cwd but no projectId after migration should be rare).

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement grouping + pin remap**

```ts
export function remapPinnedCwdKeysToProjectIds(
  pinnedKeys: string[],
  projects: Project[]
): string[] {
  const cwdKeyToId = new Map<string, string>();
  for (const p of projects) {
    if (p.folders.length === 1) {
      cwdKeyToId.set(projectKeyFromCwd(p.folders[0]), p.id);
    }
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const key of pinnedKeys) {
    const next = cwdKeyToId.get(key) ?? key;
    if (!seen.has(next)) {
      seen.add(next);
      out.push(next);
    }
  }
  return out;
}
```

In `pinnedProjectsStore`, export `remapPins(projects)` that loads keys, remaps, persists if changed. Call once after projects load in Task 5.

- [ ] **Step 4: Run grouping tests — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(projects): group sidebar by projectId and remap pins"
```

---

### Task 5: projectStore + ProjectFormModal + ConversationList UI

**Files:**
- Create: `src/store/projectStore.ts`
- Create: `src/components/CLI/ProjectFormModal.tsx`
- Modify: `src/components/CLI/ConversationList.tsx`
- Modify: `src/App.tsx` or parent that mounts list (wire modal state if needed)
- Modify: `src/locales/en.json`, `src/locales/zh-CN.json`
- Test: `tests/sidebar-navigation.test.mjs` or new `tests/project-form-modal.test.mjs` (string/wiring assertions for `+` / modal keys)

**Interfaces:**
- Consumes: client `listProjects` / CRUD; `selectDirectory` (existing) for add folder
- Produces: UI flows matching spec §2

- [ ] **Step 1: Add i18n keys** (zh + en), at minimum:

```json
"newProject": "New project" / "新建项目",
"editProject": "Edit project" / "编辑项目",
"addProject": "Add project" / "添加项目",
"sourceFolders": "Source folders",
"addFolder": "Add folder" / "添加文件夹",
"primary": "Primary",
"deleteProject": "Delete project" / "删除项目",
"saveProject": "Save" / "保存",
"cancel": reuse existing if present,
"projectNameRequired": "...",
"projectFoldersRequired": "..."
```

- [ ] **Step 2: Implement `projectStore`**

```ts
// load on app start / ConversationList mount
interface ProjectState {
  projects: Project[];
  loading: boolean;
  refresh(): Promise<void>;
  create(...): Promise<Project>;
  update(...): Promise<Project>;
  remove(id: string): Promise<void>;
}
```

After `refresh()`, call pin remap.

- [ ] **Step 3: Implement `ProjectFormModal`**

Props:

```ts
type Props = {
  open: boolean;
  mode: "create" | "edit";
  initial?: Project | null;
  onClose: () => void;
  onSaved: (project: Project) => void;
  onDeleted?: (projectId: string) => void;
};
```

Behavior per spec: name field, folders list, Primary badge, add folder via directory picker, remove with Primary reassignment, save validation, delete only in edit mode (confirm dialog using existing confirm pattern if any).

- [ ] **Step 4: Wire `ConversationList`**

- Always render Projects header (even when empty), with `+` button opening create modal.
- Project row `⋯` menu: Edit project, Pin/Unpin, Reveal Primary in Finder, Delete project.
- Project key / expand state uses `project.id`.
- `onNewTaskInProject` passes `primaryPath` and ensure `newConversation` later sets `projectId` (ChatView / store — set `requestedProjectId` in `newTaskUiStore` parallel to `requestedCwd`).

Extend `newTaskUiStore`:

```ts
requestedProjectId?: string;
requestNewTask({ cwd, projectId }: { cwd?: string; projectId?: string })
```

When creating conversation, pass both.

- [ ] **Step 5: Manual smoke** (dev): open app → `+` → add two folders → save → appears in sidebar → edit → delete → conversations remain under Recent or ungrouped.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(projects): add project form and sidebar create/edit UI"
```

---

### Task 6: Workspace FS MCP server + tool service

**Files:**
- Create: `electron/mcp/workspaceFsMcpServer.ts`
- Create: `electron/workspaceFsToolService.ts`
- Test: `tests/workspace-fs-mcp.test.mjs`
- Follow Draft pattern: MCP stdio child + HTTP bridge on agentBridge port

**Interfaces:**
- Produces:
  - `registerWorkspaceFsToolSession(input: { taskSessionId: string; roots: string[]; primary: string }): Promise<AcpStdioMcpServer>`
  - `unregisterWorkspaceFsToolSession(taskSessionId: string): void`
  - MCP tools: `workspace_list`, `workspace_read`, `workspace_write`
  - Env: `FREEBUDDY_WORKSPACE_FS_ENDPOINT`, `FREEBUDDY_WORKSPACE_FS_TOKEN`, `FREEBUDDY_WORKSPACE_ROOTS` (JSON), `FREEBUDDY_WORKSPACE_PRIMARY`

- [ ] **Step 1: Write MCP contract test** (mirror `tests/draft-mcp.test.mjs`):

```js
test("workspace FS MCP lists tools and enforces roots", async (t) => {
  // mock fetch bridge OR in-memory handlers
  // listTools → workspace_list, workspace_read, workspace_write
  // read outside roots → isError
});
```

Also unit-test service dispatch with temp dirs:

```js
test("workspaceFs dispatch read/write within secondary root", async () => {
  // create two temp dirs; write via dispatch to secondary; read back
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

`workspaceFsToolService.ts`:

- Binding map token → `{ roots, primary }`
- HTTP path e.g. `/freebuddy/workspace-fs-tool`
- Actions: `list` `{ path }`, `read` `{ path }`, `write` `{ path, content }`
- Every action uses `resolveWithinRoots` then `fs.promises`

`workspaceFsMcpServer.ts`:

- Zod-validated tools forwarding to bridge (like draft)
- Export `createWorkspaceFsMcpServer()` for tests

`registerWorkspaceFsToolSession` returns:

```ts
{
  name: "freebuddy-workspace-fs",
  command: process.execPath,
  args: [workspaceFsMcpServerPath()],
  env: [
    { name: "ELECTRON_RUN_AS_NODE", value: "1" },
    { name: "FREEBUDDY_WORKSPACE_FS_ENDPOINT", value: `http://127.0.0.1:${port}/freebuddy/workspace-fs-tool` },
    { name: "FREEBUDDY_WORKSPACE_FS_TOKEN", value: token },
    { name: "FB_APP_VERSION", value: process.env.FB_APP_VERSION || "0.1.0" }
  ]
}
```

Register the HTTP handler next to draft/browser on the bridge server (find where draft route is mounted — likely `agentBridge` / main HTTP — and add sibling route).

- [ ] **Step 4: Run tests — PASS** (`npm run build:electron && node --test tests/workspace-fs-mcp.test.mjs`)

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(projects): add freebuddy-workspace-fs MCP bridge"
```

---

### Task 7: Wire workspaceRoots into run path + acpRuntime

**Files:**
- Modify: `electron/cli/runtimeShared.ts` (already has field from Task 3)
- Modify: `electron/cli/acpRuntime.ts`
- Modify: send path in `src/store/conversationStore.ts` (or wherever `CliRunArgs` is built)
- Modify: `electron/cli/ipc.ts` run handler if it strips unknown fields
- Test: `tests/acp-runtime-contract.test.mjs` (assert source contains register when roots length > 1)

**Interfaces:**
- Consumes: `Conversation.projectId` → `getProject` → `folders`
- Produces: `CliRunArgs.workspaceRoots`; MCP registered iff `roots.length > 1`

- [ ] **Step 1: Write contract assertion test**

```js
test("acpRuntime registers workspace FS MCP only for multi-root", () => {
  const src = fs.readFileSync("electron/cli/acpRuntime.ts", "utf8");
  assert.match(src, /registerWorkspaceFsToolSession/);
  assert.match(src, /workspaceRoots/);
});
```

- [ ] **Step 2: Implement resolution when building run args**

```ts
function resolveWorkspaceRootsForConversation(conv: Conversation): string[] {
  if (conv.projectId) {
    const project = getProject(conv.projectId);
    if (project?.folders?.length) return project.folders.map(normalize).filter(Boolean);
  }
  return conv.cwd ? [conv.cwd] : [];
}
```

Pass into `CliRunArgs.workspaceRoots`.

In `acpRuntime.ts` near Draft MCP registration:

```ts
const roots = (args.workspaceRoots ?? []).map(...).filter(Boolean);
if (roots.length > 1) {
  const primary = args.cwd || roots[0];
  mcpServers.push(
    await registerWorkspaceFsToolSession({
      taskSessionId: args.sessionId,
      roots,
      primary
    })
  );
}
```

Unregister in the same cleanup path as Draft/Browser.

Keep `buildSessionNewRequest(..., args.cwd, mcpServers)` — cwd still Primary only.

- [ ] **Step 3: Run contract + existing acp tests**

Run: `npm run build:electron && node --test tests/acp-runtime-contract.test.mjs tests/acp.test.mjs`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(projects): inject workspace FS MCP on multi-root runs"
```

---

### Task 8: Multi-root workspace file search

**Files:**
- Modify: `electron/cli/workspaceFiles.ts`
- Modify: `electron/cli/ipc.ts` (`cli:searchWorkspaceFiles` accept `roots?: string[]` or `cwd` + optional `roots`)
- Modify: `electron/preload.ts`, `client.ts`, `freebuddy.d.ts`
- Modify: `src/hooks/useWorkspaceFileMentions.ts` — when active conversation has `projectId`, pass project folders
- Test: extend `tests/workspace-file-mentions.test.mjs`

**Interfaces:**
- Produces: `searchWorkspaceFiles(cwd: string, query: string, limit?: number, roots?: string[]): Promise<WorkspaceFileMatch[]>`
- When `roots` provided and length > 1, search each root; prefix display path with root basename to disambiguate (e.g. `exadmin/src/a.ts` vs `51caiji/...`) — store `path` as absolute or root-relative with `root` field if type allows; minimal change: return posix path relative to matching root and include `rootLabel` optional field **only if** existing `WorkspaceFileMatch` can gain optional `root?: string` without breaking UI.

- [ ] **Step 1: Failing test** — two temp roots, file only in secondary, search finds it when roots passed.

- [ ] **Step 2: Implement multi-root index merge** (reuse `indexWorkspaceFiles` per root; merge + re-rank; dedupe by absolute path).

- [ ] **Step 3: Hook mentions to pass roots from `projectStore` / conversation projectId.

- [ ] **Step 4: Run `node --test tests/workspace-file-mentions.test.mjs` — PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(projects): search workspace files across project roots"
```

---

### Task 9: Final verification + docs touch

**Files:**
- Modify: none required beyond fixes
- Optional: ensure `docs/superpowers/specs/2026-07-27-multi-folder-projects-design.zh-CN.md` still matches behavior

- [ ] **Step 1: Run full test suite subset**

```bash
npm run build:electron && node --test --test-force-exit \
  tests/workspace-path-guard.test.mjs \
  tests/projects-db.test.mjs \
  tests/conversation-project-grouping.test.mjs \
  tests/workspace-fs-mcp.test.mjs \
  tests/workspace-file-mentions.test.mjs \
  tests/acp-runtime-contract.test.mjs
```

Expected: all PASS

- [ ] **Step 2: Manual checklist**

1. Fresh DB / migrated: old cwd groups become editable projects  
2. Header `+` creates multi-folder project  
3. Edit sets Primary, add/remove folders  
4. New task under project has `projectId` + Primary `cwd`  
5. Multi-root run registers `freebuddy-workspace-fs` (check agent tool list / logs)  
6. Delete project keeps chats  

- [ ] **Step 3: Commit any fixes**

```bash
git commit -m "test(projects): verify multi-folder project end-to-end paths"
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Project entity SQLite + folders JSON | Task 2 |
| Conversation.projectId + keep cwd | Task 2–3 |
| cwd group migration + pin remap | Task 2, 4 |
| Sidebar `+` / edit form / delete keeps chats | Task 5 |
| workspaceRoots on run | Task 7 |
| FS MCP only, no prompt injection | Task 6–7 |
| Register MCP only if roots.length > 1 | Task 7 |
| Multi-root search / @ | Task 8 |
| No Draft multi-root / no remote sync | Explicit non-goals; no tasks |

No TBD placeholders. Types: `Project`, `workspaceRoots`, `registerWorkspaceFsToolSession` names are consistent across tasks.
