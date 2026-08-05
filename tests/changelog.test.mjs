import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildPublishedReleaseNotes,
  extractChangelogSection,
  formatChangelogSection,
  formatReleaseNotes,
  groupCommitSubjects,
  prependChangelogSection
} from "../scripts/changelog-lib.mjs";

test("groups conventional commits into user-facing release note sections", () => {
  assert.deepEqual(groupCommitSubjects([
    "feat(workspaces): add multi-folder projects",
    "fix(runtime): preserve workspace roots",
    "perf: speed up workspace discovery",
    "style(sidebar): polish project expander",
    "docs: explain workspace roots",
    "test: cover workspace roots",
    "chore: release v0.6.9",
    "Show isolated workspace source paths"
  ]), {
    "新功能": ["add multi-folder projects", "Show isolated workspace source paths"],
    "问题修复": ["preserve workspace roots"],
    "体验优化": ["speed up workspace discovery", "polish project expander"]
  });
});

test("formats user-facing release notes and omits internal-only commits", () => {
  const notes = formatReleaseNotes(groupCommitSubjects([
    "feat: add workspace isolation",
    "fix: avoid a Windows sandbox crash",
    "docs: update architecture notes"
  ]));

  assert.equal(notes, [
    "### 新功能",
    "",
    "- add workspace isolation",
    "",
    "### 问题修复",
    "",
    "- avoid a Windows sandbox crash"
  ].join("\n"));
});

test("creates, prepends, and extracts a single version changelog section", () => {
  const section = formatChangelogSection({
    version: "0.6.9",
    date: "2026-07-29",
    notes: "### 新功能\n\n- add workspace isolation"
  });
  const changelog = prependChangelogSection([
    "# Changelog",
    "",
    "## [0.6.8] - 2026-07-20",
    "",
    "### 问题修复",
    "",
    "- fix an earlier issue",
    ""
  ].join("\n"), section);

  assert.equal(changelog, [
    "# Changelog",
    "",
    "## [0.6.9] - 2026-07-29",
    "",
    "### 新功能",
    "",
    "- add workspace isolation",
    "",
    "## [0.6.8] - 2026-07-20",
    "",
    "### 问题修复",
    "",
    "- fix an earlier issue",
    ""
  ].join("\n"));
  assert.equal(
    extractChangelogSection(changelog, "v0.6.9"),
    "### 新功能\n\n- add workspace isolation"
  );
});

test("preserves the changelog introduction outside version release notes", () => {
  const section = formatChangelogSection({
    version: "0.6.9",
    date: "2026-07-29",
    notes: "### 新功能\n\n- add workspace isolation"
  });
  const changelog = prependChangelogSection("# Changelog\n\n记录面向用户的版本变更。\n", section);

  assert.match(changelog, /^# Changelog\n\n记录面向用户的版本变更。\n\n## \[0\.6\.9\]/);
  assert.equal(
    extractChangelogSection(changelog, "0.6.9"),
    "### 新功能\n\n- add workspace isolation"
  );
});

test("extracting a missing release notes section fails clearly", () => {
  assert.throws(
    () => extractChangelogSection("# Changelog\n", "0.6.9"),
    /CHANGELOG\.md 中找不到 v0\.6\.9 的变更说明/
  );
});

test("builds GitHub release notes from one changelog section and installation guidance", () => {
  const changelog = [
    "# Changelog",
    "",
    "## [0.6.9] - 2026-07-29",
    "",
    "### 新功能",
    "",
    "- add workspace isolation"
  ].join("\n");

  assert.equal(
    buildPublishedReleaseNotes({
      changelog,
      version: "0.6.9",
      installationInstructions: "## 安装说明\n\n- Download the package for your platform."
    }),
    [
      "### 新功能",
      "",
      "- add workspace isolation",
      "",
      "## 安装说明",
      "",
      "- Download the package for your platform."
    ].join("\n")
  );
});

test("release notes CLI combines the requested changelog version with installation guidance", () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "freebuddy-release-notes-"));
  const changelogPath = path.join(fixtureDir, "CHANGELOG.md");
  const installationPath = path.join(fixtureDir, "installation.md");
  const outputPath = path.join(fixtureDir, "release-notes.md");
  fs.writeFileSync(changelogPath, "# Changelog\n\n## [0.6.9] - 2026-07-29\n\n### 新功能\n\n- add workspace isolation\n");
  fs.writeFileSync(installationPath, "## 安装说明\n\n下载 {{version}} 对应的安装包。\n");

  try {
    execFileSync(process.execPath, [
      "scripts/release-notes.mjs",
      "--version", "v0.6.9",
      "--changelog", changelogPath,
      "--installation", installationPath,
      "--output", outputPath
    ], { cwd: new URL("..", import.meta.url) });

    assert.equal(fs.readFileSync(outputPath, "utf8"), [
      "### 新功能",
      "",
      "- add workspace isolation",
      "",
      "## 安装说明",
      "",
      "下载 v0.6.9 对应的安装包。",
      ""
    ].join("\n"));
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});
