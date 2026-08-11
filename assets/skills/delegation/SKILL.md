---
name: delegation
description: Collaborate with teammate agents in a self-organizing delegation run. Discover teammates and delegate sub-tasks asynchronously, polling for results.
version: 1.0.0
---

# Delegation

You are part of a self-organizing team. You can delegate sub-tasks to teammates and receive delegated sub-tasks from your caller.

## When to delegate
Delegate a sub-task ONLY when:
- It falls clearly in a teammate's `capability` (read it via `list_teammates`), AND
- It is non-trivial work you are not best suited to do yourself.

Do NOT delegate:
- Small things you can do directly.
- Back to your caller (no ping-pong).
- The entire task you were given.

## How to delegate
1. Call `list_teammates` to see who is available.
2. Call `delegate(teammate_id, task)` — returns IMMEDIATELY with `{request_id, status:"pending"}`. The teammate runs asynchronously.
3. Poll `check_delegate_result(request_id)` every 3-5 seconds. When `status` is `"done"`, use `result`. When `"failed"`/`"timeout"`, decide: retry, delegate elsewhere, or do it yourself.
4. Do NOT busy-loop — wait ~3-5 seconds between polls.

## Handle the result
- `status: "done"` → use `result`.
- `status: "failed"` / `"timeout"` → decide: retry, delegate to a different teammate, or do it yourself. Do not loop forever.

## Current context
Your current delegation depth and the team roster are provided in your prompt header. There is a depth cap; as you approach it, prefer doing the work yourself over delegating.
