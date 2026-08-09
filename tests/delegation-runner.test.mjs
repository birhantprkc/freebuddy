import "./fixtures/electron-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";

test("summarizeDelegateOutput joins assistant text items", async () => {
  const { summarizeDelegateOutput } = await import("../dist-electron/cli/delegationRunner.js");
  const items = [
    { kind: "text", role: "assistant", content: "hello " },
    { kind: "thinking", content: "internal" },
    { kind: "text", role: "assistant", content: "world" },
    { kind: "text", role: "user", content: "ignored task echo" },
    { kind: "tool-call", tool: "shell" }
  ];
  assert.equal(summarizeDelegateOutput(items), "hello world");
});

test("summarizeDelegateOutput falls back to tool-count when no assistant text", async () => {
  const { summarizeDelegateOutput } = await import("../dist-electron/cli/delegationRunner.js");
  assert.match(summarizeDelegateOutput([{ kind: "tool-call", tool: "x" }, { kind: "tool-call", tool: "y" }]), /2 tool actions/i);
  assert.ok(summarizeDelegateOutput([]).length > 0);
  // user-only text is NOT treated as output
  assert.match(summarizeDelegateOutput([{ kind: "text", role: "user", content: "task" }]), /no output/i);
});

test("summarizeDelegateOutput truncates very long assistant text", async () => {
  const { summarizeDelegateOutput } = await import("../dist-electron/cli/delegationRunner.js");
  const out = summarizeDelegateOutput([{ kind: "text", role: "assistant", content: "x".repeat(50_000) }]);
  assert.ok(out.length < 50_000);
  assert.match(out, /truncated/);
});
