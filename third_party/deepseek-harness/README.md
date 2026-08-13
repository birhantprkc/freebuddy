# DeepSeek Harness thin fork (FreeBuddy overlay)

FreeBuddy still runs the official ACP leaf (`@deepseek-ai/dsh-acp-demo` +
`examples/acp-agent/cordis.yml`). This directory is the **thin fork patch
set** we apply on top of that install.

Upstream: https://github.com/deepseek-ai/deepseek-harness  
Fork: https://github.com/maojindao55/deepseek-harness  
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

Source-of-truth for the fork / upstream PR:

- `src/session-persistence-jsonl/win32.ts`
- `0001-fix-windows-jsonl-node-fs.patch` (also closes ACP demo SQLite at startup)

## Apply the patch on the fork

This Cloud Agent can read `maojindao55/deepseek-harness` but cannot push to
it (GitHub App is `cursor[bot]`, no write on that repo). Apply locally:

```sh
git clone https://github.com/maojindao55/deepseek-harness.git
cd deepseek-harness
git checkout -b cursor/windows-jsonl-node-fs-255d
git am /path/to/freebuddy/third_party/deepseek-harness/0001-fix-windows-jsonl-node-fs.patch
git push -u origin cursor/windows-jsonl-node-fs-255d
```

Then open a PR from that branch back to `deepseek-ai/deepseek-harness`.

Compare URL after push:

https://github.com/deepseek-ai/deepseek-harness/compare/master...maojindao55:deepseek-harness:cursor/windows-jsonl-node-fs-255d

## How FreeBuddy applies it

`patchDshAcpManagedRuntime()` copies the overlay files over the managed
runtime after npm install and again before every spawn. Packaged builds
ship the overlays as `extraResources` (`dsh-harness-overlays`).

On Windows, spawn also injects `assets/dsh/koffi-guard.mjs` via Node
`--import`. That register hook redirects every `koffi` import to a
fail-closed JavaScript stub so a missed overlay or `dsh-sandbox-windows-acl`
cannot load the native addon.

Debug log export includes `dsh-acp-runtime.json` (JSONL copies, leftover
koffi, cordis safety flags, guard present).
