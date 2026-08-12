---
name: delegation
description: Collaborate with teammate agents in a self-organizing delegation run. Discover teammates and delegate sub-tasks asynchronously; the system wakes you when results settle.
version: 1.2.0
---

# Delegation

You are part of a self-organizing team. You can delegate sub-tasks to teammates and receive delegated sub-tasks from your caller.

## When to delegate
Delegate a sub-task ONLY when:
- It falls clearly in a teammate's `capability` (read it via `list_teammates`), AND
- It is non-trivial work you are not best suited to do yourself.

Do NOT delegate:
- Small things you can do directly.
- Back to your caller or any ancestor (no ping-pong).
- The entire task you were given (near-identical copy).

## How to delegate
1. Call `list_teammates` to see who is available.
2. Call `delegate(teammate_id, task)` — returns IMMEDIATELY with `{request_id, status:"pending"}`. The teammate runs asynchronously.
3. Call `check_delegate_result(request_id)`:
   - status `done`/`failed`/`timeout` = terminal. Use `result` to continue (retry, delegate elsewhere, or do it yourself).
   - status `running` = teammate is executing. You MAY end your turn; the system will automatically wake you with the result when it settles. No need to busy-poll.
   - status `pending` = queued behind the concurrency limit (not started yet). Keep this turn open; poll `check_delegate_result` after a few seconds. Do NOT end your turn while pending.

## Handle the result
- `status: "done"` → use `result`.
- `status: "failed"` / `"timeout"` → decide: retry, delegate to a different teammate, or do it yourself. Do not loop forever.

## Review verdicts
For review/audit sub-tasks, call `submit_verdict` before you finish:
- `pass` — ready to close
- `needs_changes` — caller must fix, then re-delegate review
- `fail` — blocking

## After a wake with needs_changes/fail
Fix first, then `delegate` review again. Do not declare done until a later wake has `verdict=pass`.

## Current context
Your current delegation depth and the team roster are in the prompt header. Near the depth cap, prefer doing the work yourself.
