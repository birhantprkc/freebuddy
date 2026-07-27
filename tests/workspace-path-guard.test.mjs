import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

async function load() {
  const rootsSource = fs.readFileSync(
    new URL("../electron/shared/workspaceRoots.ts", import.meta.url),
    "utf8"
  );
  const guardSource = fs.readFileSync(
    new URL("../electron/shared/workspacePathGuard.ts", import.meta.url),
    "utf8"
  );
  const combined = `${rootsSource}\n${guardSource.replace(
    /import \{ isPathWithinRoots \} from "\.\/workspaceRoots\.js";\s*/m,
    ""
  )}`;
  const output = ts.transpileModule(combined, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
  );
}

test("relative paths resolve against primary", async () => {
  const { resolveWithinRoots } = await load();
  const primary = "/Users/me/a";
  const roots = [primary, "/Users/me/b"];
  const r = resolveWithinRoots("src/x.ts", roots, primary);
  assert.equal(r.ok, true);
  assert.equal(r.absolute, path.resolve(primary, "src/x.ts"));
});

test("absolute path inside secondary root is allowed", async () => {
  const { resolveWithinRoots } = await load();
  const primary = "/Users/me/a";
  const roots = [primary, "/Users/me/b"];
  const r = resolveWithinRoots("/Users/me/b/pkg.json", roots, primary);
  assert.equal(r.ok, true);
  assert.equal(r.absolute, path.resolve("/Users/me/b/pkg.json"));
});

test("path outside roots is rejected", async () => {
  const { resolveWithinRoots } = await load();
  const r = resolveWithinRoots("/etc/passwd", ["/Users/me/a"], "/Users/me/a");
  assert.equal(r.ok, false);
});

test("path traversal escapes are rejected", async () => {
  const { resolveWithinRoots } = await load();
  const primary = "/Users/me/a";
  const r = resolveWithinRoots("../../etc/passwd", [primary], primary);
  assert.equal(r.ok, false);
});
