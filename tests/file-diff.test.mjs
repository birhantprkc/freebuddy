import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { getParser, serializeStreamItemsForPersist } from "@freebuddy/cli-stream";

const output = ts.transpileModule(fs.readFileSync(new URL("../src/utils/fileDiff.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }
}).outputText;
const { buildFileDiff, collectFileEdits, foldDiffRows } = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
const edit = (fields) => ({ kind: "file-edit", path: "src/a.ts", action: "update", ...fields });

test("diff preserves context, exact line numbers, and added/removed counts", () => {
  const diff = buildFileDiff(edit({ oldText: "first\nold\nlast\n", newText: "first\nnew\nextra\nlast\n" }));
  assert.equal(diff.added, 2);
  assert.equal(diff.removed, 1);
  assert.deepEqual(diff.rows.map((r) => [r.kind, r.oldLine, r.newLine]), [
    ["context", 1, 1], ["delete", 2, undefined], ["add", undefined, 2], ["add", undefined, 3], ["context", 3, 4]
  ]);
});

test("new and deleted files use empty baselines, but missing content does not", () => {
  assert.equal(buildFileDiff(edit({ action: "create", newText: "a\nb\n" })).added, 2);
  assert.equal(buildFileDiff(edit({ action: "delete", oldText: "a\n" })).removed, 1);
  assert.equal(buildFileDiff(edit({ newText: "a" })).notice, "missing");
  assert.equal(buildFileDiff(edit({ action: "create", newText: "" })).rows.length, 0);
});

test("unified patches use hunk offsets and preserve plus/minus lines", () => {
  const diff = buildFileDiff(edit({ patch: "--- a/a.ts\n+++ b/a.ts\n@@ -10,2 +20,2 @@\n---old\n+++new\n same\n" }));
  assert.equal(diff.added, 1);
  assert.equal(diff.removed, 1);
  assert.deepEqual(diff.rows.find((r) => r.kind === "delete"), { kind: "delete", text: "--old", oldLine: 10 });
  assert.equal(diff.rows.find((r) => r.kind === "add").newLine, 20);
  assert.equal(buildFileDiff(edit({ patch: "*** Begin Patch\n*** End Patch" })).notice, "raw");
});

test("truncation and excessive diff work are explicit, never fabricated", () => {
  assert.equal(buildFileDiff(edit({ oldText: "a", newText: "b", truncated: true })).notice, "truncated");
  assert.equal(buildFileDiff(edit({ patch: "abc\n…[truncated]" })).notice, "truncated");
  assert.equal(buildFileDiff(edit({ oldText: "a\n".repeat(1500), newText: "b\n".repeat(1500) })).notice, "large");
});

test("EOF newline changes remain visible and unchanged runs can be expanded", () => {
  const diff = buildFileDiff(edit({ oldText: "a", newText: "a\n" }));
  assert.ok(diff.rows.some((r) => r.kind === "meta"));
  const unchanged = Array.from({ length: 20 }, (_, i) => ({ kind: "context", text: String(i) }));
  const folded = foldDiffRows(unchanged);
  assert.equal(folded.length, 7);
  assert.deepEqual(folded[3], { kind: "fold", count: 14 });
  assert.equal(unchanged.length, 20);
});

test("persisted file edits explicitly mark shortened content", () => {
  const saved = JSON.parse(serializeStreamItemsForPersist([edit({ oldText: "x".repeat(20_000), newText: "y" })]));
  const change = saved.find((item) => item.kind === "file-edit");
  assert.equal(change.truncated, true);
  assert.equal(buildFileDiff(change).notice, "truncated");
});

test("nested ACP diffs are collected while failed and pending tools are excluded", () => {
  const changes = collectFileEdits([
    { kind: "tool-call", id: "ok", tool: "edit", status: "completed", toolOutputs: [edit({ newText: "x" })] },
    { kind: "tool-call", id: "bad", tool: "edit", status: "failed", toolOutputs: [edit({})] },
    { kind: "tool-call", id: "pending", tool: "edit", status: "pending", toolOutputs: [edit({})] },
    edit({ status: "pending" }), edit({ status: "failed" })
  ]);
  assert.equal(changes.length, 1);
});

test("Claude Edit shows successful snippets without claiming complete file content", () => {
  const call = { kind: "tool-call", tool: "Edit", id: "edit-1", input: { file_path: "a.ts", old_string: "before", new_string: "after" } };
  assert.equal(collectFileEdits([call]).length, 0);
  assert.equal(collectFileEdits([call, { kind: "tool-result", id: "edit-1", isError: true }]).length, 0);
  const [change] = collectFileEdits([call, { kind: "tool-result", id: "edit-1", content: "ok" }]);
  assert.equal(change.partial, true);
  assert.equal(change.oldText, "before");
});

test("Codex completed file changes reach the diff model; failed changes stay excluded", () => {
  const parser = getParser("codex-json");
  const event = { type: "item.completed", item: { type: "file_change", status: "completed", changes: [{ path: "a.ts", kind: "add" }] } };
  const items = parser.parseStdoutLine(JSON.stringify(event), {});
  assert.equal(items[0].action, "create");
  assert.equal(collectFileEdits(items).length, 1);
  event.item.status = "failed";
  assert.equal(collectFileEdits(parser.parseStdoutLine(JSON.stringify(event), {})).length, 0);
});
