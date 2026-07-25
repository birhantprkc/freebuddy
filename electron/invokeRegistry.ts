import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { runAsCaller } from "./cli/callerContext.js";
import { getOwnerUser } from "./cli/users.js";
import {
  classifyRemoteChannel,
  isRemoteChannelCallable
} from "./shared/remoteChannelPolicy.js";
import {
  guardRemoteInvokeArgs,
  filterRemoteInvokeResult
} from "./cli/remoteInvokeGuard.js";

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

export function isChannelRemoteCallable(channel: string, isAdmin = false): boolean {
  return handlers.has(channel) && isRemoteChannelCallable(channel, isAdmin);
}

export interface LocalInvokeContext {
  /** Remote user on whose behalf the call runs; null for local CLI callers. */
  userId?: string | null;
  isAdmin?: boolean;
}

export async function localInvoke(
  channel: string,
  context: LocalInvokeContext,
  ...args: unknown[]
): Promise<unknown> {
  const handler = handlers.get(channel);
  if (!handler) {
    throw new Error(`unknown channel: ${channel}`);
  }
  const isAdmin = context.isAdmin === true;
  if (!isChannelRemoteCallable(channel, isAdmin)) {
    const reason =
      classifyRemoteChannel(channel) === "adminOnly"
        ? "channel requires an administrator"
        : "channel not available remotely";
    throw new Error(`${reason}: ${channel}`);
  }
  const guardedArgs = guardRemoteInvokeArgs(channel, args, context.userId ?? null);
  const win = mainWindowGetter ? mainWindowGetter() : null;
  const event = { sender: win ? win.webContents : undefined } as IpcMainInvokeEvent;
  const result = await handler(event, ...guardedArgs);
  return filterRemoteInvokeResult(channel, result);
}
