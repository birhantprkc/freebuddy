/**
 * Client for the FreeBuddy guide gateway (Cloudflare Worker).
 *
 * The gateway holds real provider keys server-side and issues short-lived,
 * quota-bound trial tokens to FreeBuddy devices. The client never sees a
 * shared upstream key; the returned token is stored like any user key
 * (safeStorage-encrypted via the providers table).
 */

import {
  GUIDE_GATEWAY_ACTIVATE_PATH,
  GUIDE_GATEWAY_URL
} from "@/config/onboarding";
import { getOrCreateDeviceId } from "@/services/freebie/communityClient";

export interface GuideTrialActivation {
  /** Trial bearer token — stored as the provider instance's API key. */
  token: string;
  /** Gateway base URL the token is valid against (OpenAI-compatible). */
  baseUrl: string;
  /** Env/selector name the token is presented under. */
  envKey: string;
  /** Whitelisted models the trial may use. */
  models: Array<{
    id: string;
    name?: string;
    contextWindow?: number;
    supportsVision?: boolean;
  }>;
  /** Seconds until the token expires (informational UI). */
  expiresInSeconds?: number;
}

export class GatewayUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayUnavailableError";
  }
}

export async function activateGuideTrial(
  signal?: AbortSignal
): Promise<GuideTrialActivation> {
  const deviceId = getOrCreateDeviceId();
  let response: Response;
  try {
    response = await fetch(new URL(GUIDE_GATEWAY_ACTIVATE_PATH, GUIDE_GATEWAY_URL).toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-FreeBuddy-Device-Id": deviceId
      },
      body: JSON.stringify({ deviceId, client: "freebuddy" }),
      signal
    });
  } catch (error) {
    throw new GatewayUnavailableError(
      (error as Error)?.message || "guide gateway unreachable"
    );
  }
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const data = (await response.json()) as { message?: string; error?: string };
      message = data.message || data.error || message;
    } catch {
      /* keep status message */
    }
    throw new GatewayUnavailableError(message);
  }
  const data = (await response.json()) as Partial<GuideTrialActivation> & {
    ok?: boolean;
  };
  if (!data?.token || !data?.baseUrl) {
    throw new GatewayUnavailableError("gateway returned an incomplete activation");
  }
  return {
    token: data.token,
    baseUrl: data.baseUrl,
    envKey: data.envKey || "FREEBUDDY_GUIDE_TOKEN",
    models: Array.isArray(data.models) ? data.models : [],
    expiresInSeconds: data.expiresInSeconds
  };
}
