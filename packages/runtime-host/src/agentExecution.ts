export type PublicAgentProfile = {
  id: string;
  adapter: string;
  agentName: string;
  skillIds?: string[];
};

export type HostResolvedAgent = PublicAgentProfile & {
  binary?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
};

export function publicAgentProfile(agent: HostResolvedAgent): PublicAgentProfile {
  return {
    id: agent.id,
    adapter: agent.adapter,
    agentName: agent.agentName,
    skillIds: agent.skillIds
  };
}

export function trustedAgentExecution<T extends {
  agentId: string;
  skillIds?: string[];
  adapter?: string;
  agentName?: string;
  binary?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
}>(
  resolved: HostResolvedAgent | undefined,
  requested: T
): Omit<T, "binary" | "extraArgs" | "env" | "adapter" | "agentName" | "skillIds"> & {
  adapter: string;
  agentName: string;
  binary?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
  skillIds: string[];
} {
  if (!resolved || resolved.id !== requested.agentId) {
    throw new Error(`unknown agent: ${requested.agentId}`);
  }
  const {
    binary: _binary,
    extraArgs: _extraArgs,
    env: _env,
    adapter: _adapter,
    agentName: _agentName,
    skillIds: requestedSkillIds,
    ...rest
  } = requested;
  return {
    ...(rest as Omit<T, "binary" | "extraArgs" | "env" | "adapter" | "agentName" | "skillIds">),
    adapter: resolved.adapter,
    agentName: resolved.agentName,
    binary: resolved.binary,
    extraArgs: resolved.extraArgs,
    env: resolved.env,
    skillIds: [...new Set([...(resolved.skillIds ?? []), ...(requestedSkillIds ?? [])])]
  };
}
