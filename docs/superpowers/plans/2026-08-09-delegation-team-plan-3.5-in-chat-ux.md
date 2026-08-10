# Delegation Run · In-Chat UX Redesign (Plan 3.5)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the side DelegationRunPanel (tree + poll) with the conversation model: a delegation run lives in a **chat conversation**, each agent (entry + delegates) streams its output as a labeled assistant message, and write-approval shows as an **inline card** in the chat. Matches the workflow-team UX.

**Worktree:** `.worktrees/delegation-team` on `feature/delegation-team`.

## Mechanism (confirmed from workflowRuntime.executeStep)
- Per agent: `appendMessage({ role:"assistant", status:"running", content:"[]", taskId:<sessionId>, agentId, agentName, adapter, roleLabel:<label>, conversationId })` → `appendMessage` auto-fires `notifyMessagesChangedHandler` (chat refreshes). The `taskId=sessionId` links the message to cliRun's live `cli://<sessionId>` stream.
- During cliRun: collect items, debounced (300ms) `updateMessage({ id, content: JSON.stringify(items) })`.
- On finish: `updateMessage({ id, status: done/failed })`.

## Tasks

### Task 1: Runner streams a per-agent message
- Add `roleLabel?: string` to `CliRunArgs` (`electron/cli/runtimeShared.ts`).
- Enhance `createDelegateAgentRunner(webContents)` (`electron/cli/delegationRunner.ts`): when `args.conversationId` present, mirror executeStep — generate a messageId, `appendMessage`(placeholder assistant with roleLabel=args.roleLabel, taskId=args.sessionId, agentId/agentName/adapter), then during cliRun collect items + debounced `updateMessage(content=JSON.stringify(items))`, and finalize `updateMessage(status)`. Use `appendMessage`/`updateMessage` from `./conversations.js`. (When no conversationId, behave as today — just harvest.)
- Test: unit-test the harvest path still works; message-streaming is build-verified (needs a real conversation; covered by manual smoke). Optionally a runtime-level test that appendMessage is invoked (in-memory db + spy).

### Task 2: Runtime passes conversationId + roleLabel
- `electron/cli/delegationRuntime.ts`: in `runEntry` set `roleLabel: entry.label` + ensure `conversationId` is on the CliRunArgs; in `executor` set `roleLabel: args.teammate.label` + `conversationId: ctx.conversationId`. (Both already construct CliRunArgs — add roleLabel.)

### Task 3: createDelegationRun IPC creates conversation + returns conversationId
- `electron/cli/delegationIpc.ts` `workflow:createDelegationRun`: `createConversation` (cwd, delegation marker) → `appendMessage`(user goal) → `rt.prepareRun({ ..., conversationId })` → `void rt.runEntry(runId, goal)` → return `{ ok:true, runId, conversationId }`.
- Mirror how `workflow:createTeamRun` creates a conversation (read workflowIpc.ts). Pass a model/agent on the conversation if required (the workflow uses a team member).

### Task 4: ChatView navigates to the conversation; remove the side panel
- `src/components/CLI/ChatView.tsx`: on `delegationClient.createRun` success, switch the workspace to the returned conversation's chat view (mirror how workflow createAndStartTeam lands the user on the conversation — read the workflow send path). Remove the inline `<DelegationRunPanel>` rendering + `activeDelegationRunId` state (Task 6 of Plan 3).
- Delete (or stop importing) `DelegationRunPanel.tsx` / `DelegationRunTree.tsx` if now unused.

### Task 5: Inline write-approval card in the conversation view
- New `src/components/Workflows/DelegationApprovalCard.tsx`: given a `runId`, polls `delegationClient.listPendingApprovals(runId)` while mounted; if a pending approval exists, renders an inline card with Approve/Reject → `delegationClient.approveWrite({runId, approvalId, approved})`.
- Mount it in the conversation view when the active conversation's run is a delegation run with status "blocked" (needs the conversation→run link: store the delegation runId on the conversation or look it up). Minimal v1: render the card at the top of the conversation chat when a delegation run for that conversation is active + blocked.

### Task 6: Full regression
- `npm test` (FULL, not just handoff-db) → 0 fail. typecheck + build clean.
- Manual smoke deferred (user).

## Self-Review
- Live streaming relies on `taskId=sessionId` linking the message to cliRun's `cli://<sessionId>` stream (same as workflow). If the chat doesn't live-render, verify the conversation's streaming infra is active for the delegation sessions.
- Approval card polls (simple) — could later switch to the `delegation://approval` push.
