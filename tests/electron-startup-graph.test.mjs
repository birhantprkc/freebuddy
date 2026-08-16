import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const STATIC_IMPORT_RE = /from\s+["'](\.[^"']+)["']/g;

function resolveImport(fromFile, spec) {
  let resolved = path.normalize(path.join(path.dirname(fromFile), spec));
  if (!resolved.endsWith(".js")) resolved += ".js";
  return resolved;
}

function staticDeps(absJsFile) {
  if (!fs.existsSync(absJsFile)) return [];
  const src = fs.readFileSync(absJsFile, "utf8");
  const out = [];
  for (const match of src.matchAll(STATIC_IMPORT_RE)) {
    out.push(resolveImport(absJsFile, match[1]));
  }
  return [...new Set(out)];
}

function findCycle(entryAbs) {
  const stack = [];
  const onStack = new Set();
  const visited = new Set();
  /** @type {string[] | null} */
  let found = null;
  const distRoot = path.join(root, "dist-electron");

  function dfs(node) {
    if (found) return;
    if (onStack.has(node)) {
      found = stack.slice(stack.indexOf(node)).concat(node);
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    onStack.add(node);
    stack.push(node);
    for (const dep of staticDeps(node)) {
      if (dep.startsWith(distRoot)) dfs(dep);
    }
    stack.pop();
    onStack.delete(node);
  }

  dfs(entryAbs);
  return found;
}

test("dev-electron waits for build:electron before launching Electron", () => {
  const src = read("scripts/dev-electron.mjs");
  // Must not fire-and-forget the electron TypeScript build: Vite is ready in
  // ~100ms while tsc takes multiple seconds, so launching early loads
  // half-written dist-electron modules (missing named exports).
  assert.match(src, /waitForExit\(\s*buildElectron/);
  assert.match(src, /await\s+Promise\.all/);
  assert.doesNotMatch(
    src,
    /^run\(\s*["']npm["']\s*,\s*\[[^\]]*build:electron[^\]]*\]\s*\)\s*;/m
  );
});

test("scheduledTasks does not statically import workflowRuntime (breaks ESM cycle)", () => {
  // Cycle was:
  // workflowRuntime -> runtime -> acpRuntime -> butlerToolService
  //   -> scheduledTasks -> workflowRuntime
  // which can surface as confusing named-export SyntaxErrors at startup.
  const src = read("electron/cli/scheduledTasks.ts");
  const withoutTypeImports = src.replace(/^import\s+type\s+[^;]+;/gm, "");
  assert.doesNotMatch(
    withoutTypeImports,
    /from\s+["']\.\/workflowRuntime\.js["']/
  );
  assert.match(src, /import\(\s*["']\.\/workflowRuntime\.js["']\s*\)/);
});

test("workflowRuntime runtime import graph has no cycle through scheduledTasks", () => {
  const entry = path.join(root, "dist-electron/cli/workflowRuntime.js");
  assert.ok(fs.existsSync(entry), "dist-electron must be built (npm run build:electron)");
  const cycle = findCycle(entry);
  if (cycle) {
    const pretty = cycle.map((p) => path.relative(root, p)).join(" -> ");
    assert.fail(`runtime import cycle detected: ${pretty}`);
  }
});
