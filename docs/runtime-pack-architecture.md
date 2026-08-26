# FreeBuddy Runtime Pack Architecture

FreeBuddy Desktop and a future `freebuddy-cli` are Host implementations around one Host-neutral Runtime. Workflow, delegation, prompt/protocol, parser, and compatible Agent adapter fixes ship as a signed Runtime Pack without a new Electron installer. Electron/preload/UI/native/database-schema changes still use the desktop release path.

This document is the durable contract for the modularization in `docs/superpowers/plans/2026-08-26-runtime-pack-modularization.md`.

Implementation baseline (Task 0.1), recorded before any code movement:

- Source branch: `codex/runtime-pack-modularization`
- Commit: `7335ac69c2f18bd5817bb9bd4cf917088974adb0`
- `git status --short`: clean
- `npm run typecheck`: pass
- `npm test`: 121 pass, 9 skipped, 0 fail
- `npm run build`: pass

## Host versus Runtime

| Concern | Owner |
| --- | --- |
| Database connection, migrations, ownership filtering | Host |
| Native addons (`better-sqlite3`, `node-pty`), credentials, OS integration | Host |
| Filesystem/process execution beyond validated Agent/tool capabilities | Host |
| Presentation (Electron UI or future CLI UX) | Host |
| Desktop updater / CLI installer | Host |
| Pure workflow/delegation/parser decisions | Runtime |
| Workflow and delegation sequencing | Runtime |
| Runtime Pack install, verify, activate, rollback, version routing | `@freebuddy/runtime-host` via injected Host ports |

Runtime code accesses persisted data only through versioned Host APIs. It must not import Electron, open SQLite, or assume a graphical UI.

Desktop Host adapter: Electron `utilityProcess` (crash isolation, not a security sandbox).  
Future CLI Host adapter: Node `child_process`. Both speak the same RPC protocol.

## Version contracts

| Version | Meaning | Initial value |
| --- | --- | --- |
| Product Host version | Desktop or CLI package version | app `package.json` |
| Host API version | Stable capability API | `1.0.0` |
| Runtime version | Runtime Pack SemVer | pack `manifest.json` |
| Runtime RPC version | Wire framing | `1` |
| Runtime state schema | `runtime-state.json` | `1` |
| Runtime manifest schema | Pack manifest | `1` |
| Runtime Node engine | Shared Desktop utility-process / CLI baseline | `>=22.0.0` |

Compatibility is capability- and Host-API-based. `hostId` is informational unless an explicit product constraint is unavoidable.

- Patch/minor Runtime releases may add optional output fields and capabilities.
- They may not remove or change existing Host API methods within the same major Host API version.
- Unknown optional fields/events are ignored.
- Unknown required capabilities reject activation.
- Runtime code may not change the SQLite schema. A Runtime that needs a new migration, Electron capability, preload API, or UI surface must declare a newer Host API/capability requirement and wait for the Host product.

## Trust model

- The client never runs `npm install`, lifecycle scripts, or arbitrary package-manager commands to update Runtime Packs.
- Workspace packages remain `private: true`. Public npm publication is not required for Runtime Pack delivery.
- The initial remote distribution unit is one `freebuddy-runtime` bundle, not independently updated internal packages.
- Signed packs are published to `maojindao55/freebuddy-runtime` (`runtime-v*` tags / GitHub Releases). Desktop installers stay on `maojindao55/freebuddy` (`v*` tags) so Runtime never becomes that repository's Latest release.
- Packs are first-party and must be signed with Ed25519. Third-party/untrusted plugin execution is out of scope.
- HTTPS is required for downloads; TLS is not a substitute for signatures.
- A downloaded Pack must not be imported into the Electron main process.
- Bundles contain no native Node addons and no platform-specific install scripts.
- Unsigned local development bundles are allowed only when the Host injects an explicit development policy. Shared packages never read `app.isPackaged`.

Verification order: parse/size limit → trusted key → signature → bundle identity → compatibility → archive hash → contained file hashes.

The inner manifest is signed as exact bytes. A separately signed channel descriptor binds archive SHA-256/size, bundle ID, version, API constraints, and immutable artifact URL. The inner manifest cannot contain the hash of the archive that contains it.

## Activation semantics

- Activation never interrupts an active task.
- Persisted runs are pinned to the Runtime version that created them; new runs use the active version.
- Always retain a bundled fallback Runtime and at least one last-known-good downloaded Runtime.
- Probe a newly installed version in a separate process before activation.
- Mark `lastKnownGood` only after a healthy window and successful representative RPC calls.
- Fallback order: active downloaded → last-known-good downloaded → bundled Runtime.
- A locally blocked version is not retried until a newer signed channel descriptor supersedes it or the user clears the block.
- Corrupt/revoked pinned versions pause the run and require an explicit compatible migration path.

## Shared construction surface

`@freebuddy/runtime-host` exposes a product-neutral API:

```ts
createRuntimeManager(environment: RuntimeHostEnvironment, hostApi: RuntimeHostApi): RuntimeManager
```

Desktop injects `app.getPath("userData")`, packaged/development policy, and an Electron launcher. A future CLI injects its own data directory and a Node launcher. Shared Runtime management must not call `app.getPath`, `app.isPackaged`, `BrowserWindow`, or Electron updater APIs.

The future CLI may:

- **Standalone:** load the same Runtime Pack with its own Host adapters and data directory. It must not default to opening the Desktop application's live database file.
- **Desktop controller:** connect to a running Desktop Host over an authenticated local transport.

Sharing one SQLite file concurrently between independent Desktop and CLI Hosts is not supported.

## Package dependency rules

```text
protocol
  ↑
workflow-core / delegation-core / cli-stream
  ↑
workflow-runtime / delegation-runtime / agent-runtime
  ↑
runtime-entry                 storage-sqlite (Host-side)
  ↑
runtime-host  ←  Desktop Host / future CLI Host
```

- `protocol`: no FreeBuddy packages, Electron, React, Zustand, i18next, SQLite, filesystem, or process control.
- `workflow-core` / `delegation-core`: pure deterministic logic; `protocol` + stdlib only.
- `cli-stream`: `protocol` only; no UI store mutation.
- Runtime packages: their core, `protocol`, `agent-runtime`; no Electron, SQLite, `ipcSend`, `WebContents`, `BrowserWindow`, or `getDb`.
- `storage-sqlite`: repository SQL only; no Electron or React.
- `runtime-entry`: runtime packages only.
- `runtime-host`: portable Node stdlib + injected ports; no Electron or desktop updater state.
- No package may deep-import another package's `src/` or unexported file.
- No dependency cycles.

Enforced by `tests/package-boundaries.test.mjs`.

## Non-goals

- Public npm package publishing
- Third-party plugin marketplace
- Loading unsigned local plugins in packaged production builds
- Runtime-controlled database migrations
- Dynamic Electron preload/UI replacement
- Updating native addons outside the desktop installer
- Removing the existing desktop updater
- Building the actual `freebuddy-cli` command tree, terminal UX, installer, or release pipeline
- Moving `electron/` and `src/` under `apps/desktop/`
- Refactoring unrelated Browser, games, remote access, telemetry, or ButlerBuddy features
