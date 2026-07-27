import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("project form modal and sidebar wiring expose create/edit project UI", () => {
  const list = read("../src/components/CLI/ConversationList.tsx");
  const modal = read("../src/components/CLI/ProjectFormModal.tsx");
  const store = read("../src/store/projectStore.ts");
  const newTask = read("../src/store/newTaskUiStore.ts");
  const app = read("../src/App.tsx");
  const en = JSON.parse(read("../src/locales/en.json"));
  const zh = JSON.parse(read("../src/locales/zh-CN.json"));
  const css = read("../styles.css");

  assert.match(list, /conv-projects-add/);
  assert.match(list, /groupConversationsByProjects/);
  assert.match(list, /<ProjectFormModal/);
  assert.match(list, /conversations\.editProject/);
  assert.match(list, /conversations\.deleteProject/);
  assert.match(list, /onNewTaskInProject\(\{\s*cwd:\s*primaryPath,\s*projectId:\s*project\.projectId/);
  assert.doesNotMatch(list, /groupConversationsByProject\(/);

  assert.match(modal, /mode:\s*"create"\s*\|\s*"edit"/);
  assert.match(modal, /cliClient\.selectDirectory/);
  assert.match(modal, /conversations\.sourceFolders/);
  assert.match(modal, /conversations\.primary/);
  assert.match(modal, /conversations\.addFolder/);

  assert.match(store, /remapPins\(projects\)/);
  assert.match(store, /cliClient\.listProjects/);
  assert.match(store, /cliClient\.createProject/);
  assert.match(store, /cliClient\.deleteProject/);

  assert.match(newTask, /requestedProjectId\?:/);
  assert.match(newTask, /requestNewTask\(options\?:/);
  assert.match(app, /projectId:\s*options\?\.projectId/);
  assert.match(app, /onNewTaskInProject=\{\(\{\s*cwd,\s*projectId\s*\}\)/);

  for (const key of [
    "newProject",
    "editProject",
    "addProject",
    "sourceFolders",
    "addFolder",
    "primary",
    "deleteProject",
    "saveProject",
    "projectNameRequired",
    "projectFoldersRequired"
  ]) {
    assert.ok(en.conversations?.[key], `missing en conversations.${key}`);
    assert.ok(zh.conversations?.[key], `missing zh-CN conversations.${key}`);
  }

  assert.equal(zh.conversations.newProject, "新建项目");
  assert.equal(zh.conversations.editProject, "编辑项目");
  assert.equal(en.conversations.addFolder, "Add folder");
  assert.match(css, /\.conv-projects-add\s*\{/);
  assert.match(css, /\.project-form-modal\s*\{/);
});
