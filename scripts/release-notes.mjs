#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildPublishedReleaseNotes } from "./changelog-lib.mjs";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const options = {
    version: "",
    changelog: "CHANGELOG.md",
    installation: ".github/release-installation.md",
    output: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      return { ...options, help: true };
    }
    if (!["--version", "--changelog", "--installation", "--output"].includes(arg)) {
      throw new Error(`未知参数: ${arg}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${arg} 需要提供值`);
    options[arg.slice(2)] = value;
    index += 1;
  }

  if (!options.version) throw new Error("--version 需要提供发布版本");
  return options;
}

function readFile(relativePath) {
  const filePath = path.resolve(rootDir, relativePath);
  if (!fs.existsSync(filePath)) throw new Error(`找不到文件: ${relativePath}`);
  return fs.readFileSync(filePath, "utf8");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write("用法: node scripts/release-notes.mjs --version v1.2.3 [--output release-notes.md]\n");
    return;
  }

  const installationInstructions = readFile(options.installation).replaceAll("{{version}}", options.version);
  const notes = buildPublishedReleaseNotes({
    changelog: readFile(options.changelog),
    version: options.version,
    installationInstructions
  });

  if (options.output) {
    fs.writeFileSync(path.resolve(rootDir, options.output), `${notes}\n`);
  } else {
    process.stdout.write(`${notes}\n`);
  }
}

try {
  main();
} catch (error) {
  console.error(error?.message || error);
  process.exit(1);
}
