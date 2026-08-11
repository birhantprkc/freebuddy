import type { DelegationRosterEntry } from "../../delegationTeamTypes.js";

/** Canonical async-delegation protocol. Skill / MCP / roster prompts derive from here. */

export const PROTOCOL_RULES = {
  delegateReturnsPending:
    'Call `delegate(teammate_id, task)` — returns IMMEDIATELY with `{request_id, status:"pending"}`. The teammate runs asynchronously.',
  pendingMeansQueued:
    'status `pending` = queued behind the concurrency limit (not started yet). Keep this turn open; poll `check_delegate_result` after a few seconds. Do NOT end your turn while pending.',
  runningMeansMayEndTurn:
    'status `running` = teammate is executing. You MAY end your turn; the system will automatically wake you with the result when it settles. No need to busy-poll.',
  terminalMeansUseResult:
    'status `done`/`failed`/`timeout` = terminal. Use `result` to continue (retry, delegate elsewhere, or do it yourself).',
  noBounce: "Do NOT bounce work back to your caller or any ancestor on the call chain.",
  noWholeTask:
    "Do NOT delegate the entire task you were given (near-identical copy). Split a real sub-task, or do it yourself.",
  preferSelf: "Prefer work you can finish yourself; do not abuse delegation.",
  depthAwareness:
    "Your current delegation depth and the team roster are in the prompt header. Near the depth cap, prefer doing the work yourself."
} as const;

export function mcpListTeammatesDescription(): string {
  return "List the teammates available to delegate to in the current delegation run (excluding yourself). Each entry has id, label, capability (what to delegate to it), and canWrite. Read-only.";
}

export function mcpDelegateDescription(): string {
  return [
    "Asynchronously delegate a sub-task to a teammate.",
    PROTOCOL_RULES.delegateReturnsPending,
    "Pick the teammate by matching its capability to the sub-task.",
    PROTOCOL_RULES.preferSelf,
    PROTOCOL_RULES.noBounce,
    PROTOCOL_RULES.noWholeTask
  ].join(" ");
}

export function mcpCheckResultDescription(): string {
  return [
    "Poll a delegate call's result. Returns {status, result, request_id}.",
    PROTOCOL_RULES.pendingMeansQueued,
    PROTOCOL_RULES.runningMeansMayEndTurn,
    PROTOCOL_RULES.terminalMeansUseResult
  ].join(" ");
}

function writeFlag(canWrite: boolean): string {
  return canWrite ? "可写" : "只读";
}

export function buildDelegationRosterPrompt(
  roster: DelegationRosterEntry[],
  selfId: string,
  depth: number,
  maxDepth: number
): string {
  const lines = roster
    .filter((r) => r.id !== selfId)
    .map((r) => `- [${r.id}] ${r.label} (${writeFlag(r.canWrite)})："${r.capability}"`)
    .join("\n");
  return [
    "## 协作团队（可委派）",
    "某子任务更适合某队友时：",
    '1. 调 delegate(teammate_id, task) —— 立即返回 {request_id, status:"pending"}',
    "2. 调 check_delegate_result(request_id) 查看结果：",
    "   - status 为 done/failed/timeout —— 直接用 result 继续工作。",
    "   - status 为 running —— 子任务正在跑；你可以结束本轮，结果就绪后系统会自动用结果唤醒你继续，无需反复轮询。",
    "   - status 为 pending —— 还在排队（前面的子任务没跑完），稍等几秒再查，本轮先别结束。",
    "3. 用返回的 result 继续你的工作。",
    "优先自己能完成的；别滥用委派；别反弹回调用方；别把整份任务原样外派。",
    `当前深度 ${depth} / 上限 ${maxDepth}。`,
    "队友：",
    lines || "- （无其他队友）"
  ].join("\n");
}

export function buildDelegateTaskPrompt(
  task: string,
  roster: DelegationRosterEntry[],
  selfId: string,
  depth: number,
  maxDepth: number
): string {
  return [buildDelegationRosterPrompt(roster, selfId, depth, maxDepth), "", "## 本次任务", task].join(
    "\n"
  );
}

export interface DelegateWakeInfo {
  taskText: string;
  roleLabel: string;
  status: string;
  resultSummary: string;
}

export function buildDelegateWakePrompt(
  info: DelegateWakeInfo,
  roster: DelegationRosterEntry[],
  selfId: string,
  depth: number,
  maxDepth: number
): string {
  const summary = info.resultSummary?.trim() || "(无输出)";
  return [
    buildDelegationRosterPrompt(roster, selfId, depth, maxDepth),
    "",
    "## 委派结果返回（你被唤醒）",
    `你之前委派给「${info.roleLabel}」的子任务已结束（status: ${info.status}）。`,
    "子任务：",
    info.taskText,
    "",
    "结果：",
    summary,
    "",
    "请据此继续你的工作：问题已解决就收尾；仍有待办就继续，或按需再次委派。"
  ].join("\n");
}

/** English SKILL.md body (frontmatter supplied by assets file / seed). */
export function buildDelegationSkillMarkdown(): string {
  return [
    "---",
    "name: delegation",
    "description: Collaborate with teammate agents in a self-organizing delegation run. Discover teammates and delegate sub-tasks asynchronously; the system wakes you when results settle.",
    "version: 1.1.0",
    "---",
    "",
    "# Delegation",
    "",
    "You are part of a self-organizing team. You can delegate sub-tasks to teammates and receive delegated sub-tasks from your caller.",
    "",
    "## When to delegate",
    "Delegate a sub-task ONLY when:",
    "- It falls clearly in a teammate's `capability` (read it via `list_teammates`), AND",
    "- It is non-trivial work you are not best suited to do yourself.",
    "",
    "Do NOT delegate:",
    "- Small things you can do directly.",
    "- Back to your caller or any ancestor (no ping-pong).",
    "- The entire task you were given (near-identical copy).",
    "",
    "## How to delegate",
    `1. Call \`list_teammates\` to see who is available.`,
    `2. ${PROTOCOL_RULES.delegateReturnsPending}`,
    `3. Call \`check_delegate_result(request_id)\`:`,
    `   - ${PROTOCOL_RULES.terminalMeansUseResult}`,
    `   - ${PROTOCOL_RULES.runningMeansMayEndTurn}`,
    `   - ${PROTOCOL_RULES.pendingMeansQueued}`,
    "",
    "## Handle the result",
    "- `status: \"done\"` → use `result`.",
    "- `status: \"failed\"` / `\"timeout\"` → decide: retry, delegate to a different teammate, or do it yourself. Do not loop forever.",
    "",
    "## Current context",
    PROTOCOL_RULES.depthAwareness
  ].join("\n");
}

/** Phrases that Skill / MCP / roster text must all surface (for snapshot tests). */
export function protocolCanonicalPhrases(): string[] {
  return [
    'status:"pending"',
    "running",
    "wake",
    "pending",
    "no ping-pong",
    "entire task"
  ];
}
