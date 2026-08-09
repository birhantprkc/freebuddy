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
    "某子任务更适合某队友时，调 MCP 工具 delegate(teammate_id, task)；list_teammates() 查队友。",
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
