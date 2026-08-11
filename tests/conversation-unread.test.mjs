import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

async function loadModule() {
  const source = fs.readFileSync(
    new URL("../src/store/conversationUnread.ts", import.meta.url),
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

test("unread conversation storage migrates legacy ids and persists completion metadata", async () => {
  const values = new Map();
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };

  try {
    const mod = await loadModule();
    values.set("freebuddy.conversations.unread.v1", JSON.stringify(["legacy"]));
    assert.deepEqual(mod.loadUnreadConversations(), {
      legacy: {
        kind: "message",
        at: "1970-01-01T00:00:00.000Z"
      }
    });

    const unread = {
      success: {
        kind: "success",
        at: "2026-08-09T08:00:00.000Z"
      },
      failure: {
        kind: "failure",
        at: "2026-08-09T09:00:00.000Z"
      }
    };
    mod.persistUnreadConversations(unread);
    assert.deepEqual(
      JSON.parse(values.get("freebuddy.conversations.unread.v1")),
      unread
    );
    assert.deepEqual(mod.loadUnreadConversations(), unread);
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  }
});

test("active conversations in background/unfocused windows are marked as unread", () => {
  const store = fs.readFileSync(
    new URL("../src/store/conversationStore.ts", import.meta.url),
    "utf8"
  );
  const app = fs.readFileSync(
    new URL("../src/App.tsx", import.meta.url),
    "utf8"
  );
  const appFocus = fs.readFileSync(
    new URL("../src/utils/appFocus.ts", import.meta.url),
    "utf8"
  );

  assert.match(appFocus, /export function isAppInBackground/);
  assert.match(appFocus, /window\.addEventListener\("blur"/);
  assert.match(appFocus, /window\.addEventListener\("focus"/);
  assert.match(store, /get\(\)\.activeId === id && !isAppInBackground\(\)/);
  assert.match(app, /window\.addEventListener\("focus", handleFocus\)/);
  assert.match(app, /state\.markConversationRead\(state\.activeId\)/);
});

