import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: any[]) => any;

const handlers = new Map<string, InvokeHandler>();

let mainWindowGetter: (() => BrowserWindow | null) | null = null;

export function setLocalInvokeWindowGetter(
  getter: () => BrowserWindow | null
): void {
  mainWindowGetter = getter;
}

export function registerHandler(channel: string, handler: InvokeHandler): void {
  handlers.set(channel, handler);
  ipcMain.handle(channel, handler);
}

export function listInvokeChannels(): string[] {
  return Array.from(handlers.keys());
}

const REMOTE_BLOCKED_CHANNELS = new Set<string>([
  "cli:selectDirectory",
  "cli:selectAttachments",
  "cli:install",
  "cli:installStream",
  "cli:openDraftExternal",
  "cli:openCursorUsageSettings",
  "skills:selectDirectory",
  "skills:selectArchive",
  "skills:reveal",
  "skills:openMarketUrl",
  "skills:import",
  "skills:installFromMarket",
  "shell:showItemInFolder",
  "updater:check",
  "updater:download",
  "updater:quitAndInstall",
  "plugins:install",
  "plugins:uninstall",
  "plugins:update",
  "plugins:addMarketplace",
  "plugins:updateMarketplace",
  "plugins:removeMarketplace",
  "remote:setEnabled",
  "remote:setPassword",
  "remote:resetPassword"
]);

export function isChannelRemoteCallable(channel: string): boolean {
  return handlers.has(channel) && !REMOTE_BLOCKED_CHANNELS.has(channel);
}

export async function localInvoke(
  channel: string,
  ...args: unknown[]
): Promise<unknown> {
  const handler = handlers.get(channel);
  if (!handler) {
    throw new Error(`unknown channel: ${channel}`);
  }
  if (!isChannelRemoteCallable(channel)) {
    throw new Error(`channel not available remotely: ${channel}`);
  }
  const win = mainWindowGetter ? mainWindowGetter() : null;
  const event = { sender: win ? win.webContents : undefined } as IpcMainInvokeEvent;
  return handler(event, ...args);
}
