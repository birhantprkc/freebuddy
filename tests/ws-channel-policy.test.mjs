import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

async function loadPolicy() {
  const source = fs.readFileSync(
    new URL("../electron/shared/wsChannelPolicy.ts", import.meta.url),
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

test("classifyWsChannel routes global, session-scoped, and desktop-only channels", async () => {
  const { classifyWsChannel } = await loadPolicy();

  assert.deepEqual(classifyWsChannel("cli://runtime"), { kind: "global" });
  assert.deepEqual(classifyWsChannel("infoCards://changed"), { kind: "global" });
  assert.deepEqual(classifyWsChannel("conversations://changed"), { kind: "global" });
  assert.deepEqual(classifyWsChannel("messages://changed"), { kind: "global" });

  assert.deepEqual(classifyWsChannel("cli://abc-123"), {
    kind: "session",
    sessionId: "abc-123"
  });

  assert.deepEqual(classifyWsChannel("cli://install"), { kind: "drop" });
  assert.deepEqual(classifyWsChannel("window:chrome"), { kind: "drop" });
  assert.deepEqual(classifyWsChannel("freebuddy://bridge"), { kind: "drop" });
  assert.deepEqual(classifyWsChannel("freebuddy://draft-tool"), { kind: "drop" });
  assert.deepEqual(classifyWsChannel("updater://event"), { kind: "drop" });
  assert.deepEqual(classifyWsChannel("unknown://whatever"), { kind: "drop" });
});
