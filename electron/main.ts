import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, Notification, protocol, screen, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { shellEnv } from "shell-env";

import { registerCliIpc } from "./cli/ipc.js";
import { logAllCliRuntimes, startCodexToolchainAutoUpdate } from "./cli/check.js";
import { safeSendToWebContents } from "./cli/ipcSend.js";
import { handleFreebuddyFileRequest } from "./freebuddyFileProtocol.js";
import { handleDraftRequest } from "./draftProtocol.js";
import { startPreviewServer } from "./previewServer.js";
import { startWebUIServer } from "./webUIServer.js";
import { setLocalInvokeWindowGetter } from "./invokeRegistry.js";
import { setButlerAppWindowGetter } from "./butlerToolService.js";
import { ensureOwnerUser, getOwnerUser } from "./cli/users.js";
import { bindConversationNotifier } from "./cli/conversations.js";
import { applyOwnerBackfill } from "./cli/ownerBackfill.js";
import { initFileBridge } from "./fileBridge.js";
import { getDb } from "./cli/db.js";
import { getSetting, setSetting } from "./cli/settings.js";
import {
  initRemoteControl,
  getConfiguredBindMode,
  getConfiguredPort
} from "./cli/remoteControl.js";
import { cleanupOrphanManagedAttachments } from "./cli/attachments.js";
import { seedBuiltinWorkflowTeams } from "./cli/workflowTeams.js";
import { seedBuiltinSkills } from "./cli/skills.js";
import { initApplicationMenu, setupContextMenu } from "./menu.js";
import { APP_NAME, APP_VERSION } from "./app-meta.js";
import { initAutoUpdater, registerUpdaterIpc } from "./updater.js";
import { initializeScheduledTaskScheduler } from "./cli/scheduledTasks.js";
import { initializeTelemetry, shutdownTelemetry } from "./telemetry.js";
import { getFreshWindowsEnvironment } from "./cli/windowsEnv.js";
import { initializeAgentUsageReconciler } from "./cli/usageReconciler.js";
import { initDebugLog, logMain } from "./debugLog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

app.setName(APP_NAME);
app.setAppUserModelId("dev.freebuddy.app");
process.env.FB_APP_VERSION = APP_VERSION;
app.setAboutPanelOptions({
  applicationName: APP_NAME,
  applicationVersion: APP_VERSION,
  version: APP_VERSION
});

const PROTOCOL = "freebuddy";

function handleSchemeUrl(raw: string) {
  try {
    const parsed = new URL(raw);
    const action = parsed.hostname || parsed.pathname.replace(/^\//, "");
    if (action === "preview" && mainWindow && !mainWindow.isDestroyed()) {
      safeSendToWebContents(mainWindow.webContents, "freebuddy://bridge", {
        action: "preview",
        params: {}
      });
    }
  } catch {
    // ignore malformed scheme urls
  }
}

if (app.isPackaged && !app.isDefaultProtocolClient(PROTOCOL)) {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  handleSchemeUrl(url);
});

app.on("second-instance", (_event, argv) => {
  const url = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
  if (url) handleSchemeUrl(url);
});

function resolveAppIconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app-icon.png")
    : path.join(__dirname, "../assets/app-icon.png");
}

function loadAppIcon() {
  const icon = nativeImage.createFromPath(resolveAppIconPath());
  return icon.isEmpty() ? undefined : icon;
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "freebuddy-file",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true
    }
  },
  {
    scheme: "freebuddy-draft",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true
    }
  }
]);

function registerLocalFileProtocol() {
  protocol.handle("freebuddy-file", handleFreebuddyFileRequest);
}

function registerDraftProtocol() {
  protocol.handle("freebuddy-draft", handleDraftRequest);
}

async function injectShellPath() {
  if (process.platform === "win32") {
    // On Windows, Electron launched from shortcuts may not inherit the full
    // user PATH. Ensure common npm/node binary directories are present so
    // `where` can find globally-installed CLI agents like codex-acp.
    try {
      const freshEnv = await getFreshWindowsEnvironment(process.env);
      if (freshEnv.PATH) process.env.PATH = freshEnv.PATH;
      const appData = process.env.APPDATA;
      const localAppData = process.env.LOCALAPPDATA;
      const userProfile = process.env.USERPROFILE || process.env.HOME || "";
      const extraDirs: string[] = [];

      // npm global bin directory (%APPDATA%\npm)
      if (appData) extraDirs.push(path.join(appData, "npm"));

      // pnpm global bin
      if (localAppData) extraDirs.push(path.join(localAppData, "pnpm"));

      // fnm shims
      if (localAppData) extraDirs.push(path.join(localAppData, "fnm_multishells"));

      // nvm-windows current
      if (process.env.NVM_SYMLINK) extraDirs.push(process.env.NVM_SYMLINK);
      if (process.env.NVM_HOME) extraDirs.push(process.env.NVM_HOME);

      // Scoop shims
      if (userProfile) extraDirs.push(path.join(userProfile, "scoop", "shims"));

      const currentPath = process.env.PATH || "";
      const currentLower = currentPath.toLowerCase();
      const missing = extraDirs.filter(
        (d) => d && !currentLower.includes(d.toLowerCase())
      );
      if (missing.length) {
        process.env.PATH = [...missing, currentPath].join(";");
      }
    } catch {
      /* best-effort */
    }
    return;
  }
  try {
    const env = await shellEnv();
    for (const [k, v] of Object.entries(env)) {
      if (typeof v === "string" && !process.env[k]) {
        process.env[k] = v;
      }
    }
    if (env.PATH) process.env.PATH = env.PATH;
  } catch {
    /* best-effort */
  }

  // Desktop launchers do not consistently inherit version-manager paths.
  // Keep these deterministic user-level locations available even when Bash
  // chooses .bash_profile over .profile or the desktop session has a stale PATH.
  try {
    const home = process.env.HOME || "";
    if (!home) return;
    const extraDirs = [
      path.join(home, ".volta", "bin"),
      path.join(home, ".local", "bin"),
      path.join(home, ".npm-global", "bin"),
      path.join(home, ".bun", "bin")
    ].filter((dir) => fs.existsSync(dir));
    const currentPath = process.env.PATH || "";
    const entries = new Set(currentPath.split(path.delimiter).filter(Boolean));
    const missing = extraDirs.filter((dir) => !entries.has(dir));
    if (missing.length) {
      process.env.PATH = [...missing, currentPath]
        .filter(Boolean)
        .join(path.delimiter);
    }
  } catch {
    /* best-effort */
  }
}

let mainWindow: BrowserWindow | null = null;
let butlerPetWindow: BrowserWindow | null = null;
let butlerChatWindow: BrowserWindow | null = null;

const BUTLER_PET_SIZE = 108;
const BUTLER_CHAT_WIDTH = 360;
const BUTLER_CHAT_HEIGHT = 420;
const BUTLER_WINDOW_GAP = 6;
const BUTLER_VISIBLE_SETTING = "butlerbuddy.visible";
const BUTLER_SHORTCUT_ENABLED_SETTING = "butlerbuddy.shortcut.enabled";
const BUTLER_SHORTCUT_SETTING = "butlerbuddy.shortcut";
const BUTLER_DEFAULT_SHORTCUT = "CommandOrControl+Shift+Space";

type ButlerBuddyPreferences = {
  visible: boolean;
  shortcutEnabled: boolean;
  shortcut: string;
  shortcutRegistered: boolean;
  error?: "shortcutUnavailable";
};

let registeredButlerShortcut: string | null = null;
let butlerShortcutError: "shortcutUnavailable" | undefined;

function readButlerBuddyPreferences(): ButlerBuddyPreferences {
  const visible = getSetting(BUTLER_VISIBLE_SETTING) !== "false";
  const shortcutEnabled =
    getSetting(BUTLER_SHORTCUT_ENABLED_SETTING) !== "false";
  const shortcut =
    getSetting(BUTLER_SHORTCUT_SETTING)?.trim() || BUTLER_DEFAULT_SHORTCUT;
  return {
    visible,
    shortcutEnabled,
    shortcut,
    shortcutRegistered:
      shortcutEnabled &&
      registeredButlerShortcut === shortcut &&
      globalShortcut.isRegistered(shortcut),
    error: butlerShortcutError
  };
}

function companionWebPreferences() {
  return {
    preload: path.join(__dirname, "preload.js"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false
  };
}

function loadCompanionSurface(
  win: BrowserWindow,
  surface: "butler-pet" | "butler-chat"
) {
  if (isDev) {
    const url = new URL(process.env.VITE_DEV_SERVER_URL as string);
    url.searchParams.set("surface", surface);
    void win.loadURL(url.toString());
    return;
  }
  void win.loadFile(path.join(__dirname, "../dist/index.html"), {
    query: { surface }
  });
}

function initialButlerPetBounds() {
  const workArea = screen.getPrimaryDisplay().workArea;
  return {
    width: BUTLER_PET_SIZE,
    height: BUTLER_PET_SIZE,
    x: workArea.x + workArea.width - BUTLER_PET_SIZE - 18,
    y: workArea.y + Math.round((workArea.height - BUTLER_PET_SIZE) / 2)
  };
}

function syncButlerChatPosition() {
  const pet = butlerPetWindow;
  const chat = butlerChatWindow;
  if (!pet || pet.isDestroyed() || !chat || chat.isDestroyed()) return;

  const petBounds = pet.getBounds();
  const workArea = screen.getDisplayMatching(petBounds).workArea;
  let x = petBounds.x - BUTLER_CHAT_WIDTH - BUTLER_WINDOW_GAP;
  if (x < workArea.x + 8) {
    x = petBounds.x + petBounds.width + BUTLER_WINDOW_GAP;
  }
  const idealY = petBounds.y - Math.round((BUTLER_CHAT_HEIGHT - petBounds.height) / 2);
  const y = Math.max(
    workArea.y + 8,
    Math.min(idealY, workArea.y + workArea.height - BUTLER_CHAT_HEIGHT - 8)
  );
  chat.setPosition(Math.round(x), Math.round(y), false);
}

function hideButlerChat() {
  if (butlerChatWindow && !butlerChatWindow.isDestroyed()) {
    butlerChatWindow.hide();
  }
}

// The pet and chat move as a rigid group: dragging either translates both by
// the same delta, preserving whatever offset the user chose.
//
// Both surfaces only signal begin/end (via pointer events in their renderers);
// this poll drives the actual movement so the transparent, non-focusable pet
// window doesn't need to receive pointermove on Windows. The poll moves BOTH
// windows directly, so no `move`-event listener is used — relying on `move`
// events here previously caused the pet to drift away from the chat, because
// on Windows `getBounds()` immediately after `setPosition` can return stale
// bounds and the async move event then double-translated the pet.
let butlerDragCursor: { x: number; y: number } | null = null;
let butlerDragPetOrigin: { x: number; y: number } | null = null;
let butlerDragChatOrigin: { x: number; y: number } | null = null;
let butlerDragTimer: ReturnType<typeof setInterval> | null = null;

function applyButlerPetDrag() {
  if (!butlerDragCursor || !butlerDragPetOrigin) return;
  const pet = butlerPetWindow;
  if (!pet || pet.isDestroyed()) {
    stopButlerPetDrag();
    return;
  }
  const c = screen.getCursorScreenPoint();
  const dx = c.x - butlerDragCursor.x;
  const dy = c.y - butlerDragCursor.y;
  pet.setPosition(butlerDragPetOrigin.x + dx, butlerDragPetOrigin.y + dy);
  const chat = butlerChatWindow;
  if (chat && !chat.isDestroyed() && butlerDragChatOrigin) {
    chat.setPosition(butlerDragChatOrigin.x + dx, butlerDragChatOrigin.y + dy);
  }
}

function startButlerPetDrag() {
  const pet = butlerPetWindow;
  if (!pet || pet.isDestroyed() || butlerDragCursor) return;
  const [px, py] = pet.getPosition();
  butlerDragCursor = screen.getCursorScreenPoint();
  butlerDragPetOrigin = { x: px, y: py };
  const chat = butlerChatWindow;
  if (chat && !chat.isDestroyed()) {
    const [cx, cy] = chat.getPosition();
    butlerDragChatOrigin = { x: cx, y: cy };
  } else {
    butlerDragChatOrigin = null;
  }
  if (butlerDragTimer) clearInterval(butlerDragTimer);
  butlerDragTimer = setInterval(applyButlerPetDrag, 1000 / 60);
}

function stopButlerPetDrag() {
  butlerDragCursor = null;
  butlerDragPetOrigin = null;
  butlerDragChatOrigin = null;
  if (butlerDragTimer) {
    clearInterval(butlerDragTimer);
    butlerDragTimer = null;
  }
}

function toggleButlerChat() {
  const chat = butlerChatWindow;
  if (!chat || chat.isDestroyed()) return;
  if (chat.isVisible()) {
    chat.hide();
    return;
  }
  syncButlerChatPosition();
  chat.show();
  chat.focus();
}

function updateButlerShortcutRegistration(
  enabled: boolean,
  shortcut: string
): "shortcutUnavailable" | undefined {
  if (!enabled) {
    if (registeredButlerShortcut) {
      globalShortcut.unregister(registeredButlerShortcut);
      registeredButlerShortcut = null;
    }
    butlerShortcutError = undefined;
    return;
  }

  if (
    registeredButlerShortcut === shortcut &&
    globalShortcut.isRegistered(shortcut)
  ) {
    butlerShortcutError = undefined;
    return;
  }

  try {
    if (!globalShortcut.register(shortcut, toggleButlerChat)) {
      butlerShortcutError = "shortcutUnavailable";
      return butlerShortcutError;
    }
  } catch {
    butlerShortcutError = "shortcutUnavailable";
    return butlerShortcutError;
  }

  if (registeredButlerShortcut && registeredButlerShortcut !== shortcut) {
    globalShortcut.unregister(registeredButlerShortcut);
  }
  registeredButlerShortcut = shortcut;
  butlerShortcutError = undefined;
}

function applyButlerBuddyVisibility(visible: boolean) {
  const pet = butlerPetWindow;
  if (!pet || pet.isDestroyed()) return;
  if (visible) {
    pet.showInactive();
    return;
  }
  hideButlerChat();
  pet.hide();
}

function updateButlerBuddyPreferences(
  input: Partial<Pick<ButlerBuddyPreferences, "visible" | "shortcutEnabled" | "shortcut">>
): ButlerBuddyPreferences {
  const current = readButlerBuddyPreferences();
  const nextVisible = input.visible ?? current.visible;
  const nextEnabled = input.shortcutEnabled ?? current.shortcutEnabled;
  const nextShortcut = input.shortcut?.trim() || current.shortcut;
  const shortcutChanged =
    nextEnabled !== current.shortcutEnabled || nextShortcut !== current.shortcut;

  if (shortcutChanged) {
    const error = updateButlerShortcutRegistration(nextEnabled, nextShortcut);
    if (error) return { ...current, error };
    setSetting(BUTLER_SHORTCUT_ENABLED_SETTING, String(nextEnabled));
    setSetting(BUTLER_SHORTCUT_SETTING, nextShortcut);
  }

  if (nextVisible !== current.visible) {
    setSetting(BUTLER_VISIBLE_SETTING, String(nextVisible));
    applyButlerBuddyVisibility(nextVisible);
  }

  const result = readButlerBuddyPreferences();
  // Push the new preferences to the main window so the settings toggle stays
  // in sync when the change originated from the main process (e.g. the pet's
  // right-click "关闭宠物" menu). Renderer-initiated updates already reflect
  // the IPC return value; this broadcast is idempotent for them.
  const win = mainWindow;
  if (win && !win.isDestroyed()) {
    safeSendToWebContents(win.webContents, "butlerBuddy:preferencesChanged", result);
  }
  return result;
}

function closeButlerBuddyWindows() {
  if (butlerChatWindow && !butlerChatWindow.isDestroyed()) {
    butlerChatWindow.close();
  }
  if (butlerPetWindow && !butlerPetWindow.isDestroyed()) {
    butlerPetWindow.close();
  }
  butlerChatWindow = null;
  butlerPetWindow = null;
}

function createButlerBuddyWindows() {
  if (butlerPetWindow && !butlerPetWindow.isDestroyed()) return;

  butlerChatWindow = new BrowserWindow({
    width: BUTLER_CHAT_WIDTH,
    height: BUTLER_CHAT_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: companionWebPreferences()
  });
  butlerChatWindow.setAlwaysOnTop(true, "floating");
  butlerChatWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  butlerChatWindow.on("close", () => {
    butlerChatWindow = null;
  });
  loadCompanionSurface(butlerChatWindow, "butler-chat");
  if (isDev) {
    // Detached DevTools so the companion renderer can be inspected when
    // debugging the floating chat (stream/done delivery, store state, etc.).
    butlerChatWindow.webContents.once("dom-ready", () => {
      butlerChatWindow?.webContents.openDevTools({ mode: "detach" });
    });
  }

  butlerPetWindow = new BrowserWindow({
    ...initialButlerPetBounds(),
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: companionWebPreferences()
  });
  butlerPetWindow.setAlwaysOnTop(true, "floating");
  butlerPetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  butlerPetWindow.on("closed", () => {
    hideButlerChat();
    butlerPetWindow = null;
  });
  butlerPetWindow.once("ready-to-show", () => {
    if (readButlerBuddyPreferences().visible) {
      butlerPetWindow?.showInactive();
    }
  });
  loadCompanionSurface(butlerPetWindow, "butler-pet");
}

function showButlerContextMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: "新会话",
      click: () => {
        const chat = butlerChatWindow;
        if (!chat || chat.isDestroyed()) return;
        if (!chat.isVisible()) {
          syncButlerChatPosition();
          chat.show();
          chat.focus();
        }
        safeSendToWebContents(
          chat.webContents,
          "butlerBuddy:newConversation",
          undefined
        );
      }
    },
    { type: "separator" },
    {
      label: "隐藏聊天面板",
      click: () => hideButlerChat()
    },
    { type: "separator" },
    {
      label: "关闭宠物",
      click: () => updateButlerBuddyPreferences({ visible: false })
    },
    { type: "separator" },
    {
      label: "浮窗与快捷键设置…",
      click: () => {
        const win = mainWindow;
        if (!win || win.isDestroyed()) return;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        safeSendToWebContents(win.webContents, "freebuddy://open-settings", {
          tab: "general"
        });
      }
    }
  ]);
  menu.popup({ window: butlerPetWindow ?? undefined });
}

function registerButlerBuddyWindowIpc() {
  ipcMain.on("butlerBuddy:toggleChat", toggleButlerChat);
  ipcMain.on("butlerBuddy:hideChat", hideButlerChat);
  ipcMain.on("butlerBuddy:beginDrag", startButlerPetDrag);
  ipcMain.on("butlerBuddy:endDrag", stopButlerPetDrag);
  ipcMain.on("butlerBuddy:openMenu", showButlerContextMenu);
  ipcMain.handle("butlerBuddy:getPreferences", () =>
    readButlerBuddyPreferences()
  );
  ipcMain.handle(
    "butlerBuddy:updatePreferences",
    (_event, input: Partial<
      Pick<ButlerBuddyPreferences, "visible" | "shortcutEnabled" | "shortcut">
    >) => updateButlerBuddyPreferences(input)
  );
}

function windowChromeOptions() {
  return process.platform === "darwin"
    ? {
        titleBarStyle: "hiddenInset" as const,
        trafficLightPosition: { x: 14, y: 14 }
      }
    : {};
}

function createWindow() {
  const appIcon = loadAppIcon();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: APP_NAME,
    ...(appIcon ? { icon: appIcon } : {}),
    ...windowChromeOptions(),
    backgroundColor: "#0b1329",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    closeButlerBuddyWindows();
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    logMain().error("crash", "render process gone", {
      reason: details.reason,
      exitCode: details.exitCode
    });
  });
  logMain().info("window", "main window created");

  initApplicationMenu();
  setupContextMenu(mainWindow, isDev);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  const sendChromeVisible = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    safeSendToWebContents(
      mainWindow.webContents,
      "window:chrome",
      !mainWindow.isFullScreen()
    );
  };
  mainWindow.on("enter-full-screen", sendChromeVisible);
  mainWindow.on("leave-full-screen", sendChromeVisible);
  mainWindow.on("maximize", sendChromeVisible);
  mainWindow.on("unmaximize", sendChromeVisible);

  mainWindow.on("focus", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.flashFrame(false);
    }
    if (process.platform === "darwin" && app.dock) {
      app.dock.setBadge("");
    }
  });

  // The app menu is hidden (Menu.setApplicationMenu(null)) and we use
  // titleBarStyle: "hiddenInset", so macOS' default Esc-to-leave-fullscreen
  // shortcut has no menu item to bind to. Restore it manually.
  mainWindow.webContents.on("before-input-event", (_event, input) => {
    if (
      input.type === "keyDown" &&
      input.key === "Escape" &&
      !input.alt &&
      !input.control &&
      !input.meta &&
      !input.shift &&
      mainWindow?.isFullScreen()
    ) {
      mainWindow.setFullScreen(false);
    }
  });

  if (isDev) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL as string);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  createButlerBuddyWindows();
}

type TaskNotificationPayload = {
  kind: "success" | "failure";
  title: string;
  body?: string;
  conversationId?: string;
};

function registerTaskNotificationIpc(): void {
  ipcMain.handle("window:notify", (_event, payload: TaskNotificationPayload) => {
    const win = mainWindow;
    if (!win || win.isDestroyed()) return;

    if (process.platform === "win32") {
      win.flashFrame(true);
    }
    if (process.platform === "darwin" && app.dock) {
      app.dock.bounce("informational");
    }

    try {
      const notification = new Notification({
        title: payload.title,
        body: payload.body ?? "",
        silent: true,
        icon: loadAppIcon()
      });
      notification.on("click", () => {
        if (!win || win.isDestroyed()) return;
        try {
          // Restore from minimized/occluded state and raise to the foreground.
          // On Windows the notification click grants a brief SetForegroundWindow
          // permission to the app; claim it synchronously before focus() loses it.
          if (win.isMinimized()) win.restore();
          win.show();
          win.moveTop();
          win.focus();
          if (process.platform === "win32") win.flashFrame(false);
          logMain().info("window", "notification clicked", {
            visible: win.isVisible(),
            minimized: win.isMinimized(),
            focused: win.isFocused(),
            conversationId: payload.conversationId
          });
          if (payload.conversationId) {
            safeSendToWebContents(
              win.webContents,
              "window:open-conversation",
              payload.conversationId
            );
          }
        } catch (err) {
          logMain().error("window", "notification click handler failed", {
            message: (err as Error)?.message
          });
        }
      });
      notification.on("failed", (_e, error) => {
        logMain().error("window", "notification failed", { message: error });
      });
      notification.show();
    } catch {
      // Notifications are best-effort; ignore failures.
    }
  });
}

app.whenReady().then(async () => {
  initDebugLog();
  logMain().info("main", "app ready", {
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    arch: process.arch
  });
  await injectShellPath();
  registerLocalFileProtocol();
  registerDraftProtocol();
  startPreviewServer(() =>
    mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null
  );
  initFileBridge(() =>
    mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null
  );
  getDb();
  logAllCliRuntimes();
  const existingOwner = getOwnerUser();
  if (existingOwner) {
    applyOwnerBackfill(existingOwner.id);
  }
  setLocalInvokeWindowGetter(() =>
    mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
  );
  setButlerAppWindowGetter(() =>
    mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
  );
  const remoteEnabled =
    getSetting("remote.enabled") === "1" || process.env.FB_REMOTE === "1";
  if (remoteEnabled) {
    const customPw = process.env.FB_REMOTE_PASSWORD;
    const { user, password } = ensureOwnerUser({
      password: customPw && customPw.length >= 8 ? customPw : undefined
    });
    applyOwnerBackfill(user.id);
    if (customPw && customPw.length >= 8) {
      console.log("[FreeBuddy] Remote access password (FB_REMOTE_PASSWORD):", customPw);
    } else if (password) {
      console.log("[FreeBuddy] Remote owner initial password:", password);
    } else {
      console.log("[FreeBuddy] Remote access enabled (owner already configured).");
    }
  }
  const distDir = path.join(__dirname, "..", "dist");
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  initRemoteControl({ distDir, devServerUrl });
  void startWebUIServer({
    allowRemote: remoteEnabled,
    bindMode: getConfiguredBindMode(),
    port: getConfiguredPort(),
    distDir,
    devServerUrl
  });
  initializeAgentUsageReconciler();
  initializeTelemetry();
  cleanupOrphanManagedAttachments();
  seedBuiltinSkills();
  seedBuiltinWorkflowTeams();
  registerCliIpc();
  registerTaskNotificationIpc();
  registerButlerBuddyWindowIpc();
  bindConversationNotifier((conversationId) => {
    for (const win of BrowserWindow.getAllWindows()) {
      safeSendToWebContents(win.webContents, "messages://changed", { conversationId });
    }
  });
  registerUpdaterIpc();
  const appIcon = loadAppIcon();
  if (process.platform === "darwin" && app.dock && appIcon) {
    app.dock.setIcon(appIcon);
  }
  createWindow();
  const butlerPreferences = readButlerBuddyPreferences();
  const shortcutError = updateButlerShortcutRegistration(
    butlerPreferences.shortcutEnabled,
    butlerPreferences.shortcut
  );
  if (shortcutError) {
    logMain().warn("butlerbuddy", "global shortcut unavailable", {
      shortcut: butlerPreferences.shortcut
    });
  }
  initializeScheduledTaskScheduler(() =>
    mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : undefined
  );
  void startCodexToolchainAutoUpdate();
  initAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

let telemetryShutdownStarted = false;
app.on("before-quit", (event) => {
  if (telemetryShutdownStarted) return;
  telemetryShutdownStarted = true;
  event.preventDefault();
  void shutdownTelemetry().finally(() => app.quit());
});
