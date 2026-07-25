import type { WebContents } from "electron";

import { broadcastEvent, hasEventBroadcaster } from "../eventBus.js";

export function safeSendToWebContents(
  webContents: WebContents | null | undefined,
  channel: string,
  payload: unknown
): boolean {
  let delivered = false;
  if (webContents && !webContents.isDestroyed()) {
    try {
      const frame = webContents.mainFrame;
      if (!frame.isDestroyed()) {
        frame.send(channel, payload);
        delivered = true;
      }
    } catch {
      // ignore
    }
  }
  broadcastEvent(channel, payload);
  // WebUI clients receive via the event bus even when desktop webContents is gone.
  return delivered || hasEventBroadcaster();
}
