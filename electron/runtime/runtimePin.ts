import { readRuntimeState } from "@freebuddy/runtime-host";

export function currentRuntimePin(dataDir?: string): {
  runtimeVersion: string;
  runtimeApiVersion: string;
} {
  try {
    const dir = dataDir ?? process.env.FB_USER_DATA ?? "";
    if (!dir) return { runtimeVersion: "bundled", runtimeApiVersion: "1.0.0" };
    const state = readRuntimeState(dir);
    return {
      runtimeVersion: state.activeVersion ?? "bundled",
      runtimeApiVersion: "1.0.0"
    };
  } catch {
    return { runtimeVersion: "bundled", runtimeApiVersion: "1.0.0" };
  }
}
