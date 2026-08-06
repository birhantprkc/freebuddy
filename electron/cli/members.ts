import { getAdapterDefinition } from "./adapters.js";
import { builtinCliMembers, type CLIMember } from "./cliMemberBuiltins.js";
import { listOverrides } from "./store.js";
import { mergeRequiredSkillIds } from "./agentProfiles.js";

export { builtinCliMembers, type CLIMember };

export function listCliMembers(): CLIMember[] {
  const overrides = listOverrides();
  const overrideById = new Map(overrides.map((override) => [override.id, override]));
  const builtinMembers = builtinCliMembers.map((member) => ({
    ...member,
    cli: {
      ...member.cli,
      skillIds: mergeRequiredSkillIds(
        member.id,
        overrideById.get(member.cli.adapter)?.skillIds ?? member.cli.skillIds
      )
    }
  }));
  const customMembers = overrides
    .filter((override) => override.baseAdapter)
    .map((override): CLIMember | undefined => {
      const baseAdapter = override.baseAdapter!;
      const definition = getAdapterDefinition(baseAdapter);
      if (!definition) return undefined;
      return {
        id: `cli-${override.id}`,
        name: override.label?.trim() || definition.label,
        enabled: override.enabled !== false,
        cli: {
          adapter: baseAdapter,
          binary: override.binary,
          extraArgs: override.extraArgs,
          env: override.env,
          approvalMode: "auto",
          showStderr: true,
          skillIds: override.skillIds
        }
      };
    })
    .filter((member): member is CLIMember => Boolean(member));
  return [...builtinMembers, ...customMembers];
}
