import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

async function loadWorkspaceRoots() {
  const source = fs.readFileSync(
    new URL("../electron/shared/workspaceRoots.ts", import.meta.url),
    "utf8"
  );
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`
  );
}

test("resolveWorkspaceRoots defaults to homedir and dedups/normalizes", async () => {
  const { resolveWorkspaceRoots } = await loadWorkspaceRoots();

  assert.deepEqual(resolveWorkspaceRoots(undefined, "/home/me"), ["/home/me"]);
  assert.deepEqual(resolveWorkspaceRoots([], "/home/me"), ["/home/me"]);
  assert.deepEqual(
    resolveWorkspaceRoots(["/a/b", "/a/b", " /c/d ", "", null, 5], "/home/me"),
    ["/a/b", "/c/d"],
    "trims, dedups, drops invalid entries"
  );
});

test("isPathWithinRoots allows exact root and nested children only", async () => {
  const { isPathWithinRoots } = await loadWorkspaceRoots();

  assert.ok(isPathWithinRoots("/a/b", ["/a/b"]), "exact root allowed");
  assert.ok(isPathWithinRoots("/a/b/c", ["/a/b"]), "nested child allowed");
  assert.ok(
    !isPathWithinRoots("/a/bb", ["/a/b"]),
    "sibling prefix without separator must be rejected"
  );
  assert.ok(!isPathWithinRoots("/a/other", ["/a/b"]), "sibling dir rejected");
  assert.ok(!isPathWithinRoots("/x", ["/a/b"]), "unrelated path rejected");
  assert.ok(isPathWithinRoots("/a/b", ["/x", "/a/b"]), "matches one of several roots");
});

test("parentWithinRoots clamps at the root boundary", async () => {
  const { parentWithinRoots } = await loadWorkspaceRoots();

  assert.equal(parentWithinRoots("/a/b/c", ["/a/b"]), "/a/b");
  assert.equal(parentWithinRoots("/a/b", ["/a/b"]), null, "no parent above root");
  assert.equal(parentWithinRoots("/x/y", ["/a/b"]), null, "outside roots");
});

test("webUIServer exposes an authed, sandboxed /api/listDirs endpoint", () => {
  const server = fs.readFileSync(
    new URL("../electron/webUIServer.ts", import.meta.url),
    "utf8"
  );

  assert.match(server, /\/api\/listDirs/, "must register the /api/listDirs route");
  const block = server.slice(server.indexOf("/api/listDirs"));
  assert.match(block, /isAuthed\(req\)/, "must require auth");
  assert.match(block, /isPathWithinRoots/, "must enforce allowlist containment");
  assert.match(
    block,
    /remoteRootsForUser\(callerUserId\)/,
    "must resolve roots for the calling user, not globally"
  );
  assert.match(
    block,
    /roots\.length === 0/,
    "a user with no assigned roots must browse nothing"
  );
  assert.match(block, /path\.resolve/, "must normalize the requested path");
  assert.match(block, /dirent\.isDirectory\(\)/, "must list directories only");
  assert.match(
    server,
    /handleListDirs\(req,\s*res\)/,
    "must dispatch to handleListDirs"
  );
});
