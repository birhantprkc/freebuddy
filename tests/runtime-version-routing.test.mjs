import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeVersionRouter, legacyRuntimeVersion } from "../packages/runtime-host/dist/index.js";

test("new runs use active version; resumed runs stay pinned", () => {
  let active = "A";
  const router = createRuntimeVersionRouter(() => active);
  const pinned = router.route({ runtimeVersion: "A" });
  active = "B";
  const resumed = router.route({ runtimeVersion: pinned.version });
  const created = router.route({});
  assert.equal(resumed.version, "A");
  assert.equal(created.version, "B");
  assert.equal(legacyRuntimeVersion(undefined), "bundled");
});
