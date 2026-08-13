# DeepSeek Harness thin fork (FreeBuddy overlay)

FreeBuddy still runs the official ACP leaf (`@deepseek-ai/dsh-acp-demo` +
`examples/acp-agent/cordis.yml`). This directory is the **thin fork patch
set** we apply on top of that install.

Upstream: https://github.com/deepseek-ai/deepseek-harness  
Pinned published line: `@next` / `0.1.0-rc.6`

## Why

Official JSONL persistence publishes the first session file with a native
Win32 binding. On Windows Electron that aborts the ACP child with
`STATUS_ACCESS_VIOLATION (0xC0000005)` during `session/prompt`.

Regex-editing `node_modules` after install was not reliable. These overlays
replace the installed files wholesale.

## What changed

| Overlay | Change |
|---|---|
| `overlays/dsh-session-persistence-jsonl/lib/index.js` | Windows publish uses Node `rename` / copy / `mkdir`. No native addon load. |
| `overlays/dsh-acp-demo/lib/index.js` | SQLite query engine `openAt: "never"`. |

Intended upstream source for the persistence change lives in
`src/session-persistence-jsonl/win32.ts`. When
`maojindao55/deepseek-harness` exists, copy that file onto
`packages/session/session-persistence-jsonl/src/win32.ts` and open a PR
back to DeepSeek.

## How FreeBuddy applies it

`patchDshAcpManagedRuntime()` copies the overlay files over the managed
runtime after npm install and again before every spawn. Packaged builds
ship the overlays as `extraResources` (`dsh-harness-overlays`).
