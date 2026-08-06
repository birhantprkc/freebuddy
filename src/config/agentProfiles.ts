import type { CLIMember } from "@/config/aiMembers";

export const BUTLERBUDDY_AGENT_ID = "cli-butlerbuddy";
export const BUTLERBUDDY_SKILL_ID = "butlerbuddy";

export function mergeRequiredSkillIds(
  selectedIds: readonly string[] | undefined,
  requiredIds: readonly string[] | undefined
): string[] {
  return [...new Set([...(requiredIds ?? []), ...(selectedIds ?? [])])];
}

export function requiredSkillIdsForMember(
  member: CLIMember | undefined
): string[] {
  return member?.requiredSkillIds ?? [];
}
