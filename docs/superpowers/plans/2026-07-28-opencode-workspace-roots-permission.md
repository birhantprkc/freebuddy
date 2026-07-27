# OpenCode Workspace Roots Permission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When FreeBuddy starts OpenCode ACP for a multi-folder project, inject `OPENCODE_CONFIG_CONTENT.permission.external_directory` allows for every `workspaceRoots` path so OpenCode native tools no longer hang on silent internal `ask`.

**Architecture:** Extend `buildCommand` for `opencode-acp` to merge a session-scoped permission block into the existing `OPENCODE_CONFIG_CONTENT` env (already used for model). Pass `CliRunArgs.workspaceRoots` from `runtime.ts` into `buildCommand`. No disk writes; other adapters unchanged.

**Tech Stack:** TypeScript (Electron main), Node `path`, existing `buildCommand` / `node --test` suite (`tests/acp.test.mjs` imports `dist-electron`).

**Spec:** `docs/superpowers/specs/2026-07-28-opencode-workspace-roots-permission-design.zh-CN.md`

## Global Constraints

- Only adapter `opencode-acp`.
- Full allow (read + write + bash): `"${root}/**": "allow"` — no `edit: deny`.
- Inject `permission` only when `workspaceRoots.length > 1` after filtering empties.
- Do not write project `opencode.json`.
- Do not change MCP registration; keep `freebuddy-workspace-fs` as-is.
- Paths outside project folders stay on OpenCode defaults.
- Merge with existing `model` in the same `OPENCODE_CONFIG_CONTENT` JSON object.

---

## File map

| File | Responsibility |
|------|----------------|
| `electron/cli/adapters.ts` | `BuildCommandInput.workspaceRoots`; helper to build OpenCode config content; `opencode-acp` case |
| `electron/cli/runtime.ts` | Pass `args.workspaceRoots` into `buildCommand` |
| `tests/acp.test.mjs` | Unit tests for single-root / multi-root / model+permission merge / trailing slash |

Out of scope for this plan: `sessionConfigProbe.ts` / `acpAuth.ts` (no conversation `workspaceRoots` today; config probe and auth login do not need multi-root allow).

---

### Task 1: buildCommand injects external_directory allows

**Files:**
- Modify: `electron/cli/adapters.ts`
- Test: `tests/acp.test.mjs`

**Interfaces:**
- Consumes: `BuildCommandInput` (extend with `workspaceRoots?: string[]`)
- Produces:
  - `export function buildOpenCodeConfigContent(input: { model?: string; workspaceRoots?: string[] }): Record<string, unknown> | undefined`
  - `buildCommand` for `opencode-acp` sets `env.OPENCODE_CONFIG_CONTENT` when the helper returns a non-empty object

- [ ] **Step 1: Write the failing tests**

Append to `tests/acp.test.mjs` (keep existing OpenCode model tests unchanged):

```js
test("buildCommand omits OpenCode permission for single workspace root", () => {
  const built = buildCommand({
    adapter: "opencode-acp",
    prompt: "hello",
    cwd: "/tmp/primary",
    workspaceRoots: ["/tmp/primary"]
  });
  assert.equal(built.env, undefined);
});

test("buildCommand injects OpenCode external_directory allows for multi-root projects", () => {
  const built = buildCommand({
    adapter: "opencode-acp",
    prompt: "hello",
    cwd: "/tmp/primary",
    workspaceRoots: ["/tmp/primary/", "/tmp/secondary", ""]
  });
  const content = JSON.parse(built.env.OPENCODE_CONFIG_CONTENT);
  assert.deepEqual(content.permission.external_directory, {
    "/tmp/primary/**": "allow",
    "/tmp/secondary/**": "allow"
  });
  assert.equal(content.model, undefined);
});

test("buildCommand merges OpenCode model with multi-root permission", () => {
  const built = buildCommand({
    adapter: "opencode-acp",
    prompt: "hello",
    cwd: "/tmp/primary",
    extraArgs: ["-m", "openai/gpt-4.1"],
    workspaceRoots: ["/tmp/primary", "/tmp/secondary"]
  });
  assert.deepEqual(JSON.parse(built.env.OPENCODE_CONFIG_CONTENT), {
    model: "openai/gpt-4.1",
    permission: {
      external_directory: {
        "/tmp/primary/**": "allow",
        "/tmp/secondary/**": "allow"
      }
    }
  });
});
```

Note: on Windows CI, `path.resolve` may change separators. Prefer asserting with `path.resolve` in the test expected keys so Darwin/Linux/Windows agree:

```js
import path from "node:path";

function allowPattern(root) {
  return `${path.resolve(root).replace(/[/\\]+$/, "")}${path.sep === "\\" ? "\\\\**" : "/**"}`;
}
```

Prefer generating expected keys the same way as production: export `buildOpenCodeConfigContent` and assert on its output using `path.resolve` + `/**` with forward slashes if the helper always emits POSIX-style patterns (OpenCode docs use `/`). **Implementation choice (lock in code):** normalize with `path.resolve`, strip trailing separators, then always emit `"${abs}/**"` using forward slashes by replacing `\` → `/` on the absolute path before appending `/**`. That matches OpenCode docs and keeps tests OS-stable when written with forward-slash expectations after resolving on the current OS — actually on Windows resolve yields `C:\...`. Safer: in tests, build expected via the same exported helper for path list only, or compare `Object.keys(content.permission.external_directory).length === 2` and every value `"allow"` and every key endsWith `/**`.

Use this assertion style (OS-stable):

```js
test("buildCommand injects OpenCode external_directory allows for multi-root projects", () => {
  const built = buildCommand({
    adapter: "opencode-acp",
    prompt: "hello",
    cwd: "/tmp/primary",
    workspaceRoots: ["/tmp/primary/", "/tmp/secondary", ""]
  });
  const content = JSON.parse(built.env.OPENCODE_CONFIG_CONTENT);
  const rules = content.permission.external_directory;
  assert.equal(Object.keys(rules).length, 2);
  for (const [pattern, action] of Object.entries(rules)) {
    assert.equal(action, "allow");
    assert.match(pattern, /\/\*\*$/);
  }
  assert.ok(Object.keys(rules).some((k) => k.includes("primary")));
  assert.ok(Object.keys(rules).some((k) => k.includes("secondary")));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run build:electron && node --test --test-force-exit tests/acp.test.mjs
```

Expected: new tests FAIL (e.g. `built.env` undefined, or `workspaceRoots` ignored).

- [ ] **Step 3: Implement helpers + opencode-acp branch**

In `electron/cli/adapters.ts`:

1. Add at top: `import path from "node:path";` (if not already present).

2. Extend interface:

```ts
export interface BuildCommandInput {
  adapter: string;
  binary?: string;
  prompt: string;
  extraArgs?: string[];
  cwd?: string;
  toolSessionId?: string;
  /** Absolute multi-folder project roots; OpenCode gets external_directory allows when length > 1. */
  workspaceRoots?: string[];
}
```

3. Add exported helper (place near `buildCommand`):

```ts
/** Build OpenCode OPENCODE_CONFIG_CONTENT object (model + multi-root permission). */
export function buildOpenCodeConfigContent(input: {
  model?: string;
  workspaceRoots?: string[];
}): Record<string, unknown> | undefined {
  const content: Record<string, unknown> = {};
  if (input.model) {
    content.model = input.model;
  }

  const roots = (input.workspaceRoots ?? [])
    .map((raw) => {
      if (typeof raw !== "string") return "";
      const trimmed = raw.trim();
      if (!trimmed) return "";
      try {
        return path.resolve(trimmed).replace(/[/\\]+$/, "");
      } catch {
        return "";
      }
    })
    .filter(Boolean);

  const uniqueRoots = [...new Set(roots)];
  if (uniqueRoots.length > 1) {
    const externalDirectory: Record<string, "allow"> = {};
    for (const root of uniqueRoots) {
      const pattern = `${root.replace(/\\/g, "/")}/**`;
      externalDirectory[pattern] = "allow";
    }
    content.permission = { external_directory: externalDirectory };
  }

  return Object.keys(content).length > 0 ? content : undefined;
}
```

4. Replace the `opencode-acp` case body env construction:

```ts
case "opencode-acp": {
  const { model, args: acpArgs } = splitModelArg(extra);
  const args: string[] = ["acp"];
  if (input.cwd) args.push("--cwd", input.cwd);
  args.push(...acpArgs);
  const configContent = buildOpenCodeConfigContent({
    model,
    workspaceRoots: input.workspaceRoots
  });
  return {
    bin,
    args,
    ...(configContent
      ? { env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(configContent) } }
      : {}),
    promptViaStdin: false,
    protocol: "acp"
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm run build:electron && node --test --test-force-exit tests/acp.test.mjs
```

Expected: all tests in the file PASS, including the three new ones and existing OpenCode model tests.

- [ ] **Step 5: Commit**

```bash
git add electron/cli/adapters.ts tests/acp.test.mjs
git commit -m "$(cat <<'EOF'
feat(opencode): allow multi-folder workspace roots via config inject

EOF
)"
```

---

### Task 2: Pass workspaceRoots from cliRun into buildCommand

**Files:**
- Modify: `electron/cli/runtime.ts` (the `buildCommand({...})` call ~lines 207–214)
- Test: reuse `tests/acp.test.mjs` (already covers buildCommand); add a thin wiring assertion only if an existing runtime test harness mocks `buildCommand` — otherwise verify by reading the call site and running full electron test build. Prefer a small unit test that imports nothing heavy: grep-based contract test is already used elsewhere (`tests/acp-runtime-contract.test.mjs` style).

**Interfaces:**
- Consumes: `CliRunArgs.workspaceRoots` (already on `runtimeShared.ts`)
- Produces: `buildCommand` receives `workspaceRoots: args.workspaceRoots`

- [ ] **Step 1: Write the failing contract test**

Create or extend a lightweight test. Prefer adding to `tests/acp.test.mjs` is not enough for wiring — add to `tests/acp-runtime-contract.test.mjs` if it already greps `runtime.ts`, or create assertion in an existing file that reads source:

Check whether `tests/acp-runtime-contract.test.mjs` exists and pattern-matches. If yes, add:

```js
test("cliRun passes workspaceRoots into buildCommand", () => {
  const src = fs.readFileSync(
    new URL("../electron/cli/runtime.ts", import.meta.url),
    "utf8"
  );
  assert.match(src, /workspaceRoots:\s*args\.workspaceRoots/);
});
```

If that file is unsuitable, add the same test at the bottom of `tests/acp.test.mjs` with `fs` + `assert.match` on `runtime.ts` source (same pattern as other contract tests in the repo).

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run build:electron && node --test --test-force-exit tests/acp.test.mjs
```

(or the contract file you edited)

Expected: FAIL — `workspaceRoots: args.workspaceRoots` not present.

- [ ] **Step 3: Wire runtime.ts**

Change the `buildCommand` call in `electron/cli/runtime.ts` to:

```ts
    built = buildCommand({
      adapter: args.adapter,
      binary: args.binary,
      prompt: effectiveArgs.prompt,
      extraArgs: args.extraArgs,
      cwd: args.cwd,
      toolSessionId,
      workspaceRoots: args.workspaceRoots
    });
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run build:electron && node --test --test-force-exit tests/acp.test.mjs
```

Expected: PASS (including contract test). Optionally also run:

```bash
node --test --test-force-exit tests/acp-runtime-contract.test.mjs
```

if that file was modified.

- [ ] **Step 5: Commit**

```bash
git add electron/cli/runtime.ts tests/acp.test.mjs tests/acp-runtime-contract.test.mjs
git commit -m "$(cat <<'EOF'
fix(runtime): pass workspaceRoots into OpenCode buildCommand

EOF
)"
```

---

### Task 3: Spec amendment note + manual checklist

**Files:**
- Modify: `docs/superpowers/specs/2026-07-27-multi-folder-projects-design.zh-CN.md` (short amendment pointer only)

- [ ] **Step 1: Add a one-paragraph amendment**

Near the product decision that said「不按 CLI Adapter 做原生 multi-root 特例」, append:

```markdown
> **修订（2026-07-28）：** OpenCode 例外 — 见 `2026-07-28-opencode-workspace-roots-permission-design.zh-CN.md`。多根项目启动 `opencode-acp` 时通过 `OPENCODE_CONFIG_CONTENT` 注入 `permission.external_directory` allow；其它 adapter 仍仅依赖 MCP。
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-07-27-multi-folder-projects-design.zh-CN.md
git commit -m "$(cat <<'EOF'
docs: note OpenCode multi-root permission exception in projects spec

EOF
)"
```

- [ ] **Step 3: Manual verification checklist (do not automate)**

1. Open FreeBuddy project `51caiji` (folders: primary + `exadmin` + WeChat mini program).
2. Start a new OpenCode turn that explores a secondary root (e.g. list files under `exadmin`).
3. Confirm `~/.local/share/opencode/log/opencode.log` shows `external_directory` with `action=allow` for that path (not `asking`).
4. Confirm the session does not leave task tools stuck in「等待中」for mounted roots.
5. Confirm a path **outside** folders (if tested) still asks / is not auto-allowed by FreeBuddy injection.

---

## Spec coverage self-review

| Spec requirement | Task |
|------------------|------|
| Inject via `OPENCODE_CONFIG_CONTENT` | Task 1 |
| Full allow `root/**` | Task 1 |
| Only `opencode-acp` | Task 1 |
| Multi-root only (`length > 1`) | Task 1 |
| Merge with model | Task 1 |
| Pass `workspaceRoots` from run path | Task 2 |
| No disk `opencode.json` | (no task writes disk) |
| Amend multi-folder design note | Task 3 |
| Manual acceptance | Task 3 Step 3 |

No TBD placeholders. Helper and `buildCommand` signatures are consistent across tasks.
