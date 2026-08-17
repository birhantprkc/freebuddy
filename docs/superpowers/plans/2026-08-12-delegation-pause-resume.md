# Delegation Pause / Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pause (immediate abort) and resume (from interrupted role) for self-organizing delegation runs.

**Architecture:** `DelegationRuntime.pauseRun` / `resumeRun` separate from `stopRun`; track active ACP `sessionId`s per run for `cliKill`; cancel active DB events; persist resume anchor in memory; UI on `DelegationTeamCard`.

**Tech Stack:** TypeScript Electron main, existing `cliKill`, workflow `paused` status, IPC/preload, React card.

**Spec:** `docs/superpowers/specs/2026-08-12-delegation-pause-resume-design.zh-CN.md`

## Global Constraints

- Pause ≠ kill; resume only from `paused`
- Immediate abort of current turn via `cliKill(sessionId)`
- v1 resume anchor is in-memory; restart falls back to entry follow-up
- `recoverInterruptedDelegationRuns` must not wipe `paused`

---

### Task 1: Runtime pause/resume + session abort

**Files:**
- Modify: `electron/cli/delegationRuntime.ts`
- Modify: `electron/cli/delegationRuns.ts` (helper cancel active events if useful)
- Modify: `electron/cli/delegation/bus/orchestrator.ts` (optional markPaused interrupt)
- Test: `tests/delegation-pause-resume.test.mjs`

- [ ] Failing tests: pause cancels active events + status paused; resume clears paused and records anchor role
- [ ] Implement `pauseRun` / `resumeRun`; track `activeSessionsByRun`; call `cliKill`
- [ ] Keep `stopRun` as killed; pause does not use killedRunIds
- [ ] `recoverInterruptedDelegationRuns` excludes `paused`

### Task 2: IPC + preload + client types

**Files:**
- Modify: `electron/cli/delegationIpc.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/freebuddy.d.ts`
- Modify: `src/services/delegation/client.ts`

- [ ] Register `delegation:pauseRun` / `delegation:resumeRun`
- [ ] Expose on bridge + client

### Task 3: UI on DelegationTeamCard

**Files:**
- Modify: `src/components/Workflows/DelegationTeamCard.tsx`
- Modify: `src/locales/zh-CN.json` / `en.json` if needed

- [ ] Show Pause when running/blocked; Resume when paused; keep conceptual Stop if already elsewhere or add Stop too
- [ ] Badge for paused

### Task 4: Verify

- [ ] `npm run build:electron` + pause-resume tests + existing dispatch smoke
