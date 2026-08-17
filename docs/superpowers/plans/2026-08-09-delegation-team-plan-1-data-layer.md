# Delegation Team · Plan 1: Data & Persistence Layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the persistence + type foundation for DelegationTeam: DB schema (kind discriminator, delegation_events table), mirrored main-process types, CRUD for delegation teams / runs / events, builtin team seeding, and a regression guard so workflow teams exclude delegation teams.

**Architecture:** Coexist delegation teams in the existing `workflow_teams` / `workflow_runs` tables via a `kind` column (default `'workflow'`, zero breakage). New `delegation_events` table stores the runtime delegation tree. Delegation-specific config (`entryRoleId`) goes in a new `delegation_meta_json` column; roster reuses `roles_json`, policy reuses `policy_json`. NOT NULL `template_json` / `plan_json` get `'{}'` placeholders on delegation rows (documented). All backend (electron/), fully testable via the existing in-memory sqlite harness.

**Tech Stack:** TypeScript, better-sqlite3, node:test, Electron main process.

**Spec:** `docs/superpowers/specs/2026-08-09-delegation-team-design.zh-CN.md`

**Worktree:** `.worktrees/delegation-team` on branch `feature/delegation-team`. Run all commands from that directory.

---

## File Structure

- **Modify** `electron/cli/db.ts` — `migrate()`: add `kind` + `delegation_meta_json` columns, new `delegation_events` table.
- **Modify** `electron/cli/workflowTeams.ts` — `listWorkflowTeams()` filter to exclude delegation teams.
- **Modify** `electron/main.ts` — call `seedBuiltinDelegationTeams()` on startup.
- **Modify** `package.json` — add the new test file to `test:handoff-db`.
- **Create** `electron/cli/delegationTeamTypes.ts` — main-process types (`DelegationRosterEntry`, `DelegationPolicy`, `DelegationTeam`, `DelegationEvent`, `DelegationEventStatus`, `defaultDelegationPolicy`).
- **Create** `electron/cli/delegationTeamBuiltins.ts` — `builtinDelegationTeams()`.
- **Create** `electron/cli/delegationTeams.ts` — team CRUD + `seedBuiltinDelegationTeams()`.
- **Create** `electron/cli/delegationRuns.ts` — `createDelegationRun()` + delegation event CRUD.
- **Create** `tests/delegation-teams-db.test.mjs` — in-memory sqlite tests (run via `scripts/run-electron-node-test.mjs`).

> **Renderer types are deferred to Plan 3 (UI).** Plan 1 is backend-only and fully testable without a renderer.

---

## Conventions used (from existing code)

- Tests import compiled output: `await import("../dist-electron/cli/<file>.js")`. Always `npm run build:electron` before running.
- DB tests: `import "./fixtures/electron-stub.mjs"` first; open `new Database(":memory:")`; `migrate(db)`; `setDbForTest(db)`; `t.after(() => { setDbForTest(null); db.close(); })`; skip gracefully if the native binding unavailable.
- Migration idiom: read `PRAGMA table_info(<table>)`, `ALTER TABLE ... ADD COLUMN` only if absent.
- Run a single db test with: `npm run build:electron && node scripts/run-electron-node-test.mjs tests/delegation-teams-db.test.mjs`

---

## Task 1: DB migration — kind columns + delegation_events table

**Files:**
- Modify: `electron/cli/db.ts` (inside `migrate()`, near the workflow_runs/workflow_steps column blocks ~lines 823-843)
- Test: `tests/delegation-teams-db.test.mjs` (new file)

- [ ] **Step 1: Create the failing test file `tests/delegation-teams-db.test.mjs`**

```js
import "./fixtures/electron-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";

let Database;
let bindingAvailable = true;
try {
  Database = (await import("better-sqlite3")).default;
  new Database(":memory:").close();
} catch {
  bindingAvailable = false;
}

async function withDb(fn) {
  const db = new Database(":memory:");
  const { migrate, setDbForTest } = await import("../dist-electron/cli/db.js");
  migrate(db);
  setDbForTest(db);
  try {
    await fn(db);
  } finally {
    setDbForTest(null);
    db.close();
  }
}

test("migration adds kind and delegation_meta_json to workflow_teams", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  await withDb((db) => {
    const cols = db.prepare("PRAGMA table_info(workflow_teams)").all().map((c) => c.name);
    assert.ok(cols.includes("kind"), "workflow_teams.kind missing");
    assert.ok(cols.includes("delegation_meta_json"), "workflow_teams.delegation_meta_json missing");
  });
});

test("migration adds kind to workflow_runs", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  await withDb((db) => {
    const cols = db.prepare("PRAGMA table_info(workflow_runs)").all().map((c) => c.name);
    assert.ok(cols.includes("kind"), "workflow_runs.kind missing");
  });
});

test("migration creates delegation_events table with expected columns", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  await withDb((db) => {
    const cols = db.prepare("PRAGMA table_info(delegation_events)").all().map((c) => c.name);
    for (const name of [
      "id", "run_id", "parent_event_id", "agent_id", "agent_name", "role_label",
      "task_text", "depth", "status", "result_summary", "can_write",
      "started_at", "ended_at"
    ]) {
      assert.ok(cols.includes(name), `delegation_events.${name} missing`);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build:electron && node scripts/run-electron-node-test.mjs tests/delegation-teams-db.test.mjs`
Expected: FAIL — columns/table missing.

- [ ] **Step 3: Add the migration to `electron/cli/db.ts`**

Locate the existing block (around line 836) that adds `team_id` / `team_snapshot_json` / `plan_version` to `workflow_runs` (it uses `workflowRunCols`). Immediately after that block's closing, add the `kind` column to runs:

```ts
  if (!workflowRunCols.some((c) => c.name === "kind")) {
    db.exec(
      "ALTER TABLE workflow_runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'workflow'"
    );
  }
```

Then locate the `workflowStepCols` block (around line 838-843). Immediately after it, add the team columns + delegation_events table:

```ts
  const workflowTeamCols = db
    .prepare("PRAGMA table_info(workflow_teams)")
    .all() as Array<{ name: string }>;
  if (!workflowTeamCols.some((c) => c.name === "kind")) {
    db.exec(
      "ALTER TABLE workflow_teams ADD COLUMN kind TEXT NOT NULL DEFAULT 'workflow'"
    );
  }
  if (!workflowTeamCols.some((c) => c.name === "delegation_meta_json")) {
    db.exec(
      "ALTER TABLE workflow_teams ADD COLUMN delegation_meta_json TEXT"
    );
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS delegation_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
      parent_event_id TEXT,
      agent_id TEXT,
      agent_name TEXT,
      role_label TEXT,
      task_text TEXT,
      depth INTEGER NOT NULL,
      status TEXT NOT NULL,
      result_summary TEXT,
      can_write INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      ended_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_delegation_events_run
      ON delegation_events(run_id);
  `);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build:electron && node scripts/run-electron-node-test.mjs tests/delegation-teams-db.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/cli/db.ts tests/delegation-teams-db.test.mjs
git commit -m "feat(delegation): add kind columns and delegation_events table migration"
```

---

## Task 2: Delegation team types + CRUD + workflow-list filter

**Files:**
- Create: `electron/cli/delegationTeamTypes.ts`
- Create: `electron/cli/delegationTeams.ts`
- Modify: `electron/cli/workflowTeams.ts` (`listWorkflowTeams`)
- Test: append to `tests/delegation-teams-db.test.mjs`

- [ ] **Step 1: Append failing tests to `tests/delegation-teams-db.test.mjs`**

```js
test("delegation team CRUD round-trips roster, policy, entryRoleId", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  await withDb(async () => {
    const { insertDelegationTeam, getDelegationTeam, listDelegationTeams, updateDelegationTeam, deleteDelegationTeam } =
      await import("../dist-electron/cli/delegationTeams.js");

    const roster = [
      { id: "r-impl", label: "实现", agentId: "cli-codex-acp", capability: "写代码", canWrite: true },
      { id: "r-rev", label: "评审", agentId: "cli-claude-agent-acp", capability: "审代码", canWrite: false }
    ];
    const created = insertDelegationTeam({
      id: "team-del-1", name: "Impl+Review", enabled: true, source: "user",
      entryRoleId: "r-impl", roster,
      policy: {
        allowWrites: true, requireApprovalBeforeDelegateWrite: true,
        maxDepth: 3, delegateTimeoutMs: 600000, maxConcurrentDelegates: 1,
        stopOnDelegateFailure: false
      }
    });
    assert.equal(created.kind, "delegation");
    assert.equal(created.entryRoleId, "r-impl");
    assert.equal(created.roster.length, 2);

    const fetched = getDelegationTeam("team-del-1");
    assert.deepEqual(fetched?.roster, roster);

    assert.ok(listDelegationTeams().some((x) => x.id === "team-del-1"));

    updateDelegationTeam("team-del-1", { entryRoleId: "r-rev", name: "Renamed" });
    assert.equal(getDelegationTeam("team-del-1")?.entryRoleId, "r-rev");
    assert.equal(getDelegationTeam("team-del-1")?.name, "Renamed");

    assert.equal(deleteDelegationTeam("team-del-1"), true);
    assert.equal(getDelegationTeam("team-del-1"), undefined);
  });
});

test("listWorkflowTeams excludes delegation teams", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  await withDb(async () => {
    const { insertDelegationTeam } = await import("../dist-electron/cli/delegationTeams.js");
    const { listWorkflowTeams } = await import("../dist-electron/cli/workflowTeams.js");

    insertDelegationTeam({
      id: "team-del-isolate", name: "Del", enabled: true, source: "user",
      entryRoleId: "r-1", roster: [{ id: "r-1", label: "x", agentId: "a", capability: "y", canWrite: false }],
      policy: {
        allowWrites: true, requireApprovalBeforeDelegateWrite: false,
        maxDepth: 2, delegateTimeoutMs: 1000, maxConcurrentDelegates: 1,
        stopOnDelegateFailure: false
      }
    });
    const ids = listWorkflowTeams().map((t) => t.id);
    assert.ok(!ids.includes("team-del-isolate"), "delegation team leaked into workflow list");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build:electron && node scripts/run-electron-node-test.mjs tests/delegation-teams-db.test.mjs`
Expected: FAIL — `delegationTeams.js` not found.

- [ ] **Step 3: Create `electron/cli/delegationTeamTypes.ts`**

```ts
export interface DelegationRosterEntry {
  id: string;
  label: string;
  agentId: string;
  model?: string;
  modelOptionId?: string;
  capability: string;
  canWrite: boolean;
  skillIds?: string[];
}

export interface DelegationPolicy {
  allowWrites: boolean;
  requireApprovalBeforeDelegateWrite: boolean;
  maxDepth: number;
  delegateTimeoutMs: number;
  maxConcurrentDelegates: number;
  stopOnDelegateFailure: boolean;
}

export interface DelegationTeam {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  enabled: boolean;
  source: "builtin" | "user";
  kind: "delegation";
  entryRoleId: string;
  roster: DelegationRosterEntry[];
  policy: DelegationPolicy;
  createdAt: string;
  updatedAt: string;
}

export type DelegationEventStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "timeout"
  | "cancelled";

export interface DelegationEvent {
  id: string;
  runId: string;
  parentEventId: string | null;
  agentId: string;
  agentName: string;
  roleLabel: string;
  taskText: string;
  depth: number;
  status: DelegationEventStatus;
  resultSummary: string | null;
  canWrite: boolean;
  startedAt: string | null;
  endedAt: string | null;
}

export function defaultDelegationPolicy(): DelegationPolicy {
  return {
    allowWrites: true,
    requireApprovalBeforeDelegateWrite: true,
    maxDepth: 3,
    delegateTimeoutMs: 600000,
    maxConcurrentDelegates: 1,
    stopOnDelegateFailure: false,
  };
}
```

- [ ] **Step 4: Create `electron/cli/delegationTeams.ts`**

```ts
import { BrowserWindow } from "electron";
import { getDb } from "./db.js";
import { safeSendToWebContents } from "./ipcSend.js";
import type {
  DelegationPolicy,
  DelegationRosterEntry,
  DelegationTeam
} from "./delegationTeamTypes.js";
import { defaultDelegationPolicy } from "./delegationTeamTypes.js";

function notifyDelegationTeamsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    safeSendToWebContents(win.webContents, "delegationTeams://changed", undefined);
  }
}

function rowToDelegationTeam(r: any): DelegationTeam {
  const meta = r.delegation_meta_json ? JSON.parse(r.delegation_meta_json) : {};
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    icon: r.icon ?? undefined,
    enabled: r.enabled === 1 || r.enabled === true,
    source: (r.source as "builtin" | "user") ?? "user",
    kind: "delegation",
    entryRoleId: meta.entryRoleId ?? "",
    roster: JSON.parse(r.roles_json) as DelegationRosterEntry[],
    policy: {
      ...defaultDelegationPolicy(),
      ...(JSON.parse(r.policy_json) as Partial<DelegationPolicy>)
    },
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

export function listDelegationTeams(): DelegationTeam[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM workflow_teams WHERE kind = 'delegation' ORDER BY source DESC, created_at ASC"
    )
    .all() as any[];
  return rows.map(rowToDelegationTeam);
}

export function getDelegationTeam(id: string): DelegationTeam | undefined {
  const row = getDb()
    .prepare("SELECT * FROM workflow_teams WHERE id = ? AND kind = 'delegation'")
    .get(id) as any;
  return row ? rowToDelegationTeam(row) : undefined;
}

export interface UpsertDelegationTeamInput {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  enabled: boolean;
  source: "builtin" | "user";
  entryRoleId: string;
  roster: DelegationRosterEntry[];
  policy: DelegationPolicy;
}

export function insertDelegationTeam(
  input: UpsertDelegationTeamInput
): DelegationTeam {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO workflow_teams
         (id, name, description, icon, enabled, source, kind,
          roles_json, template_json, policy_json, delegation_meta_json,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'delegation', ?, '{}', ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.name,
      input.description ?? null,
      input.icon ?? null,
      input.enabled ? 1 : 0,
      input.source,
      JSON.stringify(input.roster),
      JSON.stringify(input.policy),
      JSON.stringify({ entryRoleId: input.entryRoleId }),
      now,
      now
    );
  const created = getDelegationTeam(input.id) as DelegationTeam;
  notifyDelegationTeamsChanged();
  return created;
}

export interface UpdateDelegationTeamPatch {
  name?: string;
  description?: string | null;
  icon?: string | null;
  enabled?: boolean;
  entryRoleId?: string;
  roster?: DelegationRosterEntry[];
  policy?: DelegationPolicy;
}

export function updateDelegationTeam(
  id: string,
  patch: UpdateDelegationTeamPatch
): DelegationTeam | undefined {
  const existing = getDelegationTeam(id);
  if (!existing) return undefined;

  const fields: string[] = ["updated_at = ?"];
  const params: any[] = [new Date().toISOString()];
  if (patch.name !== undefined) { fields.push("name = ?"); params.push(patch.name); }
  if (patch.description !== undefined) { fields.push("description = ?"); params.push(patch.description); }
  if (patch.icon !== undefined) { fields.push("icon = ?"); params.push(patch.icon); }
  if (patch.enabled !== undefined) { fields.push("enabled = ?"); params.push(patch.enabled ? 1 : 0); }
  if (patch.roster !== undefined) { fields.push("roles_json = ?"); params.push(JSON.stringify(patch.roster)); }
  if (patch.policy !== undefined) { fields.push("policy_json = ?"); params.push(JSON.stringify(patch.policy)); }
  if (patch.entryRoleId !== undefined) {
    fields.push("delegation_meta_json = ?");
    params.push(JSON.stringify({ entryRoleId: patch.entryRoleId }));
  }
  params.push(id);
  getDb()
    .prepare(
      `UPDATE workflow_teams SET ${fields.join(", ")} WHERE id = ? AND kind = 'delegation'`
    )
    .run(...params);
  const updated = getDelegationTeam(id);
  notifyDelegationTeamsChanged();
  return updated;
}

export function deleteDelegationTeam(id: string): boolean {
  const team = getDelegationTeam(id);
  if (!team) return false;
  if (team.source === "builtin") return false;
  getDb().prepare("DELETE FROM workflow_teams WHERE id = ? AND kind = 'delegation'").run(id);
  notifyDelegationTeamsChanged();
  return true;
}
```

- [ ] **Step 5: Filter `listWorkflowTeams()` in `electron/cli/workflowTeams.ts`**

Change the SELECT in `listWorkflowTeams()` (around line 64) from:

```ts
    .prepare("SELECT * FROM workflow_teams ORDER BY source DESC, created_at ASC")
```

to:

```ts
    .prepare(
      "SELECT * FROM workflow_teams WHERE kind = 'workflow' OR kind IS NULL ORDER BY source DESC, created_at ASC"
    )
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run build:electron && node scripts/run-electron-node-test.mjs tests/delegation-teams-db.test.mjs`
Expected: PASS (all tests so far).

- [ ] **Step 7: Commit**

```bash
git add electron/cli/delegationTeamTypes.ts electron/cli/delegationTeams.ts electron/cli/workflowTeams.ts tests/delegation-teams-db.test.mjs
git commit -m "feat(delegation): add delegation team types and CRUD"
```

---

## Task 3: Builtin delegation team + idempotent seeding

**Files:**
- Create: `electron/cli/delegationTeamBuiltins.ts`
- Modify: `electron/cli/delegationTeams.ts` (add `seedBuiltinDelegationTeams`)
- Test: append to `tests/delegation-teams-db.test.mjs`

- [ ] **Step 1: Append failing test**

```js
test("seedBuiltinDelegationTeams is idempotent and appears in list", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  await withDb(async () => {
    const { seedBuiltinDelegationTeams, getDelegationTeam, listDelegationTeams } =
      await import("../dist-electron/cli/delegationTeams.js");

    seedBuiltinDelegationTeams();
    const team = getDelegationTeam("team-delegation-impl-review");
    assert.ok(team, "builtin delegation team missing after seed");
    assert.equal(team?.source, "builtin");
    assert.ok(team?.roster.length >= 2);
    assert.ok(listDelegationTeams().some((x) => x.id === "team-delegation-impl-review"));

    // user customization preserved across re-seed
    const customized = (() => {
      const base = getDelegationTeam("team-delegation-impl-review");
      return base?.roster.map((r) =>
        r.id === "r-impl" ? { ...r, agentId: "cli-claude-agent-acp" } : r
      );
    })();
    const { updateDelegationTeam } = await import("../dist-electron/cli/delegationTeams.js");
    updateDelegationTeam("team-delegation-impl-review", { roster: customized });

    seedBuiltinDelegationTeams();
    const reseated = getDelegationTeam("team-delegation-impl-review");
    const impl = reseated?.roster.find((r) => r.id === "r-impl");
    assert.equal(impl?.agentId, "cli-claude-agent-acp", "user agent binding not preserved on re-seed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build:electron && node scripts/run-electron-node-test.mjs tests/delegation-teams-db.test.mjs`
Expected: FAIL — `seedBuiltinDelegationTeams` not exported.

- [ ] **Step 3: Create `electron/cli/delegationTeamBuiltins.ts`**

```ts
import type { DelegationTeam } from "./delegationTeamTypes.js";
import { defaultDelegationPolicy } from "./delegationTeamTypes.js";

/**
 * Pick a reasonable default agent for a roster slot. Prefer the named member,
 * falling back to any enabled member so the builtin is usable out of the box.
 * (Mirrors the pickAgent() fallback philosophy from workflowTeamBuiltins.ts.)
 */
export function defaultRosterAgentId(preferred: string, fallback: string): string {
  return preferred || fallback;
}

export function builtinDelegationTeams(): DelegationTeam[] {
  return [
    {
      id: "team-delegation-impl-review",
      name: "自组织：实现+评审",
      description: "入口 agent 自主分解任务，需要独立审查时委派给评审 agent。",
      icon: undefined,
      enabled: true,
      source: "builtin",
      kind: "delegation",
      entryRoleId: "r-impl",
      roster: [
        {
          id: "r-impl",
          label: "实现",
          agentId: defaultRosterAgentId("cli-codex-acp", "cli-codex-acp"),
          capability:
            "实现功能、修改代码、跑构建与测试。明确需要写代码的子任务由本角色承担；遇到需要独立审查时委派给评审。",
          canWrite: true
        },
        {
          id: "r-rev",
          label: "评审",
          agentId: defaultRosterAgentId("cli-claude-agent-acp", "cli-claude-agent-acp"),
          capability:
            "审查 diff、找 bug 与风险、给改进建议。需要独立审查时委派给本角色。只读。",
          canWrite: false
        }
      ],
      policy: {
        ...defaultDelegationPolicy(),
        requireApprovalBeforeDelegateWrite: true
      },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    }
  ];
}
```

- [ ] **Step 4: Add seeding to `electron/cli/delegationTeams.ts`**

Add imports at the top:

```ts
import { logMain } from "../debugLog.js";
import { builtinDelegationTeams } from "./delegationTeamBuiltins.js";
```

Append at the end of the file:

```ts
function mergeBuiltinRoster(
  saved: DelegationTeam,
  builtin: DelegationTeam
): DelegationRosterEntry[] {
  const savedById = new Map(saved.roster.map((r) => [r.id, r]));
  return builtin.roster.map((r) => {
    const s = savedById.get(r.id);
    return {
      ...r,
      agentId: s?.agentId ?? r.agentId,
      ...(s?.model ? { model: s.model } : {}),
      ...(s?.modelOptionId ? { modelOptionId: s.modelOptionId } : {}),
      skillIds: s?.skillIds ?? r.skillIds
    };
  });
}

export function seedBuiltinDelegationTeams(): void {
  logMain().info("delegationTeams", "seed builtins start", { pid: process.pid });
  for (const team of builtinDelegationTeams()) {
    const saved = getDelegationTeam(team.id);
    if (!saved) {
      insertDelegationTeam(team);
      continue;
    }
    if (saved.source !== "builtin") continue;
    updateDelegationTeam(team.id, {
      name: team.name,
      description: team.description,
      icon: team.icon,
      enabled: saved.enabled,
      entryRoleId: team.entryRoleId,
      roster: mergeBuiltinRoster(saved, team),
      policy: { ...team.policy, ...saved.policy }
    });
  }
  logMain().info("delegationTeams", "seed builtins done", { pid: process.pid });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run build:electron && node scripts/run-electron-node-test.mjs tests/delegation-teams-db.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/cli/delegationTeamBuiltins.ts electron/cli/delegationTeams.ts tests/delegation-teams-db.test.mjs
git commit -m "feat(delegation): add builtin delegation team and idempotent seeding"
```

---

## Task 4: Delegation run creation

**Files:**
- Create: `electron/cli/delegationRuns.ts`
- Test: append to `tests/delegation-teams-db.test.mjs`

- [ ] **Step 1: Append failing test**

```js
test("createDelegationRun inserts a kind=delegation run row", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun, getDelegationRun } =
      await import("../dist-electron/cli/delegationRuns.js");
    const id = createDelegationRun({
      goal: "实现登录页",
      cwd: "/repo",
      teamId: "team-del-1",
      teamSnapshotJson: JSON.stringify({ id: "team-del-1" })
    });
    const run = getDelegationRun(id);
    assert.ok(run);
    assert.equal(run.kind, "delegation");
    assert.equal(run.goal, "实现登录页");
    assert.equal(run.status, "running");
    assert.equal(run.teamId, "team-del-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build:electron && node scripts/run-electron-node-test.mjs tests/delegation-teams-db.test.mjs`
Expected: FAIL — `delegationRuns.js` not found.

- [ ] **Step 3: Create `electron/cli/delegationRuns.ts`**

```ts
import { getDb } from "./db.js";

export interface CreateDelegationRunInput {
  goal: string;
  cwd?: string;
  teamId: string;
  teamSnapshotJson: string;
  conversationId?: string;
}

export interface DelegationRunRow {
  id: string;
  kind: "delegation";
  conversationId: string | null;
  goal: string;
  status: string;
  cwd: string | null;
  teamId: string | null;
  teamSnapshotJson: string | null;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
}

export function createDelegationRun(input: CreateDelegationRunInput): string {
  const id = `delrun_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO workflow_runs
         (id, conversation_id, name, goal, status, cwd, template,
          loop_index, max_loops, plan_json, team_id, team_snapshot_json, kind,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, 'running', ?, 'delegation', 0, 1, '{}', ?, ?, 'delegation', ?, ?)`
    )
    .run(
      id,
      input.conversationId ?? null,
      input.goal.slice(0, 80) || "Delegation run",
      input.goal,
      input.cwd ?? null,
      input.teamId,
      input.teamSnapshotJson,
      now,
      now
    );
  return id;
}

export function getDelegationRun(id: string): DelegationRunRow | undefined {
  const r = getDb()
    .prepare("SELECT * FROM workflow_runs WHERE id = ? AND kind = 'delegation'")
    .get(id) as any;
  if (!r) return undefined;
  return {
    id: r.id,
    kind: "delegation",
    conversationId: r.conversation_id,
    goal: r.goal,
    status: r.status,
    cwd: r.cwd,
    teamId: r.team_id,
    teamSnapshotJson: r.team_snapshot_json,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    endedAt: r.ended_at
  };
}

export function setDelegationRunStatus(id: string, status: string): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE workflow_runs SET status = ?, updated_at = ?, ended_at = ? WHERE id = ? AND kind = 'delegation'`
    )
    .run(status, now, ["completed", "failed", "killed"].includes(status) ? now : null, id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build:electron && node scripts/run-electron-node-test.mjs tests/delegation-teams-db.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/cli/delegationRuns.ts tests/delegation-teams-db.test.mjs
git commit -m "feat(delegation): add delegation run creation"
```

---

## Task 5: Delegation events CRUD (the delegation tree)

**Files:**
- Modify: `electron/cli/delegationRuns.ts` (add event CRUD)
- Test: append to `tests/delegation-teams-db.test.mjs`

- [ ] **Step 1: Append failing test**

```js
test("delegation events CRUD builds a parent-linked tree", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun, insertDelegationEvent, updateDelegationEvent, listDelegationEvents } =
      await import("../dist-electron/cli/delegationRuns.js");
    const runId = createDelegationRun({
      goal: "g", teamId: "t", teamSnapshotJson: "{}"
    });

    const root = insertDelegationEvent({
      runId, parentEventId: null, agentId: "cli-codex-acp", agentName: "Codex",
      roleLabel: "实现", taskText: "根任务", depth: 0, canWrite: true, status: "running"
    });
    const child = insertDelegationEvent({
      runId, parentEventId: root, agentId: "cli-claude-agent-acp", agentName: "Claude",
      roleLabel: "评审", taskText: "审 auth", depth: 1, canWrite: false, status: "running"
    });

    updateDelegationEvent(child, { status: "done", resultSummary: "LGTM" });

    const events = listDelegationEvents(runId);
    assert.equal(events.length, 2);
    const childEvent = events.find((e) => e.id === child);
    assert.equal(childEvent?.status, "done");
    assert.equal(childEvent?.resultSummary, "LGTM");
    assert.equal(childEvent?.parentEventId, root);
    const rootEvent = events.find((e) => e.id === root);
    assert.equal(rootEvent?.depth, 0);
  });
});

test("delegation events cascade-delete with their run", async (t) => {
  if (!bindingAvailable) { t.skip("better-sqlite3 native binding unavailable"); return; }
  await withDb(async () => {
    const { createDelegationRun, insertDelegationEvent, listDelegationEvents } =
      await import("../dist-electron/cli/delegationRuns.js");
    const { getDb } = await import("../dist-electron/cli/db.js");
    const runId = createDelegationRun({ goal: "g", teamId: "t", teamSnapshotJson: "{}" });
    insertDelegationEvent({
      runId, parentEventId: null, agentId: "a", agentName: "A",
      roleLabel: "x", taskText: "t", depth: 0, canWrite: false, status: "running"
    });
    getDb().prepare("DELETE FROM workflow_runs WHERE id = ?").run(runId);
    assert.equal(listDelegationEvents(runId).length, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build:electron && node scripts/run-electron-node-test.mjs tests/delegation-teams-db.test.mjs`
Expected: FAIL — `insertDelegationEvent` etc. not exported.

- [ ] **Step 3: Add event CRUD to `electron/cli/delegationRuns.ts`**

Add the import for the status type at the top of the file (append to existing imports):

```ts
import type { DelegationEventStatus } from "./delegationTeamTypes.js";
```

Append to `electron/cli/delegationRuns.ts`:

```ts
export interface DelegationEventRow {
  id: string;
  runId: string;
  parentEventId: string | null;
  agentId: string;
  agentName: string;
  roleLabel: string;
  taskText: string;
  depth: number;
  status: DelegationEventStatus;
  resultSummary: string | null;
  canWrite: boolean;
  startedAt: string | null;
  endedAt: string | null;
}

function rowToEvent(r: any): DelegationEventRow {
  return {
    id: r.id,
    runId: r.run_id,
    parentEventId: r.parent_event_id,
    agentId: r.agent_id,
    agentName: r.agent_name,
    roleLabel: r.role_label,
    taskText: r.task_text,
    depth: r.depth,
    status: r.status,
    resultSummary: r.result_summary,
    canWrite: r.can_write === 1 || r.can_write === true,
    startedAt: r.started_at,
    endedAt: r.ended_at
  };
}

export interface InsertDelegationEventInput {
  runId: string;
  parentEventId: string | null;
  agentId: string;
  agentName: string;
  roleLabel: string;
  taskText: string;
  depth: number;
  canWrite: boolean;
  status: DelegationEventStatus;
}

export function insertDelegationEvent(input: InsertDelegationEventInput): string {
  const id = `delevent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO delegation_events
         (id, run_id, parent_event_id, agent_id, agent_name, role_label,
          task_text, depth, status, result_summary, can_write, started_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`
    )
    .run(
      id, input.runId, input.parentEventId, input.agentId, input.agentName,
      input.roleLabel, input.taskText, input.depth, input.status,
      input.canWrite ? 1 : 0, now
    );
  return id;
}

export interface UpdateDelegationEventPatch {
  status?: DelegationEventStatus;
  resultSummary?: string | null;
}

export function updateDelegationEvent(
  id: string,
  patch: UpdateDelegationEventPatch
): void {
  const fields: string[] = [];
  const params: any[] = [];
  if (patch.status !== undefined) {
    fields.push("status = ?");
    params.push(patch.status);
    if (["done", "failed", "timeout", "cancelled"].includes(patch.status)) {
      fields.push("ended_at = ?");
      params.push(new Date().toISOString());
    }
  }
  if (patch.resultSummary !== undefined) {
    fields.push("result_summary = ?");
    params.push(patch.resultSummary);
  }
  if (fields.length === 0) return;
  params.push(id);
  getDb()
    .prepare(`UPDATE delegation_events SET ${fields.join(", ")} WHERE id = ?`)
    .run(...params);
}

export function listDelegationEvents(runId: string): DelegationEventRow[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM delegation_events WHERE run_id = ? ORDER BY started_at ASC"
    )
    .all(runId) as any[];
  return rows.map(rowToEvent);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build:electron && node scripts/run-electron-node-test.mjs tests/delegation-teams-db.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/cli/delegationRuns.ts tests/delegation-teams-db.test.mjs
git commit -m "feat(delegation): add delegation event CRUD for the runtime tree"
```

---

## Task 6: Wire seeding into startup + register test + full typecheck

**Files:**
- Modify: `electron/main.ts` (call `seedBuiltinDelegationTeams()` on startup)
- Modify: `package.json` (add `tests/delegation-teams-db.test.mjs` to `test:handoff-db`)
- Test: append a startup-wiring sanity test is unnecessary; rely on build + the existing test file.

- [ ] **Step 1: Add the new test to `package.json` `test:handoff-db`**

In `package.json`, append ` tests/delegation-teams-db.test.mjs` to the `test:handoff-db` script's file list (after `tests/workflow-teams-db.test.mjs`).

- [ ] **Step 2: Wire seeding into `electron/main.ts`**

Add the import next to the existing one at `electron/main.ts:28`:

```ts
import { seedBuiltinWorkflowTeams } from "./cli/workflowTeams.js";
import { seedBuiltinDelegationTeams } from "./cli/delegationTeams.js";
```

At the existing call site (`electron/main.ts:966`), add the delegation seed right after:

```ts
  seedBuiltinWorkflowTeams();
  seedBuiltinDelegationTeams();
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run build:electron`
Expected: builds cleanly.

- [ ] **Step 4: Run the full db test suite to confirm no regressions**

Run: `npm run test:handoff-db`
Expected: all db tests PASS, including the new `delegation-teams-db.test.mjs`.

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts package.json
git commit -m "feat(delegation): seed builtin delegation teams on startup"
```

---

## Self-Review (run after all tasks)

- **Spec coverage:** spec §数据模型 — kind 判别 ✓ (Task 1), types ✓ (Task 2/3), `delegation_events` ✓ (Task 1/5), roster/policy/entryRoleId CRUD ✓ (Task 2), builtin seeding ✓ (Task 3), delegation run row ✓ (Task 4). Renderer type mirror is intentionally deferred to Plan 3 (UI).
- **Placeholder scan:** none.
- **Type consistency:** `DelegationPolicy` field names match across `delegationTeamTypes.ts`, `insertDelegationTeam`, tests, and builtins. `DelegationEventStatus` used consistently in `delegationRuns.ts`. `kind: "delegation"` literal consistent.
- **Known friction (documented, intentional):** NOT NULL `template_json` gets `'{}'` placeholder on delegation team rows; NOT NULL `plan_json` gets `'{}'` placeholder on delegation run rows. Both are ignored by the delegation readers. Avoids a heavy table rebuild migration.
