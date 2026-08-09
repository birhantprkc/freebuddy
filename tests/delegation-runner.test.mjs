import "./fixtures/electron-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";

test("summarizeDelegateOutput joins assistant text items", async () => {
  const { summarizeDelegateOutput } = await import("../dist-electron/cli/delegationRunner.js");
  const items = [
    { type: "text", text: "hello " },
    { type: "thinking", text: "internal" },
    { type: "text", text: "world" },
    { type: "tool_call" }
  ];
  assert.equal(summarizeDelegateOutput(items), "hello world");
});

test("summarizeDelegateOutput falls back when no text", async () => {
  const { summarizeDelegateOutput } = await import("../dist-electron/cli/delegationRunner.js");
  assert.match(summarizeDelegateOutput([{ type: "tool_call" }]), /tool action/i);
  assert.ok(summarizeDelegateOutput([]).length > 0);
});

test("summarizeDelegateOutput truncates very long text", async () => {
  const { summarizeDelegateOutput } = await import("../dist-electron/cli/delegationRunner.js");
  const out = summarizeDelegateOutput([{ type: "text", text: "x".repeat(50_000) }]);
  assert.ok(out.length < 50_000);
  assert.match(out, /truncated/);
});
