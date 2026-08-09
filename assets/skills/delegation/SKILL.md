---
name: delegation
description: Collaborate with teammate agents in a self-organizing delegation run. Discover teammates and delegate sub-tasks synchronously.
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
1. Call `list_teammates` to see who is available and their `capability` (excluding yourself).
2. Call `delegate(teammate_id, task)` with a self-contained `task` description. The call blocks until the teammate finishes and returns `{status, result, event_id}`.
3. Use the returned `result` to continue your own work.

## Handle the result
- `status: "done"` → use `result`.
- `status: "failed"` / `"timeout"` → decide: retry, delegate to a different teammate, or do it yourself. Do not loop forever.

## Current context
Your current delegation depth and the team roster are provided in your prompt header. There is a depth cap; as you approach it, prefer doing the work yourself over delegating.
