export const BUTLERBUDDY_AGENT_ID = "cli-butlerbuddy";
export const BUTLERBUDDY_SKILL_ID = "butlerbuddy";

export function requiredSkillIdsForAgent(agentId: string): string[] {
  return agentId === BUTLERBUDDY_AGENT_ID ? [BUTLERBUDDY_SKILL_ID] : [];
}

export function mergeRequiredSkillIds(
  agentId: string,
  selectedIds: readonly string[] | undefined
): string[] {
  return [
    ...new Set([...requiredSkillIdsForAgent(agentId), ...(selectedIds ?? [])])
  ];
}
