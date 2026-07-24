import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (rel) =>
  fs.readFileSync(new URL(rel, import.meta.url), "utf8");

test("ChatView opens the host directory picker on web instead of the native dialog", () => {
  const chatView = read("../src/components/CLI/ChatView.tsx");

  assert.match(chatView, /from "\.\/HostDirectoryPicker"/, "imports HostDirectoryPicker");
  assert.match(
    chatView,
    /window\.freebuddy\?\.platform === "web"/,
    "selectWorkspace branches on the web platform"
  );
  assert.match(
    chatView,
    /setWorkspacePickerOpen\(true\)/,
    "web branch opens the picker state"
  );
  assert.match(chatView, /<HostDirectoryPicker/, "renders the picker");
});

test("HostDirectoryPicker fetches the sandboxed list endpoint", () => {
  const picker = read("../src/components/CLI/HostDirectoryPicker.tsx");

  assert.match(picker, /\/api\/listDirs/, "calls /api/listDirs");
  assert.match(picker, /onSelect/, "accepts onSelect callback");
  assert.match(picker, /role="dialog"/, "is an accessible modal");
  assert.match(picker, /parent/, "uses the clamped parent to navigate up");
});

test("RemoteTab manages per-user workspace roots", () => {
  const remoteTab = read("../src/components/Settings/RemoteTab.tsx");

  assert.match(
    remoteTab,
    /listUserRoots\(/,
    "loads roots per user via listUserRoots"
  );
  assert.match(
    remoteTab,
    /setUserRoots\(/,
    "persists roots per user via setUserRoots"
  );
  assert.match(remoteTab, /handleAddRoot/, "can add a root");
  assert.match(remoteTab, /handleRemoveRoot/, "can remove a root");
  assert.match(remoteTab, /selectRootsUser/, "can switch the targeted user");
});
