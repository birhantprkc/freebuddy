import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ensurePiAcpLauncher,
  piAcpEntryForRoot,
  piCliEntryForRoot,
  piLauncherDir,
  piRuntimeRoots,
  readPiRuntimeManifest,
  resolvePiAcpRuntime,
  resolvePiAcpSpawnPlan,
  resolvePiNodeRuntime
} from "../dist-electron/cli/piRuntime.js";
import {
  PI_ACP_ENTRY_REL,
  PI_CLI_ENTRY_REL,
  PI_RUNTIME_ROOT_DIR,
  PI_RUNTIME_STAGING_SUBDIR,
  piRuntimeStagingDir
} from "../scripts/pi-runtime-layout.mjs";

const require = createRequire(import.meta.url);

function makeFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "freebuddy-pi-root-"));
  const piAcpEntry = piAcpEntryForRoot(root);
  const piCliEntry = piCliEntryForRoot(root);
  fs.mkdirSync(path.dirname(piAcpEntry), { recursive: true });
  fs.mkdirSync(path.dirname(piCliEntry), { recursive: true });
  fs.writeFileSync(piAcpEntry, "// bridge entry\n");
  fs.writeFileSync(piCliEntry, "// pi cli entry\n");
  return { root, piAcpEntry, piCliEntry };
}

test("piRuntimeRoots prefers packaged resources, then staging, then repo", () => {
  const roots = piRuntimeRoots();
  assert.ok(roots.length >= 2);
  assert.equal(roots[roots.length - 1], path.resolve(fileURLToPath(new URL("..", import.meta.url))));
  assert.ok(
    roots.some((root) => root.endsWith(path.join(".build", "pi-runtime", PI_RUNTIME_STAGING_SUBDIR)))
  );
  // The packaged root must point at the nested staging subdir, never at
  // <resources>/pi-runtime itself (that layout lost node_modules at pack time).
  assert.ok(
    roots.every((root) => !root.endsWith(path.join("pi-runtime"))),
    `packaged root must include the ${PI_RUNTIME_STAGING_SUBDIR} subdir: ${roots.join(", ")}`
  );
});

test("piRuntimeRoots staging root matches the staging script layout", () => {
  // Guards against the layout drifting between scripts/pi-runtime-layout.mjs
  // and electron/cli/piRuntime.ts — the drift that shipped v0.10.5 without pi.
  const roots = piRuntimeRoots();
  assert.ok(roots.includes(piRuntimeStagingDir(PI_RUNTIME_ROOT_DIR)));
  assert.ok(PI_RUNTIME_STAGING_SUBDIR !== "node_modules");
});

test("resolvePiAcpRuntime finds the first ready root and its manifest", () => {
  const { root, piAcpEntry } = makeFixtureRoot();
  fs.writeFileSync(
    path.join(root, "pi-runtime.json"),
    JSON.stringify({ piVersion: "1.2.3", piAcpVersion: "0.0.33" })
  );

  const status = resolvePiAcpRuntime([root]);
  assert.equal(status.ready, true);
  assert.equal(status.root, root);
  assert.equal(status.piAcpEntry, piAcpEntry);
  assert.equal(status.piVersion, "1.2.3");
  assert.equal(status.piAcpVersion, "0.0.33");

  const empty = resolvePiAcpRuntime([fs.mkdtempSync(path.join(os.tmpdir(), "freebuddy-pi-empty-"))]);
  assert.equal(empty.ready, false);

  // First ready root wins.
  const second = makeFixtureRoot();
  const both = resolvePiAcpRuntime([second.root, root]);
  assert.equal(both.root, second.root);
});

test("readPiRuntimeManifest falls back to package.json versions", () => {
  const { root } = makeFixtureRoot();
  fs.writeFileSync(
    path.join(root, "node_modules", "pi-acp", "package.json"),
    JSON.stringify({ version: "0.0.33" })
  );
  const manifest = readPiRuntimeManifest(root);
  assert.equal(manifest.piAcpVersion, "0.0.33");
  assert.equal(manifest.piVersion, undefined);
});

test("resolvePiAcpRuntime requires both bridge and pi CLI entries", () => {
  const { root, piCliEntry } = makeFixtureRoot();
  fs.rmSync(piCliEntry);
  assert.equal(resolvePiAcpRuntime([root]).ready, false);
});

test("resolvePiNodeRuntime prefers an explicit node and falls back to Electron-as-Node", () => {
  const fakeNode = path.join(os.tmpdir(), `fake-node-${process.pid}`);
  fs.writeFileSync(fakeNode, "#!/bin/sh\n");
  const withNode = resolvePiNodeRuntime({
    PATH: "",
    FREEBUDDY_NODE_BIN: fakeNode
  });
  assert.equal(withNode.bin, fakeNode);
  assert.deepEqual(withNode.env, {});

  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "freebuddy-no-node-"));
  const fallback = resolvePiNodeRuntime({
    PATH: "",
    FREEBUDDY_NODE_BIN: "",
    ProgramFiles: emptyRoot,
    "ProgramFiles(x86)": emptyRoot
  });
  assert.equal(fallback.bin, process.execPath);
  assert.deepEqual(fallback.env, { ELECTRON_RUN_AS_NODE: "1" });
});

test("ensurePiAcpLauncher writes an idempotent executable launcher", () => {
  const { piCliEntry } = makeFixtureRoot();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "freebuddy-pi-data-"));
  const node = { bin: "/usr/bin/node", env: {} };
  const launcher = ensurePiAcpLauncher({ dataDir, piCliEntry, node });

  assert.equal(launcher, path.join(piLauncherDir(dataDir), process.platform === "win32" ? "pi-fb.cmd" : "pi-fb"));
  const content = fs.readFileSync(launcher, "utf8");
  assert.match(content, /ELECTRON_RUN_AS_NODE/);
  assert.match(content, new RegExp(piCliEntry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  // Rewriting with the same inputs keeps the file untouched.
  const before = fs.statSync(launcher);
  const again = ensurePiAcpLauncher({ dataDir, piCliEntry, node });
  assert.equal(again, launcher);
  const after = fs.statSync(launcher);
  if (process.platform !== "win32") {
    // mtimeMs granularity may be coarse; at minimum the mode stays executable.
    assert.equal(after.mode & 0o111, 0o111);
    assert.ok(before.mtimeMs <= after.mtimeMs + 1000);
  }
});

test("resolvePiAcpSpawnPlan returns a node spawn plan with bridge env", () => {
  const { root } = makeFixtureRoot();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "freebuddy-pi-plan-"));
  const fakeNode = path.join(dataDir, "fake-node");
  fs.writeFileSync(fakeNode, "#!/bin/sh\n");
  const plan = resolvePiAcpSpawnPlan(
    dataDir,
    [root],
    { PATH: "", FREEBUDDY_NODE_BIN: fakeNode }
  );
  assert.ok(plan);
  assert.equal(plan.bin, fakeNode);
  assert.equal(plan.piAcpEntry, piAcpEntryForRoot(root));
  assert.equal(plan.env.PI_ACP_PI_COMMAND, path.join(piLauncherDir(dataDir), process.platform === "win32" ? "pi-fb.cmd" : "pi-fb"));
  assert.equal(plan.env.PI_SKIP_VERSION_CHECK, "1");
  assert.equal(plan.env.PI_CODING_AGENT_DIR, path.join(dataDir, "pi-agent"));

  const none = resolvePiAcpSpawnPlan(
    dataDir,
    [fs.mkdtempSync(path.join(os.tmpdir(), "freebuddy-pi-none-"))],
    { PATH: "", FREEBUDDY_NODE_BIN: "" }
  );
  assert.equal(none, undefined);
});

test("staged pi-runtime layout survives electron-builder's extraResources copy", async () => {
  // Regression guard for the v0.10.5 packaging bug: electron-builder's copy
  // filter drops a root-level `node_modules` directory (and its walker never
  // descends into filtered dirs), which silently shipped apps without the pi
  // runtime — Pi showed "binary not found" and GuideBuddy could not start.
  // The staged tree must live under <root>/runtime so node_modules is not at
  // the copy root. This test drives the real app-builder-lib copy path.
  const { FileMatcher, copyFiles } = require("app-builder-lib/out/fileMatcher.js");

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "freebuddy-pi-pack-"));
  const from = path.join(workDir, path.basename(PI_RUNTIME_ROOT_DIR)); // .build/pi-runtime
  const stagingDir = path.join(from, PI_RUNTIME_STAGING_SUBDIR);
  const to = path.join(workDir, "resources", path.basename(PI_RUNTIME_ROOT_DIR));

  // Reproduce the layout scripts/ensure-pi-runtime.mjs produces.
  fs.mkdirSync(path.dirname(path.join(stagingDir, PI_ACP_ENTRY_REL)), { recursive: true });
  fs.mkdirSync(path.dirname(path.join(stagingDir, PI_CLI_ENTRY_REL)), { recursive: true });
  fs.writeFileSync(path.join(stagingDir, PI_ACP_ENTRY_REL), "// bridge entry\n");
  fs.writeFileSync(path.join(stagingDir, PI_CLI_ENTRY_REL), "// pi cli entry\n");
  fs.writeFileSync(path.join(stagingDir, "package.json"), "{}\n");
  fs.writeFileSync(
    path.join(stagingDir, "pi-runtime.json"),
    JSON.stringify({ schemaVersion: 1, piVersion: "0.85.1", piAcpVersion: "0.0.33" })
  );

  // Same construction electron-builder uses for an object-form extraResources
  // entry ({from, to} with no filter), including copyFiles' "**/*" default.
  const matcher = new FileMatcher(from, to, (it) => it, []);
  await copyFiles([matcher], null, false);

  const packagedRoot = path.join(to, PI_RUNTIME_STAGING_SUBDIR);
  assert.ok(
    fs.existsSync(path.join(packagedRoot, PI_ACP_ENTRY_REL)),
    `missing ${PI_ACP_ENTRY_REL} after copy — electron-builder dropped the staged tree`
  );
  assert.ok(fs.existsSync(path.join(packagedRoot, PI_CLI_ENTRY_REL)));

  // The runtime resolver must accept the copied (packaged) layout as ready.
  const status = resolvePiAcpRuntime([packagedRoot]);
  assert.equal(status.ready, true);
  assert.equal(status.root, packagedRoot);
  assert.equal(status.piAcpVersion, "0.0.33");

  // The pack guard must pass on the copied tree and fail when it is gutted.
  // Remove the staging tree first so only the packaged copy remains.
  const { verifyPackagedPiRuntime } = await import("../scripts/pi-runtime-pack-guard.mjs");
  const appOutDir = path.join(workDir, "resources");
  fs.rmSync(from, { recursive: true, force: true });
  assert.equal(verifyPackagedPiRuntime(appOutDir), 1);
  fs.rmSync(path.join(packagedRoot, PI_CLI_ENTRY_REL));
  assert.throws(() => verifyPackagedPiRuntime(appOutDir), /missing the bundled pi runtime/);
});
