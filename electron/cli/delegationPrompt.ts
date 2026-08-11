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
    "2. 调 check_delegate_result(request_id) 查看结果：",
    "   - status 为 done/failed/timeout —— 直接用 result 继续工作。",
    "   - status 为 running —— 子任务正在跑；你可以结束本轮，结果就绪后系统会自动用结果唤醒你继续，无需反复轮询。",
    "   - status 为 pending —— 还在排队（前面的子任务没跑完），稍等几秒再查，本轮先别结束。",
    "3. 用返回的 result 继续你的工作。",
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
