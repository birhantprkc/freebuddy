import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

async function loadEntertainmentModule() {
  const source = fs.readFileSync(
    new URL("../electron/butlerBuddyEntertainment.ts", import.meta.url),
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

function createPet(bounds) {
  const calls = [];
  return {
    calls,
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
    getBounds() {
      return { ...bounds };
    },
    setBounds(nextBounds, animate) {
      calls.push({ bounds: nextBounds, animate });
      bounds = nextBounds;
    }
  };
}

test("entertainment transition expands and restores the pet around its actor", async () => {
  const {
    applyButlerBuddyEntertainmentTransition,
    BUTLER_PET_ARCADE_HEIGHT,
    BUTLER_PET_ARCADE_WIDTH,
    BUTLER_PET_SIZE
  } = await loadEntertainmentModule();
  const pet = createPet({ x: 900, y: 400, width: 108, height: 108 });
  const effects = [];
  const dependencies = {
    pet,
    getWorkArea: () => ({ x: 0, y: 0, width: 1_200, height: 800 }),
    hideChat: () => effects.push("hide-chat"),
    syncChatPosition: () => effects.push("sync-chat")
  };

  assert.equal(
    applyButlerBuddyEntertainmentTransition({
      ...dependencies,
      enabled: true,
      previousEnabled: false
    }),
    true
  );
  assert.deepEqual(pet.calls[0], {
    bounds: {
      x: 774,
      y: 210,
      width: BUTLER_PET_ARCADE_WIDTH,
      height: BUTLER_PET_ARCADE_HEIGHT
    },
    animate: false
  });
  assert.deepEqual(effects, ["hide-chat", "sync-chat"]);

  effects.length = 0;
  assert.equal(
    applyButlerBuddyEntertainmentTransition({
      ...dependencies,
      enabled: false,
      previousEnabled: true
    }),
    true
  );
  assert.deepEqual(pet.calls[1], {
    bounds: { x: 900, y: 400, width: BUTLER_PET_SIZE, height: BUTLER_PET_SIZE },
    animate: false
  });
  assert.deepEqual(
    effects,
    ["sync-chat"],
    "leaving entertainment should not hide a chat that is already hidden"
  );
});

test("entertainment bounds remain inside the active display", async () => {
  const { calculateButlerBuddyEntertainmentBounds } =
    await loadEntertainmentModule();

  assert.deepEqual(
    calculateButlerBuddyEntertainmentBounds(
      { x: 980, y: 690, width: 108, height: 108 },
      { x: 100, y: 50, width: 1_000, height: 700 },
      true,
      false
    ),
    { x: 740, y: 450, width: 360, height: 300 }
  );
});

test("entertainment preference changes persist once and invoke the transition", async () => {
  const { persistButlerBuddyEntertainmentChange } =
    await loadEntertainmentModule();
  const persisted = [];
  const transitions = [];
  const dependencies = {
    persist: (enabled) => persisted.push(String(enabled)),
    applyTransition: (enabled, previousEnabled) =>
      transitions.push({ enabled, previousEnabled })
  };

  assert.equal(
    persistButlerBuddyEntertainmentChange({
      ...dependencies,
      enabled: true,
      previousEnabled: false
    }),
    true
  );
  assert.deepEqual(persisted, ["true"]);
  assert.deepEqual(transitions, [{ enabled: true, previousEnabled: false }]);

  assert.equal(
    persistButlerBuddyEntertainmentChange({
      ...dependencies,
      enabled: true,
      previousEnabled: true
    }),
    false
  );
  assert.deepEqual(persisted, ["true"]);
  assert.equal(transitions.length, 1);
});

test("preference broadcasts reach every live ButlerBuddy surface", async () => {
  const { broadcastButlerBuddyPreferences } = await loadEntertainmentModule();
  const preferences = { entertainmentEnabled: true };
  const sent = [];
  const createWindow = (id, destroyed = false) => ({
    webContents: { id },
    isDestroyed: () => destroyed
  });

  broadcastButlerBuddyPreferences(
    [createWindow("main"), createWindow("pet"), createWindow("chat"), null],
    preferences,
    (webContents, channel, payload) =>
      sent.push({ id: webContents.id, channel, payload })
  );

  assert.deepEqual(
    sent.map(({ id }) => id),
    ["main", "pet", "chat"]
  );
  assert.ok(
    sent.every(
      ({ channel, payload }) =>
        channel === "butlerBuddy:preferencesChanged" && payload === preferences
    )
  );

  sent.length = 0;
  broadcastButlerBuddyPreferences(
    [createWindow("destroyed", true)],
    preferences,
    (webContents) => sent.push(webContents)
  );
  assert.deepEqual(sent, []);
});
