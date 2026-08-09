import "./fixtures/electron-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";

test("inactivity suppression set add/remove/is/clear", async () => {
  const { addInactivitySuppression, removeInactivitySuppression, isInactivitySuppressed, clearInactivitySuppression } =
    await import("../dist-electron/cli/inactivitySuppression.js");
  clearInactivitySuppression();
  assert.equal(isInactivitySuppressed("s1"), false);
  addInactivitySuppression("s1");
  assert.equal(isInactivitySuppressed("s1"), true);
  assert.equal(isInactivitySuppressed("s2"), false);
  removeInactivitySuppression("s1");
  assert.equal(isInactivitySuppressed("s1"), false);
  addInactivitySuppression("s1");
  addInactivitySuppression("s2");
  clearInactivitySuppression();
  assert.equal(isInactivitySuppressed("s1"), false);
  assert.equal(isInactivitySuppressed("s2"), false);
});

test("inactivity suppression is idempotent", async () => {
  const { addInactivitySuppression, removeInactivitySuppression, isInactivitySuppressed, clearInactivitySuppression } =
    await import("../dist-electron/cli/inactivitySuppression.js");
  clearInactivitySuppression();
  addInactivitySuppression("s1");
  addInactivitySuppression("s1");
  assert.equal(isInactivitySuppressed("s1"), true);
  removeInactivitySuppression("s1");
  assert.equal(isInactivitySuppressed("s1"), false);
  removeInactivitySuppression("s1"); // removing absent does not throw
  clearInactivitySuppression();
});
