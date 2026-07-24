import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { runAsCaller } from "./cli/callerContext.js";
import { getOwnerUser } from "./cli/users.js";

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: any[]) => any;

const handlers = new Map<string, InvokeHandler>();

let mainWindowGetter: (() => BrowserWindow | null) | null = null;
let desktopOwnerId: string | null = null;

function resolveDesktopCaller(): string | null {
  if (desktopOwnerId) return desktopOwnerId;
  const owner = getOwnerUser()?.id ?? null;
  if (owner) desktopOwnerId = owner;
  return owner;
}

export function setLocalInvokeWindowGetter(
  getter: () => BrowserWindow | null
): void {
  mainWindowGetter = getter;
}

export function registerHandler(channel: string, handler: InvokeHandler): void {
  handlers.set(channel, handler);
  const wrapped: InvokeHandler = (event, ...args) => {
    const owner = resolveDesktopCaller();
    if (owner) return runAsCaller(owner, () => handler(event, ...args), true);
    return handler(event, ...args);
  };
  ipcMain.handle(channel, wrapped);
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
  "remote:resetPassword",
  "remote:listUsers",
  "remote:createUser",
  "remote:resetUserPassword",
  "remote:deleteUser",
  "remote:listUserRoots",
  "remote:setUserRoots"
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
