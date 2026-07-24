import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");

test("conversation data handlers enforce ownership at the boundary", () => {
  const ipc = read("../electron/cli/ipc.ts");

  const getConv = ipc.slice(ipc.indexOf('"cli:getConversation"'));
  assert.match(getConv, /requireOwnedConversation/, "getConversation uses requireOwnedConversation");

  const del = ipc.slice(ipc.indexOf('"cli:deleteConversation"'));
  assert.match(del, /requireOwnedConversation/, "deleteConversation checks ownership");

  const listMsgs = ipc.slice(ipc.indexOf('"cli:listMessages"'));
  assert.match(listMsgs, /requireOwnedConversation/, "listMessages checks ownership");

  const append = ipc.slice(ipc.indexOf('"cli:appendMessage"'));
  assert.match(append, /requireOwnedConversation/, "appendMessage checks ownership");

  const run = ipc.slice(ipc.indexOf('"cli:run"'));
  assert.match(run, /requireOwnedConversation/, "run checks conversation ownership");
});

test("the remote invoke bridge runs handlers under the session user's identity", () => {
  const server = read("../electron/webUIServer.ts");
  assert.match(server, /sessionUserId\(extractBearerToken/, "resolves userId from the bearer token");
  assert.match(server, /sessionUserId\(readSessionCookie/, "resolves userId from the session cookie");
  assert.match(server, /runAsCaller\(userId/, "wraps localInvoke in the caller's identity");
});

test("desktop invokes run under the owner identity", () => {
  const registry = read("../electron/invokeRegistry.ts");
  assert.match(registry, /runAsCaller/, "registerHandler wraps handlers with a caller context");
  assert.match(registry, /getOwnerUser/, "desktop caller resolves to the owner user");
});
