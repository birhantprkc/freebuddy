import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

async function loadGuard() {
  const output = ts.transpileModule(read("../src/store/workflowViewGuard.ts"), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;

  return import(
    `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
  );
}

test("switching conversations invalidates an earlier workflow request", async () => {
  const { WorkflowViewGuard } = await loadGuard();
  const guard = new WorkflowViewGuard();
  const conversationA = guard.select("conversation-a");
  const conversationB = guard.select("conversation-b");

  assert.equal(guard.isCurrent(conversationA), false);
  assert.equal(guard.isCurrent(conversationB), true);
});

test("switching A to B to A still rejects the first A request", async () => {
  const { WorkflowViewGuard } = await loadGuard();
  const guard = new WorkflowViewGuard();
  const firstA = guard.select("conversation-a");
  guard.select("conversation-b");
  const latestA = guard.select("conversation-a");

  assert.equal(guard.isCurrent(firstA), false);
  assert.equal(guard.isCurrent(latestA), true);
});

test("clearing the selected conversation invalidates in-flight requests", async () => {
  const { WorkflowViewGuard } = await loadGuard();
  const guard = new WorkflowViewGuard();
  const selected = guard.select("conversation-a");

  guard.select(null);

  assert.equal(guard.isCurrent(selected), false);
  assert.deepEqual(guard.snapshot(), { conversationId: null, revision: 2 });
});

test("workflow UI only displays state owned by the selected conversation", () => {
  const store = read("../src/store/workflowStore.ts");
  const runPanel = read("../src/components/Workflows/WorkflowRunPanel.tsx");
  const workspacePanel = read("../src/components/CLI/WorkspacePanel.tsx");

  assert.match(store, /workflowViewGuard\.isCurrent\(viewToken\)/);
  assert.match(runPanel, /storeActiveRun\?\.conversationId === activeId/);
  assert.match(workspacePanel, /activeRun\?\.conversationId === activeId/);
  assert.match(workspacePanel, /clearActiveWorkflowConversation\(\)/);
});
