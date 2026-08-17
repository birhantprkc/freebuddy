import "./fixtures/electron-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";

test("inactivity suppression is reference-counted per session", async () => {
  const { addInactivitySuppression, removeInactivitySuppression, isInactivitySuppressed, clearInactivitySuppression } =
    await import("../dist-electron/cli/inactivitySuppression.js");
  clearInactivitySuppression();
  assert.equal(isInactivitySuppressed("s1"), false);
  addInactivitySuppression("s1");
  addInactivitySuppression("s1");
  assert.equal(isInactivitySuppressed("s1"), true);
  removeInactivitySuppression("s1");
  assert.equal(isInactivitySuppressed("s1"), true); // still 1 ref
  removeInactivitySuppression("s1");
  assert.equal(isInactivitySuppressed("s1"), false);
  // remove below zero is clamped (no throw, stays false)
  removeInactivitySuppression("s1");
  assert.equal(isInactivitySuppressed("s1"), false);
  clearInactivitySuppression();
});

test("inactivity suppression clear resets all refs", async () => {
  const { addInactivitySuppression, removeInactivitySuppression, isInactivitySuppressed, clearInactivitySuppression } =
    await import("../dist-electron/cli/inactivitySuppression.js");
  clearInactivitySuppression();
  addInactivitySuppression("s1");
  addInactivitySuppression("s2");
  clearInactivitySuppression();
  assert.equal(isInactivitySuppressed("s1"), false);
  assert.equal(isInactivitySuppressed("s2"), false);
  // after clear, a stray remove does not throw and stays false
  removeInactivitySuppression("s1");
  assert.equal(isInactivitySuppressed("s1"), false);
});
