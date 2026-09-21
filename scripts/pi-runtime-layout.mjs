/**
 * Shared layout constants for the bundled pi runtime.
 *
 * WHY the nested `runtime/` subdir — do not "simplify" it away:
 * electron-builder's extraResources copy filter (app-builder-lib/out/util/
 * filter.js) hard-excludes a *root-level* `node_modules` directory in the
 * `from` tree, and its walker never descends into a filtered directory.
 * Staging the dependency tree directly at `.build/pi-runtime/node_modules`
 * therefore shipped `package.json` + `pi-runtime.json` only: the packaged app
 * silently had no pi runtime, `resolvePiAcpRuntime()` found no ready root, and
 * the Pi adapter fell back to a PATH lookup reporting "binary not found"
 * (v0.10.5 shipped exactly this way). Nesting the tree one level down keeps
 * `node_modules` off the copy root.
 *
 * Keep in sync with electron/cli/piRuntime.ts (PI_RUNTIME_STAGING_SUBDIR and
 * piRuntimeRoots) — tests/pi-runtime.test.mjs asserts the two stay aligned.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/** extraResources `from` dir; packaged to <resourcesPath>/pi-runtime. */
export const PI_RUNTIME_ROOT_DIR = path.join(
  repoRoot,
  ".build",
  "pi-runtime"
);

/**
 * Subdir of PI_RUNTIME_ROOT_DIR that holds `node_modules` and the manifest.
 * MUST NOT be named `node_modules` (see the header comment).
 */
export const PI_RUNTIME_STAGING_SUBDIR = "runtime";

/** Version manifest written next to the staged node_modules. */
export const PI_RUNTIME_MANIFEST_FILE = "pi-runtime.json";

/** A staging root: contains node_modules and (usually) the manifest. */
export function piRuntimeStagingDir(rootDir = PI_RUNTIME_ROOT_DIR) {
  return path.join(rootDir, PI_RUNTIME_STAGING_SUBDIR);
}

export const PI_ACP_PACKAGE = "pi-acp";
export const PI_CODING_AGENT_PACKAGE = "@earendil-works/pi-coding-agent";

/** Relative to a staging root. */
export const PI_ACP_ENTRY_REL = path.join(
  "node_modules",
  PI_ACP_PACKAGE,
  "dist",
  "index.js"
);

/** Relative to a staging root. */
export const PI_CLI_ENTRY_REL = path.join(
  "node_modules",
  PI_CODING_AGENT_PACKAGE,
  "dist",
  "bundle",
  "cli.js"
);
