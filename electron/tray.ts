import { Tray, Menu, nativeImage, type BrowserWindow, type NativeImage } from "electron";
import { APP_NAME } from "./app-meta.js";
import { logMain } from "./debugLog.js";

export interface TrayDeps {
  getMainWindow: () => BrowserWindow | null;
  getIcon: () => NativeImage | undefined;
  getTrayIcon: () => NativeImage | undefined;
  isPetVisible: () => boolean;
  getUnreadCount: () => number;
  onNewConversation: () => void;
  onTogglePet: () => void;
  onQuit: () => void;
}

export interface TrayController {
  destroy(): void;
  refresh(): void;
  setUnreadCount(count: number): void;
}

export function createAppTray(deps: TrayDeps): TrayController {
  const isMac = process.platform === "darwin";
  const source = isMac
    ? deps.getTrayIcon() ?? deps.getIcon()
    : deps.getIcon();
  let trayIcon: NativeImage | undefined;
  if (source && !source.isEmpty()) {
    if (isMac) {
      trayIcon = source.resize({ width: 22, height: 22 });
      trayIcon.setTemplateImage(true);
    } else {
      trayIcon = source;
    }
  }

  const tray = new Tray(trayIcon ?? nativeImage.createEmpty());

  const applyUnreadChrome = (count: number) => {
    tray.setToolTip(count > 0 ? `${APP_NAME}（${count} 条未读）` : APP_NAME);
    if (isMac) {
      tray.setTitle(count > 0 ? String(count) : "");
    }
  };

  applyUnreadChrome(0);

  const revealMainWindow = () => {
    const win = deps.getMainWindow();
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.moveTop();
    win.focus();
  };

  const buildMenu = () => {
    const petVisible = deps.isPetVisible();
    const unread = deps.getUnreadCount();
    const showLabel = unread > 0 ? `显示主窗口（${unread} 条未读）` : "显示主窗口";
    return Menu.buildFromTemplate([
      {
        label: showLabel,
        click: () => revealMainWindow()
      },
      { type: "separator" },
      {
        label: "新建对话",
        click: () => {
          revealMainWindow();
          deps.onNewConversation();
        }
      },
      {
        label: petVisible ? "隐藏宠物" : "显示宠物",
        click: () => deps.onTogglePet()
      },
      { type: "separator" },
      {
        label: `退出 ${APP_NAME}`,
        click: () => deps.onQuit()
      }
    ]);
  };

  const applyMenu = () => {
    tray.setContextMenu(buildMenu());
  };

  applyMenu();

  tray.on("click", () => revealMainWindow());

  logMain().info("tray", "app tray created");

  return {
    destroy() {
      try {
        tray.destroy();
      } catch {
        /* best-effort */
      }
    },
    refresh() {
      applyMenu();
    },
    setUnreadCount(count: number) {
      applyUnreadChrome(count);
    }
  };
}
