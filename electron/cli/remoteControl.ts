import { registerHandler } from "../invokeRegistry.js";
import { getSetting, setSetting } from "./settings.js";
import {
  listUsers,
  createUser,
  deleteUser,
  resetUserPassword,
  ensureOwnerUser,
  getUserRoots,
  setUserRoots,
  migrateGlobalRootsToOwner,
  getUserById,
  type RemoteUser
} from "./users.js";
import { getCallerUserId } from "./callerContext.js";
import {
  restartWebUIServer,
  getWebUIStatus,
  type WebUIServerOptions,
  type WebUIStatus
} from "../webUIServer.js";
import { generateQrToken } from "../remoteAuth.js";

let launchOptions: WebUIServerOptions = {};

export function isRemoteEnabledByConfig(): boolean {
  return getSetting("remote.enabled") === "1" || process.env.FB_REMOTE === "1";
}

function resolveLaunchOptions(allowRemote: boolean): WebUIServerOptions {
  return { ...launchOptions, allowRemote };
}

function registerRemoteIpc(): void {
  registerHandler("remote:whoami", async (): Promise<RemoteUser | null> => {
    const id = getCallerUserId();
    return id ? getUserById(id) : null;
  });

  registerHandler("remote:getStatus", async (): Promise<WebUIStatus> => {
    return getWebUIStatus();
  });

  registerHandler(
    "remote:getQrLogin",
    async (): Promise<{ url: string; token: string; expiresIn: number } | null> => {
      const status = getWebUIStatus();
      if (!status.running) return null;
      const token = generateQrToken();
      const url = `${status.accessUrl.replace(/\/$/, "")}/qr-login?token=${token}`;
      return { url, token, expiresIn: 300 };
    }
  );

  registerHandler(
    "remote:setEnabled",
    async (_event, enabled: boolean): Promise<{ status: WebUIStatus; initialPassword: string | null }> => {
      setSetting("remote.enabled", enabled ? "1" : "0");
      let initialPassword: string | null = null;
      if (enabled) {
        const { user, password } = ensureOwnerUser();
        migrateGlobalRootsToOwner(user.id);
        if (password) initialPassword = password;
      }
      const status = await restartWebUIServer(resolveLaunchOptions(enabled));
      return { status, initialPassword };
    }
  );

  registerHandler("remote:listUsers", async (): Promise<RemoteUser[]> => listUsers());

  registerHandler(
    "remote:createUser",
    async (_event, input: { username: string; password?: string }) =>
      createUser(input)
  );

  registerHandler("remote:resetUserPassword", async (_event, id: string) =>
    resetUserPassword(id)
  );

  registerHandler("remote:deleteUser", async (_event, id: string) => deleteUser(id));

  registerHandler("remote:listUserRoots", async (_event, userId: string) =>
    getUserRoots(userId)
  );

  registerHandler(
    "remote:setUserRoots",
    async (_event, args: { userId: string; roots: string[] }) => {
      setUserRoots(args.userId, args.roots);
      return getUserRoots(args.userId);
    }
  );
}

export function initRemoteControl(options: WebUIServerOptions): void {
  launchOptions = options;
  registerRemoteIpc();
}
