import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");

test("the WS broadcaster only delivers session events to the owning user", () => {
  const server = read("../electron/webUIServer.ts");

  assert.match(server, /classifyWsChannel\(channel\)/, "broadcaster classifies the channel");
  assert.match(server, /classified\.kind === "drop"/, "drops desktop-only channels");
  assert.match(server, /getSessionOwner\(classified\.sessionId\)/, "looks up the session owner");
  assert.match(
    server,
    /owner !== clientUsers\.get\(client\)/,
    "skips clients whose user does not own the session"
  );
  assert.match(
    server,
    /sessionUserId\(token\)/,
    "attaches the session userId to each WS connection on auth"
  );
});

test("run records the session owner and kill clears it", () => {
  const ipc = read("../electron/cli/ipc.ts");

  const run = ipc.slice(ipc.indexOf('"cli:run"'));
  assert.match(run, /recordSessionOwner\(/, "run records the session owner");

  const kill = ipc.slice(ipc.indexOf('"cli:kill"'));
  assert.match(kill, /clearSessionOwner\(/, "kill clears the session owner");
});
