# Delegation Team · Plan 3: UI & Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the user-facing layer for DelegationTeam: Settings editor (roster + entry + policy), ChatView team picker + preview + start, a live delegation-tree Run view with write-approval gate, and the IPC/bridge/store plumbing connecting renderer to the Plan 2 runtime. Also close two deferred items: renderer type mirror + the `getWorkflowTeam` kind-scope guard.

**Architecture:** Mirror the existing workflow UI pattern. NEW sibling components for delegation-specific UI (`DelegationTeamEditor`, `DelegationTeamPreviewCard`, `DelegationRunTree`, `DelegationRunPanel`) rather than branching the 1000-line workflow editor in place — cleaner + reviewable. The run panel **polls** `listDelegationEvents(runId)` every 1500 ms (same pattern as `WorkflowRunPanel`), avoiding push-event wiring. Delegation team CRUD + run reads get IPC handlers (Plan 1 left these unwired), exposed via a new `window.freebuddy.delegation` bridge namespace.

**Tech Stack:** React 19, antd 6, Zustand, react-i18next, TypeScript, Electron preload/IPC.
**Depends on:** Plan 1 (DB) + Plan 2a/2b (engine).
**Spec:** §UI.
**Worktree:** `.worktrees/delegation-team` on `feature/delegation-team`.

---

## File Structure

- **Modify** `src/services/workflowTeams/types.ts` — mirror delegation types + `AnyTeam` + `isDelegationTeam`.
- **Modify** `electron/cli/workflowTeams.ts` — kind-scope `getWorkflowTeam` (deferred guard).
- **Modify** `electron/cli/workflowIpc.ts` (or new `electron/cli/delegationTeamIpc.ts`) — delegation team CRUD handlers + run-read handlers.
- **Modify** `electron/preload.ts` — expose `window.freebuddy.delegation` (teams CRUD + createDelegationRun + approveDelegateWrite + getRun/listEvents).
- **Create** `src/services/delegation/client.ts` — renderer bridge wrapper + `onChanged` subscription.
- **Create** `src/store/delegationStore.ts` — Zustand store (team CRUD, run state).
- **Create** `src/components/Settings/DelegationTeamEditor.tsx` — roster + entry + policy editor.
- **Modify** `src/components/Settings/WorkflowTeamsTab.tsx` + `WorkflowTeamList.tsx` — list both kinds; route to the right editor; "New" lets user pick kind.
- **Create** `src/components/Workflows/DelegationTeamPreviewCard.tsx` — preview for the new-task page.
- **Modify** `src/components/CLI/ChatView.tsx` — team picker lists both kinds; on delegation send → `createDelegationRun`.
- **Create** `src/components/Workflows/DelegationRunTree.tsx` + `DelegationRunPanel.tsx` — indented-tree run view + Stop + write-approval buttons; poll every 1500 ms.
- **Modify** locale files — new `workflow.delegation.*` keys (zh-CN + en).
- **Create** `tests/delegation-team-ipc.test.mjs` — IPC wiring smoke (handlers registered, bridge shape) mirroring `tests/workflow-teams.test.mjs`.

---

## Task 1: Renderer type mirror + getWorkflowTeam kind-scope guard

- [ ] **Step 1: Mirror types in `src/services/workflowTeams/types.ts`**

Append (these mirror `electron/cli/delegationTeamTypes.ts`):

```ts
export interface DelegationRosterEntry {
  id: string; label: string; agentId: string;
  model?: string; modelOptionId?: string;
  capability: string; canWrite: boolean; skillIds?: string[];
}
export interface DelegationPolicy {
  allowWrites: boolean; requireApprovalBeforeDelegateWrite: boolean;
  maxDepth: number; delegateTimeoutMs: number;
  maxConcurrentDelegates: number; stopOnDelegateFailure: boolean;
}
export interface DelegationTeam {
  id: string; name: string; description?: string; icon?: string;
  enabled: boolean; source: "builtin" | "user"; kind: "delegation";
  entryRoleId: string; roster: DelegationRosterEntry[]; policy: DelegationPolicy;
  createdAt: string; updatedAt: string;
}
export type AnyTeam = WorkflowTeam | DelegationTeam;
export function isDelegationTeam(t: AnyTeam): t is DelegationTeam { return (t as DelegationTeam).kind === "delegation"; }
```

- [ ] **Step 2: Kind-scope `getWorkflowTeam` in `electron/cli/workflowTeams.ts`**

Change the `getWorkflowTeam` SELECT (around line 71) from `WHERE id = ?` to `WHERE id = ? AND (kind = 'workflow' OR kind IS NULL)` so a delegation row can never be dereferenced as a `WorkflowTeam` (template deref hazard from Plan 1 final review).

- [ ] **Step 3: `npm run typecheck` clean; Commit**
```bash
git add src/services/workflowTeams/types.ts electron/cli/workflowTeams.ts
git commit -m "feat(delegation): mirror renderer types and kind-scope getWorkflowTeam"
```

---

## Task 2: Delegation team CRUD + run-read IPC handlers + preload bridge

- [ ] **Step 1: Create `electron/cli/delegationTeamIpc.ts`**

```ts
import { registerHandler } from "../invokeRegistry.js";
import {
  listDelegationTeams, getDelegationTeam,
  insertDelegationTeam, updateDelegationTeam, deleteDelegationTeam,
  type UpsertDelegationTeamInput, type UpdateDelegationTeamPatch
} from "./delegationTeams.js";
import { getDelegationRun, listDelegationEvents } from "./delegationRuns.js";

export function registerDelegationTeamIpc(): void {
  registerHandler("delegation:listTeams", () => listDelegationTeams());
  registerHandler("delegation:getTeam", (_e, id: string) => getDelegationTeam(id));
  registerHandler("delegation:createTeam", (_e, input: UpsertDelegationTeamInput) => insertDelegationTeam(input));
  registerHandler("delegation:updateTeam", (_e, { id, patch }: { id: string; patch: UpdateDelegationTeamPatch }) => updateDelegationTeam(id, patch));
  registerHandler("delegation:deleteTeam", (_e, id: string) => deleteDelegationTeam(id));
  registerHandler("delegation:getRun", (_e, id: string) => getDelegationRun(id));
  registerHandler("delegation:listEvents", (_e, runId: string) => listDelegationEvents(runId));
}
```

- [ ] **Step 2: Register it in `electron/main.ts`** next to `registerDelegationIpc()`:

```ts
import { registerDelegationTeamIpc } from "./cli/delegationTeamIpc.js";
...
  registerDelegationIpc();
  registerDelegationTeamIpc();
```

- [ ] **Step 3: Expose the bridge in `electron/preload.ts`**

Add a `delegation` namespace on `window.freebuddy` (match the existing `workflowTeams` namespace style; mark channels remote-callable per project policy if needed in `shared/remoteChannelPolicy.ts` — the workflow team channels are listed there ~139-158):

```ts
    delegation: {
      listTeams: () => ipcRenderer.invoke("delegation:listTeams"),
      getTeam: (id) => ipcRenderer.invoke("delegation:getTeam", id),
      createTeam: (input) => ipcRenderer.invoke("delegation:createTeam", input),
      updateTeam: (id, patch) => ipcRenderer.invoke("delegation:updateTeam", { id, patch }),
      deleteTeam: (id) => ipcRenderer.invoke("delegation:deleteTeam", id),
      getRun: (id) => ipcRenderer.invoke("delegation:getRun", id),
      listEvents: (runId) => ipcRenderer.invoke("delegation:listEvents", runId),
      createRun: (input) => ipcRenderer.invoke("workflow:createDelegationRun", input),
      approveWrite: (input) => ipcRenderer.invoke("workflow:approveDelegateWrite", input),
      onChanged: (cb) => {
        const listener = () => cb();
        ipcRenderer.on("delegationTeams://changed", listener);
        return () => ipcRenderer.removeListener("delegationTeams://changed", listener);
      }
    },
```

> The `delegationTeams://changed` broadcast already fires from `notifyDelegationTeamsChanged` (Plan 1). Confirm the preload's `ipcRenderer` import + the `window.freebuddy` object shape match the existing namespaces.

- [ ] **Step 4: If the project gates remote-callable channels, add the `delegation:*` + `workflow:createDelegationRun` + `workflow:approveDelegateWrite` channels to `electron/shared/remoteChannelPolicy.ts`** alongside the workflow team channels (mirror).

- [ ] **Step 5: Smoke test `tests/delegation-team-ipc.test.mjs`** mirroring `tests/workflow-teams.test.mjs` (verify handlers registered + preload bridge exposes the delegation namespace). Use the same in-memory db + register pattern. Keep it light.

- [ ] **Step 6: Add to `test:handoff-db` if the test needs the electron-node harness; otherwise to the plain `node --test` glob.** Build + run.

- [ ] **Step 7: Commit**
```bash
git add electron/cli/delegationTeamIpc.ts electron/main.ts electron/preload.ts electron/shared/remoteChannelPolicy.ts tests/delegation-team-ipc.test.mjs package.json
git commit -m "feat(delegation): add team CRUD + run-read IPC and preload bridge"
```

---

## Task 3: Renderer client + Zustand store

- [ ] **Step 1: Create `src/services/delegation/client.ts`**

```ts
import type { DelegationTeam, DelegationRosterEntry, DelegationPolicy } from "@/services/workflowTeams/types";

export interface UpsertDelegationTeamInput {
  id: string; name: string; description?: string; icon?: string;
  enabled: boolean; source: "builtin" | "user";
  entryRoleId: string; roster: DelegationRosterEntry[]; policy: DelegationPolicy;
}
export interface UpdateDelegationTeamPatch {
  name?: string; description?: string | null; icon?: string | null; enabled?: boolean;
  entryRoleId?: string; roster?: DelegationRosterEntry[]; policy?: DelegationPolicy;
}

const w = () => (window as unknown as { freebuddy: any }).freebuddy.delegation;

export const delegationClient = {
  list: (): Promise<DelegationTeam[]> => w().listTeams(),
  get: (id: string) => w().getTeam(id),
  create: (input: UpsertDelegationTeamInput) => w().createTeam(input),
  update: (id: string, patch: UpdateDelegationTeamPatch) => w().updateTeam(id, patch),
  delete: (id: string) => w().deleteTeam(id),
  createRun: (input: { teamId: string; goal: string; cwd?: string; conversationId?: string }) =>
    w().createRun(input),
  approveWrite: (input: { runId: string; approvalId: string; approved: boolean }) =>
    w().approveWrite(input),
  getRun: (id: string) => w().getRun(id),
  listEvents: (runId: string) => w().listEvents(runId),
  onChanged: (cb: () => void) => w().onChanged(cb)
};
```

- [ ] **Step 2: Create `src/store/delegationStore.ts`** (Zustand, mirror `workflowTeamStore.ts` shape): state `teams: DelegationTeam[]`, actions `load/getById/create/update/delete`. `load` calls `delegationClient.list()`; subscribe `onChanged` in the component that uses it (mirror `WorkflowTeamsTab` which wires `workflowTeamsClient.onChanged`).

```ts
import { create } from "zustand";
import { delegationClient, type UpsertDelegationTeamInput, type UpdateDelegationTeamPatch } from "@/services/delegation/client";
import type { DelegationTeam } from "@/services/workflowTeams/types";

interface DelegationTeamState {
  teams: DelegationTeam[];
  load: () => Promise<void>;
  getById: (id: string) => DelegationTeam | undefined;
  create: (input: UpsertDelegationTeamInput) => Promise<DelegationTeam>;
  update: (id: string, patch: UpdateDelegationTeamPatch) => Promise<DelegationTeam | undefined>;
  delete: (id: string) => Promise<boolean>;
}

export const useDelegationTeamStore = create<DelegationTeamState>((set, get) => ({
  teams: [],
  load: async () => set({ teams: await delegationClient.list() }),
  getById: (id) => get().teams.find((t) => t.id === id),
  create: async (input) => { const t = await delegationClient.create(input); await get().load(); return t; },
  update: async (id, patch) => { const t = await delegationClient.update(id, patch); await get().load(); return t; },
  delete: async (id) => { const ok = await delegationClient.delete(id); await get().load(); return ok; }
}));
```

- [ ] **Step 3: `npm run typecheck` clean; Commit**
```bash
git add src/services/delegation/client.ts src/store/delegationStore.ts
git commit -m "feat(delegation): add renderer client and team store"
```

---

## Task 4: DelegationTeamEditor component + Settings routing

- [ ] **Step 1: Create `src/components/Settings/DelegationTeamEditor.tsx`**

A form (antd `Form`, `Input`, `Input.TextArea`, `Select`, `Switch`, `InputNumber`) with three sections — Overview, Roster (cards: label, agent `Select` from `useCliExecutorStore`/members, model `Select`, `capability` `TextArea`, `canWrite` `Switch`), Entry (radio over roster ids), Policy (`maxDepth`, `delegateTimeoutMs`, `requireApprovalBeforeDelegateWrite`, `allowWrites`, `stopOnDelegateFailure`). On save → `useDelegationTeamStore.create/update`. Mirror the visual layout/props of `WorkflowTeamEditor.tsx` (header + footer save/cancel) without reproducing its workflow-specific sections.

```tsx
import { useEffect, useMemo, useState } from "react";
import { Button, Form, Input, InputNumber, Select, Switch, Radio, Card, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type { DelegationRosterEntry, DelegationPolicy, DelegationTeam } from "@/services/workflowTeams/types";
import { useDelegationTeamStore } from "@/store/delegationStore";
import { useCliExecutorStore } from "@/store/cliExecutorStore";

const { TextArea } = Input;

function defaultPolicy(): DelegationPolicy {
  return { allowWrites: true, requireApprovalBeforeDelegateWrite: true, maxDepth: 3, delegateTimeoutMs: 600000, maxConcurrentDelegates: 1, stopOnDelegateFailure: false };
}
function newRosterEntry(id: string): DelegationRosterEntry {
  return { id, label: "", agentId: "", capability: "", canWrite: false };
}

export function DelegationTeamEditor({ teamId, onDone }: { teamId?: string; onDone: () => void }) {
  const { t } = useTranslation();
  const members = useCliExecutorStore((s) => s.members); // adjust to the actual members selector used by WorkflowTeamEditor
  const create = useDelegationTeamStore((s) => s.create);
  const update = useDelegationTeamStore((s) => s.update);
  const existing = useDelegationTeamStore((s) => (teamId ? s.getById(teamId) : undefined));

  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [roster, setRoster] = useState<DelegationRosterEntry[]>(existing?.roster ?? [newRosterEntry("r-1")]);
  const [entryRoleId, setEntryRoleId] = useState<string>(existing?.entryRoleId ?? "r-1");
  const [policy, setPolicy] = useState<DelegationPolicy>(existing?.policy ?? defaultPolicy());

  const agentOptions = useMemo(() => (members ?? []).map((m: any) => ({ value: m.id, label: m.name })), [members]);

  const setEntry = (patch: Partial<DelegationRosterEntry>, id: string) =>
    setRoster((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const save = async () => {
    const payload = { name, description: description || undefined, enabled: existing?.enabled ?? true, source: existing?.source ?? ("user" as const), entryRoleId, roster, policy };
    if (existing) await update(existing.id, payload);
    else await create({ id: `team-delegation-${Date.now().toString(36)}`, ...payload });
    onDone();
  };

  return (
    <Card title={t("workflow.delegation.editorTitle")} extra={<Space><Button onClick={onDone}>{t("common.cancel")}</Button><Button type="primary" onClick={save}>{t("common.save")}</Button></Space>}>
      <Typography.Text strong>{t("workflow.delegation.overview")}</Typography.Text>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("workflow.delegation.namePlaceholder")} />
      <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("workflow.delegation.descriptionPlaceholder")} style={{ marginTop: 8 }} />

      <Typography.Text strong style={{ display: "block", marginTop: 16 }}>{t("workflow.delegation.roster")}</Typography.Text>
      {roster.map((r) => (
        <Card key={r.id} size="small" style={{ marginTop: 8 }}>
          <Space direction="vertical" style={{ width: "100%" }}>
            <Input value={r.label} onChange={(e) => setEntry({ label: e.target.value }, r.id)} placeholder={t("workflow.delegation.labelPlaceholder")} />
            <Select value={r.agentId || undefined} options={agentOptions} onChange={(v) => setEntry({ agentId: v }, r.id)} placeholder={t("workflow.delegation.agentPlaceholder")} style={{ width: "100%" }} />
            <TextArea value={r.capability} onChange={(e) => setEntry({ capability: e.target.value }, r.id)} placeholder={t("workflow.delegation.capabilityPlaceholder")} autoSize={{ minRows: 2 }} />
            <Space>
              <Switch checked={r.canWrite} onChange={(v) => setEntry({ canWrite: v }, r.id)} />
              <Typography.Text>{t("workflow.delegation.canWrite")}</Typography.Text>
            </Space>
          </Space>
        </Card>
      ))}
      <Button style={{ marginTop: 8 }} onClick={() => setRoster((rs) => [...rs, newRosterEntry(`r-${rs.length + 1}`)])}>{t("workflow.delegation.addRosterEntry")}</Button>

      <Typography.Text strong style={{ display: "block", marginTop: 16 }}>{t("workflow.delegation.entryAgent")}</Typography.Text>
      <Radio.Group value={entryRoleId} onChange={(e) => setEntryRoleId(e.target.value)}>
        <Space direction="vertical">{roster.map((r) => <Radio key={r.id} value={r.id}>{r.label || r.id}</Radio>)}</Space>
      </Radio.Group>

      <Typography.Text strong style={{ display: "block", marginTop: 16 }}>{t("workflow.delegation.policy")}</Typography.Text>
      <Space wrap>
        <InputNumber addonAfter={t("workflow.delegation.maxDepth")} min={1} max={6} value={policy.maxDepth} onChange={(v) => setPolicy({ ...policy, maxDepth: Number(v) || 3 })} />
        <InputNumber addonAfter={t("workflow.delegation.timeoutMin")} min={1} value={Math.round(policy.delegateTimeoutMs / 60000)} onChange={(v) => setPolicy({ ...policy, delegateTimeoutMs: (Number(v) || 10) * 60000 })} />
        <Space><Switch checked={policy.allowWrites} onChange={(v) => setPolicy({ ...policy, allowWrites: v })} /><Typography.Text>{t("workflow.delegation.allowWrites")}</Typography.Text></Space>
        <Space><Switch checked={policy.requireApprovalBeforeDelegateWrite} onChange={(v) => setPolicy({ ...policy, requireApprovalBeforeDelegateWrite: v })} /><Typography.Text>{t("workflow.delegation.requireApprovalBeforeDelegateWrite")}</Typography.Text></Space>
        <Space><Switch checked={policy.stopOnDelegateFailure} onChange={(v) => setPolicy({ ...policy, stopOnDelegateFailure: v })} /><Typography.Text>{t("workflow.delegation.stopOnDelegateFailure")}</Typography.Text></Space>
      </Space>
    </Card>
  );
}
```

> Verify the members selector name on the cli executor store (`useCliExecutorStore((s) => s.members)`); `WorkflowTeamEditor.tsx` uses one — match its exact selector. Keep the member type loose (`any`) to avoid coupling.

- [ ] **Step 2: Route in `WorkflowTeamsTab.tsx` / `WorkflowTeamList.tsx`**

Load both kinds: in `WorkflowTeamsTab`, also load delegation teams (`useDelegationTeamStore.load`) and subscribe `delegationClient.onChanged`. Combine workflow + delegation teams in the list. When editing/creating, if the team is a delegation team (or the user picked "New delegation team"), render `<DelegationTeamEditor>`; else the existing `WorkflowTeamEditor`. Add a "New" split-button or a second "New delegation team" button.

- [ ] **Step 3: `npm run typecheck` clean; manual render check (build renderer). Commit**
```bash
git add src/components/Settings/DelegationTeamEditor.tsx src/components/Settings/WorkflowTeamsTab.tsx src/components/Settings/WorkflowTeamList.tsx
git commit -m "feat(delegation): add delegation team editor and settings routing"
```

---

## Task 5: ChatView team picker + delegation preview + start

- [ ] **Step 1: Create `src/components/Workflows/DelegationTeamPreviewCard.tsx`**

A compact card: team name, goal (the entered text), entry agent, roster list (`label → capability`), policy summary (maxDepth / timeout / write approval). Props: `{ team: DelegationTeam; goal: string; onRun: () => void; onCancel: () => void }`. Mirror `WorkflowTeamPreviewCard.tsx` visual style.

- [ ] **Step 2: In `src/components/CLI/ChatView.tsx`**

- The team `<select>` (around line 2589-2606) currently lists workflow teams; include delegation teams too (mark them with a suffix like `（自组织）`). Track whether the selected team is a delegation team.
- When a delegation team is selected, render `<DelegationTeamPreviewCard>` instead of the workflow preview (around line 1865-1877 where preview is triggered on goal change).
- On send in team mode (around 1646/1900 where `createAndStartTeam` is called): if the selected team is delegation, call `delegationClient.createRun({ teamId, goal, cwd, conversationId })` instead and open the delegation run view (see Task 6). Keep the workflow path unchanged.

- [ ] **Step 3: `npm run typecheck`; build renderer; Commit**
```bash
git add src/components/Workflows/DelegationTeamPreviewCard.tsx src/components/CLI/ChatView.tsx
git commit -m "feat(delegation): team picker, preview card, and start path"
```

---

## Task 6: Delegation-tree Run view (poll) + write-approval gate

- [ ] **Step 1: Create `src/components/Workflows/DelegationRunTree.tsx`**

Renders `DelegationEvent[]` as an indented tree (group children by `parentEventId`; render root first; indent by `depth`). Each row: agent avatar/name, roleLabel, status badge (`running`/`done`/`failed`/`timeout`), task text (expandable), result summary (expandable), timing. Pure component given events.

- [ ] **Step 2: Create `src/components/Workflows/DelegationRunPanel.tsx`**

Props: `{ runId: string }`. Polls `delegationClient.getRun(runId)` + `delegationClient.listEvents(runId)` every 1500 ms while status is non-terminal (mirror `WorkflowRunPanel.tsx` polling at lines ~111-115). Renders: run status/progress header, `<DelegationRunTree events={events}/>`, a Stop button (calls a stop IPC — note: a `workflow:stopDelegationRun` handler is not yet implemented; either add it in a small follow-up or omit Stop in v1 and rely on killing the app window — flag this). Write-approval: when `run.status === 'blocked'`, fetch the pending approval via an IPC (add `delegation:listPendingApprovals`? or surface the latest approval from the run state) and show Approve/Reject buttons → `delegationClient.approveWrite({ runId, approvalId, approved })`.

> **Stop & pending-approval reads need main-process IPC not in 2b.** Add them here: in `delegationTeamIpc.ts` (or `delegationIpc.ts`) register `delegation:listPendingApprovals` (returns `runtime.listPendingApprovals()` — requires exposing the runtime singleton from `delegationIpc.ts`) and `delegation:stopRun` (sets run status killed + kills live agents — for v1 a simple "mark killed" stub is acceptable; full kill wiring can be a fast-follow). Expose both on the preload bridge + client.

- [ ] **Step 3: Route the run view by kind.** Where `WorkflowRunPanel` is shown for a conversation/run (ChatView or WorkspacePanel), branch: if the run is a delegation run (`getRun` returns kind 'delegation'), render `<DelegationRunPanel runId=...>` instead.

- [ ] **Step 4: `npm run typecheck`; build renderer; Commit**
```bash
git add src/components/Workflows/DelegationRunTree.tsx src/components/Workflows/DelegationRunPanel.tsx src/components/CLI/ChatView.tsx electron/cli/delegationTeamIpc.ts electron/preload.ts src/services/delegation/client.ts
git commit -m "feat(delegation): live delegation-tree run view with write-approval gate"
```

---

## Task 7: i18n keys + final regression

- [ ] **Step 1: Add keys** to the locale files (zh-CN primary; en translation) under `workflow.delegation.*` matching every `t("workflow.delegation.…")` used above (`editorTitle`, `overview`, `roster`, `capabilityPlaceholder`, `canWrite`, `entryAgent`, `policy`, `maxDepth`, `timeoutMin`, `allowWrites`, `requireApprovalBeforeDelegateWrite`, `stopOnDelegateFailure`, `addRosterEntry`, `namePlaceholder`, `descriptionPlaceholder`, `labelPlaceholder`, `agentPlaceholder`, plus run-view labels). Find the locale file location by grepping for an existing `workflow.teamExecution` key.

- [ ] **Step 2: `npm run typecheck && npm run build:electron && npm run build:renderer`** all clean.

- [ ] **Step 3: `npm run test:handoff-db`** all pass.

- [ ] **Step 4 (manual smoke):** launch the app, create a delegation team (Settings), pick it on the new-task page, enter a goal, run, observe the tree populate and (with `requireApprovalBeforeDelegateWrite`) the approve gate. This is the first true end-to-end exercise of Plans 1+2+3.

- [ ] **Step 5: Commit**
```bash
git add <locale files>
git commit -m "feat(delegation): i18n keys for delegation UI"
```

---

## Self-Review (run after all tasks)

- **Spec coverage (§UI):** Settings editor (roster/entry/policy, no canvas) ✓ (Task 4); ChatView picker + preview + start ✓ (Task 5); live delegation-tree run view + Stop + Approve/Reject ✓ (Task 6); i18n ✓ (Task 7); renderer type mirror ✓ (Task 1). Indented tree (v1) not graph canvas — per design doc.
- **IPC gaps closed:** Plan 1 left team CRUD + run reads unwired → Task 2 adds them. Plan 2b left stop/pending-approval reads → Task 6 adds them (stop as v1 stub if full kill wiring is deferred).
- **Polling over push:** run panel polls every 1500 ms (matches workflow run panel) — no `delegation://event` push wiring needed.
- **Known v1 limitations to flag to the user:** (a) `delegation:stopRun` may be a status-only stub in v1 (real multi-agent kill is a fast-follow); (b) chat-pane "delegation cards" (spec §聊天窗集成) are optional polish — the tree panel is the primary surface; skip if time-boxed.
- **Deferred / out of scope:** graph canvas, cross-run activity aggregation, external IM — none in this plan.
