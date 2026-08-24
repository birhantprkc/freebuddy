import fs from "node:fs";
import path from "node:path";

import type { SkillSnapshot } from "./skillTypes.js";

export function buildSkillAnnouncement(
  prompt: string,
  skills: readonly SkillSnapshot[],
  options: { nativeSkillsMounted?: boolean } = {}
): string {
  if (skills.length === 0) return prompt;
  const catalog = skills
    .map((skill) => `- ${skill.name} (${skill.version}): ${skill.description}`)
    .join("\n");
  const accessGuidance = options.nativeSkillsMounted
    ? "Use the freebuddy-skills MCP tools skill_list and skill_load to read the selected skill instructions before applying them. Use skill_read_resource for files referenced by SKILL.md. Adapter-native skill discovery may also expose the mounted copies."
    : "These selected skills are available through the freebuddy-skills MCP server. Use skill_list and skill_load to read their instructions before applying them, and use skill_read_resource for files referenced by SKILL.md. Do not call adapter-native skill commands or search the filesystem with terminal tools to locate these skills.";
  return `[FreeBuddy active skills]\n${catalog}\n\n${accessGuidance}\n\n${prompt}`;
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function canonicalPath(value: string): string {
  try {
    return fs.realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

export function reconcileNativeSkillLinks(
  cwd: string,
  nativeDirs: readonly string[],
  selected: readonly SkillSnapshot[],
  registeredRoots: readonly string[]
): boolean {
  let mountedAny = false;
  for (const relativeDir of nativeDirs) {
    const directory = path.resolve(cwd, relativeDir);
    if (!isInside(cwd, directory)) continue;
    fs.mkdirSync(directory, { recursive: true });
    const desired = new Set(selected.map((skill) => skill.name));
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isSymbolicLink() || desired.has(entry.name)) continue;
      const link = path.join(directory, entry.name);
      try {
        const target = fs.realpathSync(link);
        if (
          registeredRoots.some((root) =>
            isInside(canonicalPath(root), canonicalPath(target))
          )
        ) {
          fs.unlinkSync(link);
        }
      } catch {
        // Leave links that FreeBuddy cannot prove it owns.
      }
    }
    for (const skill of selected) {
      const target = path.join(directory, skill.name);
      if (fs.existsSync(target)) {
        try {
          if (canonicalPath(target) === canonicalPath(skill.rootPath)) mountedAny = true;
        } catch {
          /* leave an existing path that FreeBuddy does not own */
        }
        continue;
      }
      try {
        fs.symlinkSync(
          skill.rootPath,
          target,
          process.platform === "win32" ? "junction" : "dir"
        );
        mountedAny = true;
      } catch (error) {
        console.warn(`[skills] could not mount ${skill.name} in ${relativeDir}:`, error);
      }
    }
  }
  return mountedAny;
}
