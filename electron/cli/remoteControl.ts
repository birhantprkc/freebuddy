import { registerHandler } from "../invokeRegistry.js";
import { getSetting, setSetting } from "./settings.js";
import {
  setRemotePassword,
  hasRemotePassword,
  generateRandomPassword
} from "../remoteAuth.js";
import {
  restartWebUIServer,
  getWebUIStatus,
  type WebUIServerOptions,
  type WebUIStatus
} from "../webUIServer.js";

let launchOptions: WebUIServerOptions = {};

export function isRemoteEnabledByConfig(): boolean {
  return getSetting("remote.enabled") === "1" || process.env.FB_REMOTE === "1";
}

function resolveLaunchOptions(allowRemote: boolean): WebUIServerOptions {
  return { ...launchOptions, allowRemote };
}

function registerRemoteIpc(): void {
  registerHandler("remote:getStatus", async (): Promise<WebUIStatus> => {
    return getWebUIStatus();
  });

  registerHandler(
    "remote:setEnabled",
    async (_event, enabled: boolean): Promise<{ status: WebUIStatus; initialPassword: string | null }> => {
      setSetting("remote.enabled", enabled ? "1" : "0");
      let initialPassword: string | null = null;
      if (enabled && !hasRemotePassword()) {
        initialPassword = generateRandomPassword();
        setRemotePassword(initialPassword);
      }
      const status = await restartWebUIServer(resolveLaunchOptions(enabled));
      return { status, initialPassword };
    }
  );

  registerHandler("remote:setPassword", async (_event, plain: string): Promise<boolean> => {
    setRemotePassword(plain);
    return true;
  });

  registerHandler("remote:resetPassword", async (): Promise<string> => {
    const plain = generateRandomPassword();
    setRemotePassword(plain);
    return plain;
  });
}

export function initRemoteControl(options: WebUIServerOptions): void {
  launchOptions = options;
  registerRemoteIpc();
}
