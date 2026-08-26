# FreeBuddy Modular Runtime Pack — End-to-End Implementation Plan

> **For implementing agents:** Execute this plan task-by-task in order. Keep every task independently buildable and reviewable. Check off boxes only after the stated tests pass. Do not introduce public npm publishing, third-party plugins, or untrusted-code execution while implementing this plan.

**Goal:** Refactor FreeBuddy into private workspace packages, isolate workflow/delegation runtime logic from Electron and SQLite, and add a signed, independently updatable Runtime Pack with compatibility negotiation, safe activation, side-by-side version routing, and automatic rollback.

**User-visible outcome:** Workflow, delegation, prompt/protocol, parser, and compatible Agent adapter fixes can be shipped as a Runtime Pack without releasing a new Electron installer. The exact same Runtime Pack and Host API can later be used by a standalone `freebuddy-cli`. Electron/preload/UI/native/database-schema changes still use the existing desktop release path.

**Architecture:** FreeBuddy Desktop and a future `freebuddy-cli` are Host implementations around one Host-neutral Runtime. Pure domain packages feed injectable workflow and delegation runtimes. A shared `@freebuddy/runtime-host` package owns Runtime Pack update/install/state/version policy through injected environment and launcher ports. Each product Host owns its database connection, native modules, credentials, filesystem/process capabilities, and presentation. A first-party signed Runtime Pack runs in a separate process and communicates with either Host over the same versioned, validated bidirectional RPC protocol. Desktop uses an Electron utility-process adapter; CLI uses a Node child-process adapter.

**Tech stack:** npm workspaces, TypeScript ESM, Node test runner, Vite, Electron `utilityProcess`, Node `child_process`, `node:crypto` Ed25519 verification, existing SQLite layer, GitHub Actions.

**Branch:** `codex/runtime-pack-modularization`

---

## 1. Non-negotiable decisions

- The client must never run `npm install`, lifecycle scripts, or arbitrary package-manager commands to update Runtime Packs.
- Workspace packages remain `private: true` in this project. npm publication is not required for independent Runtime Pack delivery.
- Internal source is modular, but the initial remote distribution unit is one `freebuddy-runtime` bundle. Do not independently update every internal package.
- Runtime Packs are first-party and must be signed. Third-party/untrusted plugin execution is out of scope.
- A downloaded Runtime Pack must not be imported into the Electron main process. It runs in a separate utility process for crash isolation. This is not a security sandbox; signature trust remains mandatory.
- The Runtime Pack, Runtime RPC, and `@freebuddy/runtime-host` must not import Electron or assume a graphical UI. Host differences are expressed through explicit capabilities and injected adapters.
- Shared Runtime management must not call `app.getPath`, `app.isPackaged`, `BrowserWindow`, or Electron updater APIs. Desktop passes those values through a Host environment adapter; a future CLI passes its own data directory and policy.
- The Host owns database connections and migrations. Runtime code accesses persisted data only through versioned Host APIs.
- Runtime bundles must contain no native Node addons and no platform-specific install scripts. `better-sqlite3`, `node-pty`, Electron APIs, updater code, and OS integration stay in the Host.
- Existing IPC channel names, database behavior, and user-visible behavior remain compatible during phases 1 and 2.
- Runtime activation must never interrupt an active task. Persisted runs are pinned to the Runtime version that created them; new runs use the active version.
- Always retain a bundled fallback Runtime and at least one last-known-good downloaded Runtime.
- Any Runtime requiring a new database migration, Electron capability, preload API, or UI surface must declare a newer Host API/capability requirement (and an optional product-specific Host constraint when unavoidable) and wait for the affected Host product to release support.

---

## 2. Target repository structure

```text
freebuddy/
├─ packages/
│  ├─ protocol/
│  ├─ workflow-core/
│  ├─ delegation-core/
│  ├─ cli-stream/
│  ├─ agent-runtime/
│  ├─ workflow-runtime/
│  ├─ delegation-runtime/
│  ├─ storage-sqlite/
│  ├─ runtime-entry/
│  └─ runtime-host/
│     ├─ src/ports.ts
│     ├─ src/runtimeManager.ts
│     ├─ src/runtimeUpdateService.ts
│     ├─ src/runtimeDownloader.ts
│     ├─ src/runtimeVerifier.ts
│     ├─ src/runtimeInstaller.ts
│     ├─ src/runtimeStateStore.ts
│     ├─ src/runtimeVersionRouter.ts
│     ├─ src/runtimeHealthMonitor.ts
│     └─ src/node/nodeRuntimeProcessLauncher.ts
├─ electron/
│  ├─ runtime/
│  │  ├─ runtimeRpcHost.ts
│  │  ├─ electronRuntimeEnvironment.ts
│  │  ├─ electronRuntimeProcessLauncher.ts
│  │  ├─ bundledRuntime.ts
│  │  └─ runtimeIpc.ts
│  └─ ... existing Host code
├─ scripts/
│  ├─ build-runtime-pack.mjs
│  ├─ sign-runtime-pack.mjs
│  ├─ verify-runtime-pack.mjs
│  └─ runtime-release-lib.mjs
├─ tests/
│  ├─ runtime-*.test.mjs
│  └─ fixtures/runtime-packs/
└─ .github/workflows/runtime-release.yml
```

Do not move `electron/` and `src/` under a new `apps/desktop/` directory in this project. That move produces a large low-value diff and can be considered after the runtime architecture is stable. Do not create the actual `freebuddy-cli` product in this plan; do create the shared Host API, Node process launcher, and CLI conformance harness needed so the future CLI can consume the same Runtime Pack without another architectural refactor.

---

## 2.1 Agent execution and parallelization guidance

- Phase 0 and Task 1.1 are sequential foundations.
- After Task 1.2 lands, Tasks 1.3, 1.4, and 1.5 may be implemented in parallel worktrees, but the integrating agent must own shared import and lockfile conflict resolution.
- Task 2.1 must land before other Phase 2 tasks. Tasks 2.4 and 2.5 may proceed in parallel only after the port contracts and legacy adapters stabilize.
- In Phase 3, RPC contracts and the Runtime Pack build must land before process hosting. State/install, signing, and downloader work may be developed in parallel against fixed fixtures, then integrated before activation/version routing.
- One agent must remain responsible for end-to-end integration, database compatibility, packaged smoke tests, and checking boxes in this document. Parallel agents must not silently change shared contracts.
- Prefer one commit per task using the suggested commit message. Do not combine Phase 1 extraction with Phase 3 behavior changes.

---

## 3. Dependency rules

```text
                         freebuddy-runtime.pack
                           /                 \
                          /                   \
          FreeBuddy Desktop Host         future freebuddy-cli Host
          Electron launcher/IPC          Node launcher/terminal
                          \                   /
                           \                 /
                          @freebuddy/runtime-host
                                      │
      ┌───────────────────────────────┼───────────────────────────────┐
      ▼                               ▼                               ▼
workflow-runtime              delegation-runtime               agent-runtime
      │                               │                               │
workflow-core                 delegation-core                   cli-stream
      └───────────────────────────────┴───────────────────────────────┘
                                      │
                                  protocol
```

Rules to enforce in tests:

- `protocol`: no imports from other FreeBuddy packages, Electron, React, Zustand, i18next, SQLite, filesystem, process control, or app directories.
- `workflow-core` and `delegation-core`: pure deterministic logic; may import only `protocol` and standard-library types that do not create side effects.
- `cli-stream`: may import only `protocol`; no UI store mutation.
- Runtime packages: may import their core package, `protocol`, and `agent-runtime`; no Electron, concrete SQLite, `ipcSend`, `WebContents`, `BrowserWindow`, or `getDb`.
- `storage-sqlite`: implements repository ports and owns SQL, but never imports Electron or React.
- `runtime-entry`: composes only runtime packages; no Electron/native/storage imports.
- `runtime-host`: may use portable Node standard-library APIs, but never imports Electron, React, desktop updater state, or app directories; data directory, packaged/development policy, fetch/configuration, trusted keys, clocks, and process launch are injected or provided through explicit subpath adapters.
- Electron Desktop and a future CLI are peer composition roots. Neither product-specific Host may leak types into the Runtime Pack.
- No package may deep-import another package's `src/` or unexported file.
- No dependency cycles are allowed.

---

## 4. Version contracts

Maintain separate versions:

```text
Product Host version     Desktop or CLI package version, e.g. 0.9.0
Host API version         stable capability API, e.g. 1.0
Runtime version          Runtime Pack SemVer, e.g. 1.0.0
Runtime RPC version      wire framing/protocol, initially 1
Runtime state schema     runtime-state.json schema, initially 1
Runtime manifest schema  manifest schema, initially 1
Runtime Node engine      common Desktop utility-process/CLI baseline
```

Compatibility rules:

- Patch/minor Runtime releases may add optional output fields and capabilities.
- They may not remove or change existing Host API methods within the same major Host API version.
- Unknown optional fields/events must be ignored.
- Unknown required capabilities reject activation.
- Breaking RPC/Host API changes require a release of each affected Host product that supports both old and new versions during migration.
- Compatibility is primarily capability- and Host-API-based, not hardcoded to Electron or a particular product ID. `hostId` is informational/auditing context unless an explicit product constraint is unavoidable.
- Runtime artifacts declare a supported Node engine range and must run on both the Electron utility process's Node version and the future CLI's supported Node baseline.
- Runtime code may not change the SQLite schema.

---

# Phase 0 — Baseline and safety rails

### Task 0.1: Record a clean behavioral baseline

**Files:**
- Modify: none

- [ ] Record current branch and commit SHA in the implementation handoff notes.
- [ ] Confirm `git status --short` is clean before implementation.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Save failures that already exist; do not silently weaken tests to make the refactor pass.

**Commit:** none.

### Task 0.2: Add architecture decision and boundary tests

**Files:**
- Create: `docs/runtime-pack-architecture.md`
- Create: `tests/package-boundaries.test.mjs`
- Modify: `package.json`

- [ ] Document Host versus Runtime responsibilities, version contracts, trust model, activation semantics, and explicit non-goals.
- [ ] Add a boundary test that scans package imports and rejects forbidden dependencies listed in section 3.
- [ ] Add a cycle check for workspace packages.
- [ ] Ensure the boundary test runs in the normal `npm test` path.

**Verify:**
- [ ] `node --test tests/package-boundaries.test.mjs`

**Commit:** `test: define modular runtime boundaries`

---

# Phase 1 — Private workspace packages and pure cores

## Phase 1 exit condition

The repository builds exactly as before, but shared contracts and pure workflow/delegation/parser logic live in private workspace packages. No desktop behavior, database schema, or update behavior changes.

### Task 1.1: Add npm workspace build plumbing

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `tsconfig.packages.json`
- Create: shared package tsconfig if useful, e.g. `tsconfig.package-base.json`
- Modify: `scripts/dev-electron.mjs`
- Modify: `.gitignore`

- [ ] Add `workspaces: ["packages/*"]`.
- [ ] Use TypeScript project references or an explicit deterministic package build order.
- [ ] Compile every package to its own `dist/` with declarations and source maps.
- [ ] Packages use ESM, explicit `exports`, and `.js` relative import specifiers under NodeNext.
- [ ] Add `build:packages`, `typecheck:packages`, and `clean:packages` scripts.
- [ ] Ensure `build:renderer`, `build:electron`, `test`, `dev`, and `dist` never consume stale package output.
- [ ] Keep the root Electron entry at `dist-electron/main.js`.
- [ ] Do not add root TypeScript path aliases that bypass package exports.
- [ ] Validate `npm ci` from a clean checkout on Windows.

**Verify:**
- [ ] `npm ci`
- [ ] `npm run build:packages`
- [ ] `npm run typecheck`
- [ ] `npm run build`

**Commit:** `build: add private workspace package pipeline`

### Task 1.2: Extract `@freebuddy/protocol`

**Files:**
- Create: `packages/protocol/package.json`
- Create: `packages/protocol/tsconfig.json`
- Create: `packages/protocol/src/workflow.ts`
- Create: `packages/protocol/src/delegation.ts`
- Create: `packages/protocol/src/cli.ts`
- Create: `packages/protocol/src/runtime.ts`
- Create: `packages/protocol/src/index.ts` only for deliberately shared primitives
- Modify: `electron/cli/workflowTypes.ts`
- Modify: `electron/cli/workflowTeamTypes.ts`
- Modify: `electron/cli/delegationTeamTypes.ts`
- Modify: `src/services/workflows/types.ts`
- Modify: `src/services/workflowTeams/types.ts`
- Modify: `src/services/delegation/client.ts`
- Modify: `src/types/freebuddy.d.ts`
- Modify: relevant imports and tests

- [ ] Move shared data-only types into feature subpath exports.
- [ ] Include Workflow plan/run/step/team DTOs, Delegation team/run/event/result DTOs, CLI stream items, and Runtime RPC/manifest primitives.
- [ ] Keep i18next helpers such as translated names/titles in `src/`; they import protocol types.
- [ ] Keep behavior helpers/default factories out of protocol unless they are serialization-only constants.
- [ ] Remove duplicate main/renderer declarations rather than re-exporting competing copies.
- [ ] Preserve serialized field names and optionality exactly.
- [ ] Add compile-time and runtime fixture tests for representative serialized objects.
- [ ] Prefer discriminated unions. Add Zod validation only at external trust boundaries; do not rewrite every internal type in this task.

**Verify:**
- [ ] `npm run typecheck`
- [ ] `node --test tests/workflow-validate.test.mjs tests/workflow-teams.test.mjs tests/delegation-protocol.test.mjs tests/stream-content-block.test.mjs`

**Commit:** `refactor: centralize cross-process protocol types`

### Task 1.3: Extract `@freebuddy/workflow-core`

**Files:**
- Create: `packages/workflow-core/package.json`
- Create: `packages/workflow-core/tsconfig.json`
- Move/refactor logic from:
  - `electron/cli/workflowValidate.ts`
  - `electron/cli/workflowScheduler.ts`
  - `electron/cli/workflowTemplates.ts`
  - `electron/cli/workflowTeamValidate.ts`
- Modify: callers and tests

- [ ] Export workflow validation, template construction, scheduler decisions, gate decisions, loop/review helpers, and workflow-team validation.
- [ ] Functions are deterministic and receive all state through parameters.
- [ ] No time, random ID, DB, telemetry, Electron, process, filesystem, or global mutable registry access.
- [ ] Preserve temporary compatibility facades only when needed to keep commits reviewable; remove them before Phase 1 ends.
- [ ] Move existing scheduler/template/validation tests to exercise package exports.

**Verify:**
- [ ] `node --test tests/workflow-scheduler.test.mjs tests/workflow-templates.test.mjs tests/workflow-validate.test.mjs tests/workflow-implement-review-loop.test.mjs`
- [ ] `npm run typecheck`

**Commit:** `refactor: extract pure workflow core`

### Task 1.4: Extract `@freebuddy/delegation-core`

**Files:**
- Create: `packages/delegation-core/package.json`
- Create: `packages/delegation-core/tsconfig.json`
- Move/refactor logic from:
  - `electron/cli/delegation/bus/types.ts`
  - `electron/cli/delegation/bus/stateMachine.ts`
  - `electron/cli/delegation/protocol/text.ts`
  - `electron/cli/delegation/protocol/wakeVerdict.ts`
  - pure portions of `electron/cli/delegation/protocol/guards.ts`
- Modify: callers and tests

- [ ] Export the FSM, task similarity/guard rules, wake-verdict resolution, and canonical prompt/protocol text.
- [ ] Replace dependencies on persisted row implementations with minimal protocol DTOs or structural inputs.
- [ ] Do not move DB-backed concurrency/orchestrator code yet.
- [ ] Preserve exact state transitions and prompt semantics.

**Verify:**
- [ ] `node --test tests/delegation-bus-fsm.test.mjs tests/delegation-guards-dispatch.test.mjs tests/delegation-prompt.test.mjs tests/delegation-protocol.test.mjs tests/delegation-verdict.test.mjs`
- [ ] `npm run typecheck`

**Commit:** `refactor: extract pure delegation core`

### Task 1.5: Extract `@freebuddy/cli-stream`

**Files:**
- Create: `packages/cli-stream/package.json`
- Create: `packages/cli-stream/tsconfig.json`
- Move/refactor:
  - `src/services/cli/streamParser.ts`
  - `src/services/cli/parsers/codex.ts`
  - `src/services/cli/parsers/claude.ts`
  - `src/services/cli/parsers/opencode.ts`
- Modify: renderer callers and parser tests

- [ ] Move `CLIStreamMode` or an equivalent transport-neutral union into `@freebuddy/protocol/cli`.
- [ ] Parser inputs are strings plus explicit parse context; outputs are protocol events.
- [ ] Remove the dependency on `@/config/cliAdapters`.
- [ ] No parser directly mutates Zustand/React state.
- [ ] Make parser registration deterministic and safe across repeated test imports.

**Verify:**
- [ ] `node --test tests/stream-content-block.test.mjs tests/stream-media.test.mjs tests/concurrent-stream-stability.test.mjs`
- [ ] `npm run typecheck`

**Commit:** `refactor: extract cli stream normalization`

### Task 1.6: Package and application compatibility verification

**Files:**
- Modify: `electron-builder.yml` only if workspace package output is not automatically included
- Create/modify: packaged smoke test as needed

- [ ] Run a clean install and build with package `dist/` directories removed first.
- [ ] Confirm Vite resolves workspace exports.
- [ ] Confirm Electron NodeNext output resolves workspace exports.
- [ ] Confirm electron-builder packages all required workspace runtime files.
- [ ] Confirm no source-only package path leaks into the packaged app.
- [ ] Confirm `dist-electron/main.js` starts without ESM named-export or cycle errors.

**Verify:**
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] Platform-appropriate unpacked Electron smoke test

**Commit:** `build: verify workspace packages in desktop bundle`

---

# Phase 2 — Injectable runtimes and Host adapters

## Phase 2 exit condition

Workflow and delegation runtimes can execute end-to-end tests using in-memory repositories and fake Agent executors. They do not import Electron, SQLite, concrete CLI processes, or UI messaging. Electron is a composition/transport layer.

### Task 2.1: Define runtime ports

**Files:**
- Create: `packages/agent-runtime/`
- Create: `packages/workflow-runtime/src/ports.ts`
- Create: `packages/delegation-runtime/src/ports.ts`
- Add protocol DTOs only where values cross process boundaries

- [ ] Define `AgentExecutor` with run/resume/yield/kill/capability methods and streaming event semantics.
- [ ] Define Workflow run/step repositories, Conversation repository needs, Skill resolver, event publisher, telemetry, clock, and ID generator ports.
- [ ] Define Delegation run/event repository, approval, event publisher, skill resolver, clock, and Agent execution ports.
- [ ] Define cancellation using `AbortSignal` or an explicit portable cancellation abstraction.
- [ ] Separate persisted DTOs from database-specific row objects.
- [ ] Keep ports narrow; do not expose `Database`, `WebContents`, or generic service locators.

**Verify:**
- [ ] Type-only package tests compile.
- [ ] Boundary test rejects a fixture that imports Electron into a runtime package.

**Commit:** `refactor: define runtime host ports`

### Task 2.2: Add legacy Host adapters before moving orchestration

**Files:**
- Create: adapters under `electron/runtime/adapters/`
- Modify: existing `electron/cli/runtime.ts`, `acpRuntime.ts`, stores, event helpers only as needed

- [ ] Implement `LegacyAgentExecutor` by wrapping the existing CLI/ACP runtime.
- [ ] Implement Electron event publishers by wrapping `safeSendToWebContents`/event bus behavior.
- [ ] Implement skill and telemetry ports using existing services.
- [ ] Preserve session IDs, cancellation, streaming, and error semantics.
- [ ] Do not rewrite Codex/Claude/OpenCode execution in the same task.

**Verify:**
- [ ] Existing ACP/runtime contract tests.
- [ ] New adapter contract tests against fake runtime inputs.

**Commit:** `refactor: adapt existing host services to runtime ports`

### Task 2.3: Extract `@freebuddy/storage-sqlite`

**Files:**
- Create: `packages/storage-sqlite/`
- Refactor relevant SQL from:
  - `electron/cli/workflows.ts`
  - `electron/cli/workflowTeams.ts`
  - `electron/cli/delegationRuns.ts`
  - `electron/cli/delegationTeams.ts`
  - narrowly required conversation access
- Keep DB bootstrap/migration ownership in Host

- [ ] Implement repository ports with the existing shared DB connection.
- [ ] Move only Workflow/Delegation repository SQL in this phase; do not split every table.
- [ ] Preserve transactions, ownership filtering, run-kind isolation, and recovery behavior.
- [ ] Add repository contract suites that run against both in-memory fakes and SQLite implementations where applicable.
- [ ] Never let runtime packages import `better-sqlite3`.

**Verify:**
- [ ] `npm run test:handoff-db`
- [ ] `node --test tests/workflow-teams-db.test.mjs tests/workflow-run-kind-isolation.test.mjs tests/delegation-teams-db.test.mjs`

**Commit:** `refactor: isolate workflow and delegation sqlite repositories`

### Task 2.4: Extract `@freebuddy/workflow-runtime`

**Files:**
- Create: `packages/workflow-runtime/`
- Refactor from:
  - `electron/cli/workflowRuntime.ts`
  - pure application portions of `workflowTeamAdapter.ts`
- Modify: Electron composition and IPC callers

- [ ] Replace direct imports of `WebContents`, SQL helpers, `cliRun`, skills, telemetry, conversations, and `ipcSend` with ports.
- [ ] Delegate decisions to `workflow-core`; runtime owns sequencing and side-effect coordination only.
- [ ] Preserve pause/resume/stop/retry/gate/review-loop behavior.
- [ ] Add an in-memory end-to-end workflow runtime test with a fake streaming Agent.
- [ ] Test crash/retry, cancellation, approval, and concurrent read/one-write behavior.

**Verify:**
- [ ] `node --test tests/workflow-runtime-contract.test.mjs tests/workflow-scheduler.test.mjs tests/workflow-implement-review-loop.test.mjs tests/workflow-ipc-wiring.test.mjs`
- [ ] `npm run typecheck`

**Commit:** `refactor: extract injectable workflow runtime`

### Task 2.5: Extract `@freebuddy/delegation-runtime`

**Files:**
- Create: `packages/delegation-runtime/`
- Refactor from:
  - `electron/cli/delegationRuntime.ts`
  - `electron/cli/delegationDispatch.ts`
  - `electron/cli/delegation/bus/orchestrator.ts`
  - `electron/cli/delegation/bus/concurrency.ts`
  - application portions of `delegationRunner.ts`
- Modify: Electron composition and IPC callers

- [ ] Inject repositories, Agent executor, event publisher, approval, clock, and skills.
- [ ] Make the orchestrator depend on repository interfaces rather than `delegationRuns.ts`.
- [ ] Preserve durable acceptance receipts, pause-aware timeout budgets, follow-up wake, verdict bubbling, depth limits, concurrency limits, and cancellation.
- [ ] Ensure runtime shutdown can quiesce or report active sessions to the Host.
- [ ] Add in-memory end-to-end delegation tests including nested delegation and crash recovery.

**Verify:**
- [ ] Run all `tests/delegation-*.test.mjs` after building packages/electron.
- [ ] `npm run typecheck`

**Commit:** `refactor: extract injectable delegation runtime`

### Task 2.6: Thin Electron composition and IPC layers

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/cli/workflowIpc.ts`
- Modify: `electron/cli/delegationIpc.ts`
- Modify: `electron/cli/delegationTeamIpc.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/freebuddy.d.ts`
- Modify: renderer clients

- [ ] Create runtimes in one Host composition root and inject concrete adapters.
- [ ] IPC handlers validate request DTOs, call a runtime service, and serialize responses; they contain no business decisions or SQL.
- [ ] Preload remains a narrow transport bridge.
- [ ] Renderer uses protocol types and typed clients.
- [ ] Preserve all existing IPC channels for compatibility.

**Verify:**
- [ ] `node --test tests/workflow-ipc-wiring.test.mjs tests/electron-startup-graph.test.mjs tests/ipc-send.test.mjs`
- [ ] `npm test`

**Commit:** `refactor: make electron a runtime composition host`

### Task 2.7: Phase 2 dependency and behavior audit

- [ ] `rg -n 'from\s+["'']electron["'']|better-sqlite3|getDb\(|WebContents|ipcSend' packages/workflow-runtime packages/delegation-runtime` returns no production imports.
- [ ] Runtime integration tests run without starting Electron.
- [ ] Existing DB rows and JSON fields remain compatible.
- [ ] Existing unfinished-run recovery semantics remain covered.
- [ ] `npm run typecheck`, `npm test`, and `npm run build` pass.

**Commit:** `test: lock runtime dependency inversion`

---

# Phase 3 — Signed independently updatable Runtime Pack

## Phase 3 exit condition

A packaged FreeBuddy Desktop Host can download a compatible first-party Runtime Pack, verify it, probe it in an isolated utility process, atomically activate it for new runs, route pinned runs to their original Runtime version, and automatically roll back after a failed activation or crash loop. The same Runtime Pack and shared Runtime Manager pass a Node CLI Host conformance harness without Electron imports. No Electron installer update is required for compatible Runtime-only changes, and a future `freebuddy-cli` can reuse the architecture directly.

### Task 3.1: Define Runtime RPC and capability negotiation

**Files:**
- Extend: `packages/protocol/src/runtime.ts`
- Create: `packages/runtime-entry/src/rpc/`
- Create: `packages/runtime-host/package.json`
- Create: `packages/runtime-host/tsconfig.json`
- Create: `packages/runtime-host/src/ports.ts`
- Create: `packages/runtime-host/src/rpc/`
- Create: `electron/runtime/runtimeRpcHost.ts` only for Desktop Host capability bindings
- Create: `tests/runtime-rpc.test.mjs`

- [ ] Define framed bidirectional request/response/event messages with unique IDs.
- [ ] Define a transport-neutral `RuntimeMessageTransport`; RPC logic must not depend on Electron message ports, Node child-process IPC, or stdio directly.
- [ ] Define the stable `RuntimeProcessLauncher` and initial `RuntimeHostEnvironment` construction ports before implementing either Desktop or Node launchers.
- [ ] Validate all messages at both boundaries.
- [ ] Add request timeout, cancellation, structured errors, and streaming Agent event support.
- [ ] Define `runtime.hello`, `runtime.ready`, `runtime.health`, `runtime.shutdown`, Workflow, Delegation, and Host capability methods.
- [ ] Handshake includes Runtime version, RPC version, Runtime Node version, required Host API range, required/provided capabilities, bundle ID, informational `hostId`, and Host product version.
- [ ] Runtime-side repository, Agent executor, skill, event, and telemetry port adapters call typed Host API RPC methods; they never open SQLite or invoke Electron directly.
- [ ] Side-effecting Host API calls carry stable idempotency keys and attempt identifiers so a Runtime crash/retry cannot duplicate an Agent turn or committed transition.
- [ ] Reject unknown required methods/capabilities and incompatible versions before serving work.
- [ ] Redact secrets from RPC logs.

**Verify:**
- [ ] RPC loopback tests cover success, timeout, cancellation, malformed messages, unknown optional fields, and incompatible handshake.

**Commit:** `feat: define versioned runtime rpc`

### Task 3.2: Build `@freebuddy/runtime-entry` and deterministic Runtime Pack

**Files:**
- Create: `packages/runtime-entry/`
- Create: `scripts/build-runtime-pack.mjs`
- Create: `scripts/verify-runtime-pack.mjs`
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] Compose workflow/delegation/agent runtime implementations behind RPC handlers.
- [ ] Build one self-contained Node ESM bundle with no native dependencies and no runtime package-manager lookup.
- [ ] Runtime bootstrap supports both Electron utility-process transport and Node child-process transport through small adapters without importing Electron.
- [ ] Target and test one documented Node engine baseline shared by Desktop utility processes and the future CLI; do not rely on Electron-only globals.
- [ ] Declare the bundler as a direct dev dependency; do not rely on a transitive binary.
- [ ] Produce deterministic file ordering and normalized timestamps where practical.
- [ ] Generate `manifest.json`, `checksums.json`, `LICENSES.txt`, and an unsigned archive in `.build/runtime-pack/`.
- [ ] Add `runtime:build`, `runtime:verify`, and local `runtime:probe` scripts.
- [ ] Fail the build if native `.node` files, install scripts, Electron imports, or forbidden Host modules enter the bundle.

**Verify:**
- [ ] Build the same source twice and confirm identical content hashes, excluding an explicitly documented nondeterministic signature envelope if necessary.
- [ ] Load/probe an unsigned local development bundle only when the Host injects an explicit development policy; shared packages must not read `app.isPackaged`.

**Commit:** `build: produce deterministic runtime pack`

### Task 3.3: Ship a bundled fallback Runtime

**Files:**
- Modify: `electron-builder.yml`
- Modify: application build scripts
- Create: `electron/runtime/bundledRuntime.ts`
- Create: packaged resource test

- [ ] Build a baseline Runtime Pack during desktop builds.
- [ ] Include it under `resources/runtime-bundled/` using `extraResources`.
- [ ] Host can resolve and probe the bundled Runtime in dev, unpacked, and packaged modes.
- [ ] Bundled Runtime is immutable and always available as the final fallback.
- [ ] Desktop build fails if the bundled Runtime is missing or incompatible with the declared Host API.

**Verify:**
- [ ] Packaged smoke test launches the bundled Runtime.

**Commit:** `feat: embed fallback runtime in desktop builds`

### Task 3.4: Implement Runtime state and safe filesystem layout

**Files:**
- Create: `packages/runtime-host/src/runtimeStateStore.ts`
- Create: `packages/runtime-host/src/runtimeInstaller.ts`
- Create: `packages/runtime-host/src/runtimePaths.ts`
- Create: `tests/runtime-state-store.test.mjs`
- Create: `tests/runtime-installer.test.mjs`

- [ ] Define `RuntimeHostEnvironment`/ports for `hostId`, Host version/API/capabilities, data directory, bundled Runtime location, development policy, launcher, HTTP client, trusted keys, clock, and update configuration.
- [ ] Store state under the injected `<dataDir>/runtimes`, never inside `app.asar` or an install directory. Desktop passes `app.getPath("userData")`; a future CLI passes its own platform-appropriate data directory.
- [ ] Define schema-versioned `active`, `pending`, `lastKnownGood`, blocked versions, crash counters, and update timestamps.
- [ ] Write state atomically using same-directory temp file, fsync where supported, and rename.
- [ ] Use version directories and never overwrite an installed version.
- [ ] Implement an exclusive update/install lock with stale-lock recovery.
- [ ] Defend archive extraction against absolute paths, `..`, symlink escapes, duplicate entries, zip bombs, excessive file count, and size limits.
- [ ] Apply restrictive user-only permissions where supported and revalidate installed manifests/signatures/file hashes before every process launch.
- [ ] Cleanup never removes bundled Runtime, active/pending/last-known-good versions, or versions referenced by nonterminal runs.

**Verify:**
- [ ] Tests cover interrupted writes, corrupt state, concurrent install, malicious archives, and Windows path behavior.

**Commit:** `feat: add atomic runtime installation state`

### Task 3.5: Add signing and verification

**Files:**
- Create: `packages/runtime-host/src/runtimeVerifier.ts`
- Create: `scripts/sign-runtime-pack.mjs`
- Create: `tests/runtime-signature.test.mjs`
- Create: test-only signing keys under `tests/fixtures/`; never commit a production private key

- [ ] Use Ed25519 detached signatures via `node:crypto`.
- [ ] Sign exact inner manifest bytes. Separately sign the channel descriptor that binds archive SHA-256/size, bundle ID, version, API constraints, and immutable artifact URL; do not create a circular archive self-hash inside the archive.
- [ ] Support a `keyId` and an embedded allowlist of trusted public keys for rotation.
- [ ] Verification order: parse/size limit, trusted key, signature, bundle identity, compatibility, archive hash, contained file hashes.
- [ ] HTTPS remains required, but TLS is not treated as a substitute for signatures.
- [ ] Production signing requires CI secret/KMS material and fails closed when absent.
- [ ] Logs never print keys, signatures unnecessarily, credentials, or download authorization headers.

**Verify:**
- [ ] Test valid signature, modified manifest, modified archive, unknown key, wrong bundle ID, expired/revoked version, and key rotation overlap.

**Commit:** `feat: verify signed runtime artifacts`

### Task 3.6: Implement manifest checks and resilient downloading

**Files:**
- Create: `packages/runtime-host/src/runtimeManifest.ts`
- Create: `packages/runtime-host/src/runtimeDownloader.ts`
- Create: `packages/runtime-host/src/runtimeUpdateService.ts`
- Create: Desktop HTTP/config adapter under `electron/runtime/`; a future CLI can provide an equivalent Node adapter
- Create: `tests/runtime-updater.test.mjs`

- [ ] Read update base URL/channel from injected Host configuration with a safe disabled default for unsigned development builds.
- [ ] Do not share the desktop updater's mutable state or release metadata.
- [ ] Use a Runtime-specific endpoint/repository so Runtime releases cannot become the desktop updater's GitHub “latest” release.
- [ ] Support `stable`, `beta`, and development channels; default packaged builds to `stable`.
- [ ] Use ETag/If-None-Match, bounded timeouts, redirect limits, download size limits, `.partial` files, and resumable or restart-safe downloads.
- [ ] Verify the signed channel descriptor before trusting artifact URLs or rollout directives.
- [ ] Apply deterministic staged rollout using a locally generated anonymous cohort ID; do not transmit a stable identifier unless telemetry consent permits it.
- [ ] Support a signed kill switch/revocation list.
- [ ] Schedule checks after startup and periodically with jitter; network failure must not affect current Runtime operation.

**Verify:**
- [ ] Local HTTP fixture tests cover ETag, interruption, redirect rejection, oversized responses, invalid signatures, rollout exclusion, revocation, and offline startup.

**Commit:** `feat: download compatible runtime updates`

### Task 3.7: Add the Electron Runtime Host adapter

**Files:**
- Create: `electron/runtime/electronRuntimeEnvironment.ts`
- Create: `electron/runtime/electronRuntimeProcessLauncher.ts`
- Create: stable packaged bootstrap module if required
- Create: `tests/runtime-process-host.test.mjs`

- [ ] Implement the shared `RuntimeProcessLauncher` port with Electron `utilityProcess` for crash isolation and supported packaged execution.
- [ ] Treat utility-process isolation as crash containment, not a security sandbox.
- [ ] Pass only required environment/configuration; strip secrets and inherited debug flags by default.
- [ ] Establish handshake timeout, heartbeat, graceful shutdown, forced termination fallback, and exit diagnostics.
- [ ] Host retains all privileged operations and serves them through validated Host API RPC handlers.
- [ ] Probe newly installed Runtime versions before activation using a separate process instance.
- [ ] Ensure process cleanup on app quit and desktop updater `quitAndInstall`.

**Verify:**
- [ ] Tests cover ready handshake, malformed handshake, timeout, crash, graceful shutdown, forced kill, and packaged path handling.

**Commit:** `feat: host runtime in isolated utility process`

### Task 3.8: Prove Node CLI Host compatibility

**Files:**
- Create: `packages/runtime-host/src/node/nodeRuntimeProcessLauncher.ts`
- Create: `tests/fixtures/runtime-cli-host.mjs`
- Create: `tests/runtime-cli-host-conformance.test.mjs`
- Extend: `docs/runtime-pack-architecture.md`

- [ ] Implement a Node `child_process` launcher behind the same `RuntimeProcessLauncher` port; do not import Electron or depend on `process.parentPort` being present.
- [ ] Compose `createRuntimeManager` with `hostId: "freebuddy-cli"`, a temporary data directory, Node launcher, test keyring, and Host capability adapters.
- [ ] Launch and probe the exact same Runtime Pack fixture used by the Electron Host tests.
- [ ] Execute at least one Workflow request and one Delegation/core health request through the shared RPC protocol.
- [ ] Run the shared Host conformance suite against both Electron/fake Desktop and Node CLI environments.
- [ ] Export a documented, stable construction surface from `@freebuddy/runtime-host` so the future CLI does not deep-import internals.
- [ ] Do not build CLI command parsing, terminal UX, installation, or public distribution in this task.

**Verify:**
- [ ] `node --test tests/runtime-cli-host-conformance.test.mjs`
- [ ] Boundary tests confirm the Runtime Pack and `runtime-host` have no Electron imports.

**Commit:** `test: prove runtime pack works with node cli host`

### Task 3.9: Pin runs and route Runtime versions side-by-side

**Files:**
- Modify: Host-owned DB migration in `electron/cli/db.ts` or its migrated Host location
- Modify: Workflow/Delegation repository DTOs and protocol
- Create: `packages/runtime-host/src/runtimeVersionRouter.ts`
- Create: `tests/runtime-version-routing.test.mjs`
- Modify: DB tests

- [ ] Add nullable `runtime_version` and `runtime_api_version` to Workflow and Delegation run records through a Host migration.
- [ ] On run creation, persist the active Runtime version transactionally.
- [ ] Existing rows without a version use a documented legacy/bundled compatibility rule.
- [ ] New runs route to the active version; resumed/persisted runs route to their pinned version.
- [ ] Maintain a process pool keyed by Runtime version where side-by-side execution is required.
- [ ] Do not remove a Runtime version referenced by a nonterminal or resumable run.
- [ ] Define behavior when a pinned version is corrupt/revoked: pause the run, explain recovery, and require an explicit compatible migration path rather than silently changing semantics.

**Verify:**
- [ ] DB migration and owner-isolation tests pass.
- [ ] A run created on version A continues on A after version B activates; new runs use B.

**Commit:** `feat: pin persisted runs to runtime versions`

### Task 3.10: Activation, health monitoring, and rollback

**Files:**
- Create: `packages/runtime-host/src/runtimeManager.ts`
- Create: `packages/runtime-host/src/runtimeHealthMonitor.ts`
- Create: `tests/runtime-activation.test.mjs`
- Create: `tests/runtime-rollback.test.mjs`

- [ ] Activation changes the default version for new runs without terminating processes serving pinned active runs.
- [ ] Probe before activation and perform a post-activation health check.
- [ ] Mark `lastKnownGood` only after a configured healthy window and successful representative RPC calls.
- [ ] Detect startup failure, handshake failure, heartbeat loss, repeated RPC failure, and crash loops.
- [ ] Recover from durable checkpoints and idempotent Host operations so rollback/restart cannot duplicate Agent execution or state transitions.
- [ ] Automatically restore the last-known-good version and block the bad version locally.
- [ ] Fall back in order: active downloaded, last-known-good downloaded, bundled Runtime.
- [ ] Never retry a locally blocked version until a newer signed channel descriptor explicitly supersedes it or the user clears the block.
- [ ] Preserve enough diagnostics for support without storing prompts, credentials, or sensitive tool payloads.

**Verify:**
- [ ] Tests cover failed probe, immediate crash, delayed crash loop, corrupt active state, missing files, rollback, and bundled fallback.

**Commit:** `feat: activate and roll back runtime versions safely`

### Task 3.11: Integrate Runtime status and controls into Electron/UI

**Files:**
- Create: `electron/runtime/runtimeIpc.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/freebuddy.d.ts`
- Modify/create: settings store/UI components and locale files
- Modify: desktop updater shutdown hook

- [ ] Add typed IPC for status, check, download/prepare, activate, rollback, channel selection, and diagnostics.
- [ ] Auto-check starts only after the initial Runtime is healthy and app startup is settled.
- [ ] Default behavior: auto-download, verify, probe, and activate for new work; never interrupt running work.
- [ ] Show Desktop version separately from Runtime version.
- [ ] Show active/pending/last-known-good state and a concise rollback error.
- [ ] Keep advanced manual rollback/channel controls out of the primary workflow.
- [ ] Desktop `quitAndInstall` gracefully stops all Runtime processes before replacing the app.

**Verify:**
- [ ] Extend updater lifecycle tests.
- [ ] Add runtime settings/status UI tests.
- [ ] Manual smoke: active tasks survive a new default Runtime activation through version pinning.

**Commit:** `feat: expose independent runtime updates`

### Task 3.12: Add Runtime release CI

**Files:**
- Create: `.github/workflows/runtime-release.yml`
- Create/modify: Runtime release scripts
- Create: `docs/runtime-release.md`
- Modify: `AGENTS.md` only if repository publishing instructions need a Runtime-specific preflight

- [ ] Trigger on tags that cannot match the desktop `v*` workflow, e.g. `runtime-v*`.
- [ ] Run package typecheck, full relevant tests, deterministic build, forbidden-import/native-dependency scan, signature verification, and probe tests.
- [ ] Run the Node CLI Host conformance suite on the minimum supported Node engine before signing/publishing.
- [ ] Sign with protected CI secret/KMS material; never echo or persist the private key.
- [ ] Publish immutable versioned artifacts plus detached signatures.
- [ ] Publish/update a separately signed channel descriptor only after artifact upload and verification.
- [ ] Runtime releases must not be marked as the desktop repository's latest release; prefer a dedicated artifact repository or update origin.
- [ ] Add promotion from beta to stable without rebuilding the artifact.
- [ ] Add a signed revocation/kill-switch procedure and a key-rotation runbook.
- [ ] Before pushing or creating/updating a PR, follow `AGENTS.md` and run `npm run github:preflight`; rerun with system permissions if sandboxed access fails.

**Verify:**
- [ ] Workflow lint/dry run where supported.
- [ ] Test-key end-to-end release in a non-production channel.
- [ ] Production verification downloads the published artifact and verifies it from scratch.

**Commit:** `ci: publish signed runtime packs`

### Task 3.13: Full upgrade, recovery, CLI conformance, and packaging matrix

**Files:**
- Add integration fixtures/tests and update operational docs

- [ ] Test Windows x64, macOS arm64/x64, and Linux x64 Host packaging paths.
- [ ] Test clean install with only bundled Runtime.
- [ ] Test offline launch after previously downloading a Runtime.
- [ ] Test update A → B, activation, restart, and rollback B → A.
- [ ] Test desktop update while an external Runtime is active.
- [ ] Test old Host rejecting a new incompatible Runtime.
- [ ] Test new Host continuing to run an older pinned Runtime.
- [ ] Test interrupted download/install and corrupt state recovery.
- [ ] Test concurrent Runtime update checks and multiple app-instance handling.
- [ ] Test revocation of active and inactive versions.
- [ ] Test pinned paused/resumable runs during Runtime cleanup.
- [ ] Run Node CLI Host conformance against every release candidate Runtime artifact.
- [ ] Test Desktop and Node CLI Hosts rejecting the same incompatible Runtime and accepting the same compatible Runtime.
- [ ] Measure startup, update, disk, and process overhead; document accepted limits.
- [ ] Perform a security review of signature verification, archive extraction, URL handling, RPC validation, and privileged Host APIs.

**Final verify:**
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run dist:win` on Windows
- [ ] Platform CI builds for macOS and Linux
- [ ] Runtime Pack release dry run with test keys
- [ ] Manual packaged-app Runtime update and rollback
- [ ] Node CLI Host conformance using the published Runtime Pack fixture

**Commit:** `test: verify runtime update lifecycle end to end`

---

## 5. Runtime artifact contract

Initial archive layout:

```text
freebuddy-runtime-1.0.0.zip
├─ manifest.json
├─ manifest.sig
├─ checksums.json
├─ runtime/
│  └─ index.mjs
└─ LICENSES.txt
```

Required manifest fields:

```json
{
  "schemaVersion": 1,
  "bundleId": "dev.freebuddy.runtime",
  "version": "1.0.0",
  "rpcVersion": 1,
  "engine": { "node": ">=22.0.0" },
  "hostApi": ">=1.0.0 <2.0.0",
  "entry": "runtime/index.mjs",
  "keyId": "runtime-prod-2026-01",
  "publishedAt": "2026-08-26T00:00:00.000Z",
  "providesCapabilities": ["workflow", "delegation", "cli-stream"],
  "requiresHostCapabilities": [
    "agent.execute.v1",
    "workflow.repository.v1",
    "delegation.repository.v1",
    "events.publish.v1"
  ]
}
```

Do not sign an ambiguous re-serialized object. Define whether the detached signature covers the exact UTF-8 manifest bytes or a rigorously specified canonical representation, and test it across platforms. Prefer exact immutable bytes plus a separately signed channel descriptor binding the archive URL, byte size, and digest. The inner manifest cannot contain the hash of the archive that contains it. Compatibility should normally be decided by `hostApi` and `requiresHostCapabilities`; signed channel metadata may add optional per-product version constraints only for a known Host defect or rollout requirement.

---

## 6. Runtime state contract

Example `runtime-state.json`:

```json
{
  "schemaVersion": 1,
  "activeVersion": "1.1.0",
  "pendingVersion": null,
  "lastKnownGoodVersion": "1.0.3",
  "channel": "stable",
  "lastCheckedAt": "2026-08-26T10:00:00.000Z",
  "blockedVersions": {
    "1.0.4": {
      "reason": "crash-loop",
      "failedAt": "2026-08-26T09:00:00.000Z"
    }
  }
}
```

The state file is Host-owned. Runtime code may read its own version through handshake configuration but may not edit update state.

---

## 7. Host API design checklist

The Host API should expose capabilities, not raw privileged objects:

- [ ] Workflow/Delegation repository operations scoped by caller/run ownership.
- [ ] Agent execution with explicit cwd, workspace roots, capabilities, cancellation, and bounded streaming.
- [ ] Skill resolution returning immutable snapshots.
- [ ] Event publishing through typed events.
- [ ] Clock/ID generation where determinism or auditability matters.
- [ ] Telemetry with allowlisted event names/fields.
- [ ] No raw SQLite handle.
- [ ] No raw Electron `WebContents`, `BrowserWindow`, `ipcMain`, or `shell` object.
- [ ] No unrestricted credential/environment dump.
- [ ] No unrestricted filesystem or process execution beyond existing validated Agent/tool capabilities.
- [ ] All RPC requests carry correlation IDs and bounded payload sizes.
- [ ] Side-effecting operations require idempotency keys and persist enough outcome data to answer safe retries.

---

## 7.1 Shared Runtime Host construction contract

`@freebuddy/runtime-host` must expose a product-neutral construction surface similar to:

```ts
export interface RuntimeHostEnvironment {
  hostId: "freebuddy-desktop" | "freebuddy-cli" | (string & {});
  hostVersion: string;
  hostApiVersion: string;
  hostCapabilities: readonly string[];
  dataDir: string;
  bundledRuntimePath?: string;
  allowUnsignedDevelopmentRuntime: boolean;
  launcher: RuntimeProcessLauncher;
  http: RuntimeHttpClient;
  trustedKeys: RuntimeTrustedKeyStore;
  clock: RuntimeClock;
}

export function createRuntimeManager(
  environment: RuntimeHostEnvironment,
  hostApi: RuntimeHostApi
): RuntimeManager;
```

Desktop composition:

```ts
createRuntimeManager(
  {
    hostId: "freebuddy-desktop",
    hostVersion: APP_VERSION,
    hostApiVersion: HOST_API_VERSION,
    hostCapabilities: desktopCapabilities,
    dataDir: app.getPath("userData"),
    bundledRuntimePath,
    allowUnsignedDevelopmentRuntime: !app.isPackaged,
    launcher: createElectronRuntimeProcessLauncher(),
    http: desktopRuntimeHttpClient,
    trustedKeys,
    clock: systemClock
  },
  desktopHostApi
);
```

Future standalone CLI composition:

```ts
createRuntimeManager(
  {
    hostId: "freebuddy-cli",
    hostVersion: CLI_VERSION,
    hostApiVersion: HOST_API_VERSION,
    hostCapabilities: cliCapabilities,
    dataDir: resolveCliDataDir(),
    bundledRuntimePath,
    allowUnsignedDevelopmentRuntime: isCliDevelopmentMode,
    launcher: createNodeRuntimeProcessLauncher(),
    http: nodeRuntimeHttpClient,
    trustedKeys,
    clock: systemClock
  },
  cliHostApi
);
```

The future CLI may operate in two modes:

- **Standalone:** loads the same Runtime Pack and uses its own Host adapters and default data directory. It may reuse `@freebuddy/storage-sqlite`, but must not default to opening the Desktop application's live database file.
- **Desktop controller:** connects to a running Desktop Host over an authenticated local transport and does not load a second Runtime or directly open the Desktop database.

Sharing one SQLite file concurrently between independent Desktop and CLI Hosts is not part of this plan. Use separate stores for standalone mode or route commands through the Desktop Host for shared tasks.

The Runtime Pack artifact itself is identical for both products. If `freebuddy-cli` later lives in this monorepo, it consumes the private workspace Host packages directly. If it lives in another repository, `runtime-host` may later be published or vendored as a separate SDK without changing the Runtime Pack or RPC contract.

---

## 8. Rollout strategy

1. Land Phase 1 with no user-visible changes.
2. Land Phase 2 still using in-process Host adapters; keep behavior identical.
3. Add utility-process execution behind a disabled feature flag.
4. Dogfood the bundled Runtime and run the Node CLI Host conformance harness against the same artifact.
5. Enable signed remote update checks on the beta channel.
6. Enable automatic preparation but manual activation.
7. Enable automatic activation for new runs after rollback telemetry is healthy.
8. Promote to stable with staged rollout: internal → 5% → 25% → 100%.
9. Keep the ability to disable remote Runtime updates through a signed channel directive and a Host-side emergency configuration.

At every rollout stage, the bundled Runtime fallback must remain functional.

---

## 9. Explicitly out of scope

- Public npm package publishing.
- Third-party plugin marketplace.
- Loading unsigned local plugins in packaged production builds.
- Runtime-controlled database migrations.
- Dynamic Electron preload/UI replacement.
- Updating native addons outside the desktop installer.
- Removing the existing desktop updater.
- Building the actual `freebuddy-cli` command tree, terminal UX, installer, or release pipeline; only its reusable Host foundation and conformance harness are included.
- Refactoring unrelated Browser, games, remote access, telemetry, or ButlerBuddy features merely because they are large.

---

## 10. Definition of done

The project is complete only when all statements are true:

- [ ] Core packages have enforced dependency boundaries and independent tests.
- [ ] Workflow and Delegation runtimes run without Electron or SQLite imports.
- [ ] Existing desktop functionality and stored data remain compatible.
- [ ] A signed Runtime-only change can be published independently.
- [ ] A packaged Host discovers, downloads, verifies, probes, and activates it.
- [ ] Active/persisted runs remain pinned to the Runtime version that created them.
- [ ] A bad Runtime automatically rolls back without reinstalling FreeBuddy.
- [ ] Offline startup works with downloaded, last-known-good, or bundled fallback Runtime.
- [ ] Incompatible Runtime versions are rejected before execution.
- [ ] Runtime code cannot perform database migrations or receive raw Electron/SQLite objects.
- [ ] Desktop and Runtime release channels cannot interfere with each other.
- [ ] `@freebuddy/runtime-host` has no Electron dependency and exposes a stable public construction API.
- [ ] The same Runtime Pack passes both Desktop Host and Node CLI Host conformance tests.
- [ ] A future standalone CLI can provide its own data directory/Host adapters, while a Desktop-controller CLI can avoid direct shared-database access.
- [ ] Security, recovery, and platform packaging tests pass.
- [ ] Operational documentation covers release, promotion, revocation, rollback, key rotation, and support diagnostics.
