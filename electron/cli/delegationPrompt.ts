import type { DelegationRosterEntry } from "./delegationTeamTypes.js";

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
    "1. 调 delegate(teammate_id, task) —— 立即返回 {request_id, status:\"pending\"}",
    "2. 每隔几秒调 check_delegate_result(request_id) 直到 status 不再是 \"pending\"",
    "3. 用返回的 result 继续你的工作",
    "优先自己能完成的；别滥用委派；别反弹回调用方。",
    `当前深度 ${depth} \/ 上限 ${maxDepth}。`,
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
  return [buildDelegationRosterPrompt(roster, selfId, depth, maxDepth), "", "## 本次任务", task].join("\n");
}
