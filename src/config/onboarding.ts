/**
 * Onboarding (first-run guide) feature constants.
 *
 * The guide gateway is the Cloudflare Worker that mints short-lived trial
 * tokens for the built-in pi runtime (PR2/PR3 of the onboarding feature).
 * Keep the URL configurable so the same build works before/after deployment.
 */

export const ONBOARDING_STATE_SETTING_KEY = "onboarding.state.v1";
export type OnboardingState = "pending" | "done" | "skipped";

export const GUIDE_GATEWAY_URL =
  "https://freebuddy-freebie.binbinzhaili.workers.dev";

/** Path on the gateway that exchanges a device id for a trial token. */
export const GUIDE_GATEWAY_ACTIVATE_PATH = "/api/v1/auth/device";

