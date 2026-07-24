import type { WebContents } from "electron";

import { broadcastEvent } from "../eventBus.js";

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
  return delivered;
}
