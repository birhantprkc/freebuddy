const SECTION_ORDER = ["新功能", "问题修复", "体验优化"];
const INTERNAL_COMMIT_TYPES = new Set(["build", "chore", "ci", "docs", "test"]);
const IMPROVEMENT_COMMIT_TYPES = new Set(["perf", "refactor", "style"]);

function normaliseVersion(version) {
  return String(version).replace(/^v/, "");
}

function unique(values) {
  return [...new Set(values)];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function groupCommitSubjects(subjects) {
  const groups = Object.fromEntries(SECTION_ORDER.map((section) => [section, []]));

  for (const rawSubject of subjects) {
    const subject = rawSubject.trim();
    if (!subject) continue;

    const match = subject.match(/^([a-z]+)(?:\([^)]*\))?!?:\s+(.+)$/i);
    const type = match?.[1].toLowerCase();
    const description = match?.[2]?.trim() || subject;

    if (type && INTERNAL_COMMIT_TYPES.has(type)) continue;
    if (type === "fix") {
      groups["问题修复"].push(description);
    } else if (type && IMPROVEMENT_COMMIT_TYPES.has(type)) {
      groups["体验优化"].push(description);
    } else {
      groups["新功能"].push(description);
    }
  }

  return Object.fromEntries(
    SECTION_ORDER
      .map((section) => [section, unique(groups[section])])
      .filter(([, entries]) => entries.length > 0)
  );
}

export function formatReleaseNotes(groups) {
  return SECTION_ORDER
    .filter((section) => groups[section]?.length > 0)
    .map((section) => [
      `### ${section}`,
      "",
      ...groups[section].map((entry) => `- ${entry}`)
    ].join("\n"))
    .join("\n\n");
}

export function formatChangelogSection({ version, date, notes }) {
  const normalizedVersion = normaliseVersion(version);
  const normalizedNotes = notes.trim();
  if (!normalizedVersion) throw new Error("版本号不能为空");
  if (!date) throw new Error("发布日期不能为空");
  if (!normalizedNotes) throw new Error("变更说明不能为空");

  return `## [${normalizedVersion}] - ${date}\n\n${normalizedNotes}`;
}

export function prependChangelogSection(changelog, section) {
  const header = "# Changelog";
  const normalizedSection = section.trim();
  const existing = changelog.trimEnd();

  if (!existing) return `${header}\n\n${normalizedSection}\n`;
  if (!existing.startsWith(header)) {
    throw new Error("CHANGELOG.md 必须以 # Changelog 开头");
  }

  const remainder = existing.slice(header.length).trim();
  const firstVersion = /^## \[/m.exec(remainder);
  const introduction = firstVersion ? remainder.slice(0, firstVersion.index).trim() : remainder;
  const history = firstVersion ? remainder.slice(firstVersion.index).trim() : "";
  return [header, introduction, normalizedSection, history]
    .filter(Boolean)
    .join("\n\n")
    .concat("\n");
}

export function extractChangelogSection(changelog, version) {
  const normalizedVersion = normaliseVersion(version);
  const heading = new RegExp(`^## \\[${escapeRegExp(normalizedVersion)}\\] - .*$(?:\\r?\\n)?`, "m");
  const match = heading.exec(changelog);
  if (!match) {
    throw new Error(`CHANGELOG.md 中找不到 v${normalizedVersion} 的变更说明`);
  }

  const afterHeading = match.index + match[0].length;
  const followingHeading = /^## \[/m;
  const nextMatch = followingHeading.exec(changelog.slice(afterHeading));
  const end = nextMatch ? afterHeading + nextMatch.index : changelog.length;
  return changelog.slice(afterHeading, end).trim();
}

export function buildPublishedReleaseNotes({ changelog, version, installationInstructions = "" }) {
  return [
    extractChangelogSection(changelog, version),
    installationInstructions.trim()
  ].filter(Boolean).join("\n\n");
}
