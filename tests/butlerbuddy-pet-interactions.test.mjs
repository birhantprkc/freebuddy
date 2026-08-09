import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

async function loadInteractions() {
  const source = fs.readFileSync(
    new URL(
      "../src/components/ButlerBuddy/petInteractions.ts",
      import.meta.url
    ),
    "utf8"
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
  );
}

test("pointer release distinguishes click from drag at the configured threshold", async () => {
  const { classifyPetPointerRelease, PET_DRAG_THRESHOLD_PX } =
    await loadInteractions();

  assert.equal(
    classifyPetPointerRelease({ x: 10, y: 10 }, { x: 11, y: 11 }),
    "click"
  );
  assert.equal(
    classifyPetPointerRelease(
      { x: 10, y: 10 },
      { x: 10 + PET_DRAG_THRESHOLD_PX, y: 10 }
    ),
    "drag"
  );
  assert.equal(
    classifyPetPointerRelease({ x: -20, y: 5 }, { x: 30, y: 50 }),
    "drag"
  );
});

test("click classification queues a pat, promotes a double click to poke, and honors cooldown", async () => {
  const { classifyPetClick } = await loadInteractions();

  assert.equal(classifyPetClick(1, false), "queue-pat");
  assert.equal(classifyPetClick(2, false), "poke");
  assert.equal(classifyPetClick(3, false), "poke");
  assert.equal(classifyPetClick(1, true), "ignore");
  assert.equal(classifyPetClick(2, true), "ignore");
});

test("interaction cooldown includes its boundary", async () => {
  const { isPetInteractionCoolingDown, PET_INTERACTION_COOLDOWN_MS } =
    await loadInteractions();

  assert.equal(isPetInteractionCoolingDown(null, 1_000), false);
  assert.equal(isPetInteractionCoolingDown(1_000, 1_399), true);
  assert.equal(
    isPetInteractionCoolingDown(
      1_000,
      1_000 + PET_INTERACTION_COOLDOWN_MS
    ),
    false
  );
});
