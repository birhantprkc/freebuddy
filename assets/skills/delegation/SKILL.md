---
name: delegation
description: Collaborate with teammate agents in a self-organizing delegation run. Discover teammates and delegate sub-tasks asynchronously; the system wakes you when results settle.
version: 1.4.0
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
2. For one sub-task, Call `delegate(teammate_id, task)` — returns IMMEDIATELY with a durable acceptance receipt `{request_id, status:"pending"}`. No receipt means the sub-task was not accepted.
3. For multiple independent sub-tasks, Use `delegate_many(delegations)` for independent sub-tasks. Acceptance is atomic: either every item returns a request handle, or none are created.
4. After one or more requests are accepted, call `yield_to_delegates(request_ids)` once. It only yields when at least one owned request is still active; otherwise it returns an error and you must keep working.
5. When yield succeeds, the runtime parks this turn automatically and wakes you with a settled result.

Do not poll `check_delegate_result`. It is only for inspecting a request when recovery or diagnostics require it.

## Handle the result
- `status: "done"` → prefer structured `outcome`; use legacy `result` as a fallback.
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
