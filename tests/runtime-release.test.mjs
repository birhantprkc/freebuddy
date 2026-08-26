import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  isRuntimeTag,
  resolveRuntimePackVersion,
  runtimeChannelBaseUrl,
  runtimeReleaseRepo,
  runtimeReleaseTag,
  versionFromRuntimeTag
} from "../scripts/runtime-release-lib.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("runtime pack version comes from env, then runtime-v tag", () => {
  assert.equal(resolveRuntimePackVersion({ RUNTIME_PACK_VERSION: "1.2.3" }), "1.2.3");
  assert.equal(resolveRuntimePackVersion({ RUNTIME_PACK_VERSION: "runtime-v9.8.7" }), "9.8.7");
  assert.equal(
    resolveRuntimePackVersion({
      GITHUB_REF_TYPE: "tag",
      GITHUB_REF_NAME: "runtime-v2.0.1"
    }),
    "2.0.1"
  );
  assert.equal(resolveRuntimePackVersion({}), "0.0.0-dev");
  assert.equal(versionFromRuntimeTag("runtime-v1.0.1"), "1.0.1");
  assert.equal(versionFromRuntimeTag("v1.0.1"), null);
  assert.equal(isRuntimeTag("runtime-v1.0.1"), true);
  assert.equal(isRuntimeTag("v1.0.1"), false);
  assert.equal(runtimeReleaseTag("1.0.1"), "runtime-v1.0.1");
});

test("runtime artifacts default to the dedicated freebuddy-runtime repository", () => {
  assert.equal(runtimeReleaseRepo({}), "maojindao55/freebuddy-runtime");
  assert.equal(runtimeReleaseRepo({ RUNTIME_RELEASE_REPO: "acme/runtime" }), "acme/runtime");
  assert.equal(
    runtimeChannelBaseUrl({}),
    "https://raw.githubusercontent.com/maojindao55/freebuddy-runtime/main/channels"
  );
});

test("sign fails closed for tagged CI without a private key", () => {
  const result = spawnSync(process.execPath, [path.join(root, "scripts/sign-runtime-pack.mjs")], {
    env: {
      ...process.env,
      CI: "true",
      GITHUB_REF_NAME: "runtime-v1.0.1",
      RUNTIME_SIGNING_PRIVATE_KEY: ""
    },
    encoding: "utf8"
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}\n${result.stdout}`, /RUNTIME_SIGNING_PRIVATE_KEY/);
});
