import type { DelegationTeam } from "./delegationTeamTypes.js";
import { defaultDelegationPolicy } from "./delegationTeamTypes.js";

/**
 * Pick a reasonable default agent for a roster slot. Prefer the named member,
 * falling back to any enabled member so the builtin is usable out of the box.
 * (Mirrors the pickAgent() fallback philosophy from workflowTeamBuiltins.ts.)
 */
export function defaultRosterAgentId(preferred: string, fallback: string): string {
  return preferred || fallback;
}

export function builtinDelegationTeams(): DelegationTeam[] {
  return [
    {
      id: "team-delegation-impl-review",
      name: "自组织：实现+评审",
      description: "入口 agent 自主分解任务，需要独立审查时委派给评审 agent。",
      icon: undefined,
      enabled: true,
      source: "builtin",
      kind: "delegation",
      entryRoleId: "r-impl",
      roster: [
        {
          id: "r-impl",
          label: "实现",
          agentId: defaultRosterAgentId("cli-codex-acp", "cli-codex-acp"),
          capability:
            "实现功能、修改代码、跑构建与测试。明确需要写代码的子任务由本角色承担；遇到需要独立审查时委派给评审。",
          canWrite: true
        },
        {
          id: "r-rev",
          label: "评审",
          agentId: defaultRosterAgentId("cli-claude-agent-acp", "cli-claude-agent-acp"),
          capability:
            "审查 diff、找 bugs 与风险、给改进建议。需要独立审查时委派给本角色。只读。",
          canWrite: false
        }
      ],
      policy: {
        ...defaultDelegationPolicy(),
        requireApprovalBeforeDelegateWrite: true
      },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    }
  ];
}
