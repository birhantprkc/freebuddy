export interface BridgeActionParam {
  name: string;
  description: string;
  required?: boolean;
}

export interface BridgeAction {
  name: string;
  summary: string;
  description: string;
  params?: BridgeActionParam[];
}

/**
 * The catalog of actions FreeBuddy exposes to agents over the local HTTP
 * bridge. This single source of truth drives:
 *  - HTTP routing (previewServer.ts -> parseBridgeRequest)
 *  - the capability list injected into workspace guide files (agentGuides.ts)
 */
export const DEFAULT_BRIDGE_PORT = 17878;
export let BRIDGE_PORT = DEFAULT_BRIDGE_PORT;
let hasActiveBridgePort = false;
let resolveActiveBridgePort: ((port: number) => void) | undefined;
const activeBridgePortReady = new Promise<number>((resolve) => {
  resolveActiveBridgePort = resolve;
});

export function getActiveBridgePort(): number {
  return BRIDGE_PORT;
}

export function setActiveBridgePort(port: number): void {
  BRIDGE_PORT = port;
  if (!hasActiveBridgePort) {
    hasActiveBridgePort = true;
    resolveActiveBridgePort?.(port);
    resolveActiveBridgePort = undefined;
  }
}

export async function waitForActiveBridgePort(timeoutMs = 10_000): Promise<number> {
  if (hasActiveBridgePort) return BRIDGE_PORT;
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      activeBridgePortReady,
      new Promise<number>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("FreeBuddy Browser bridge did not start in time.")),
          timeoutMs
        );
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export const BRIDGE_ACTIONS: BridgeAction[] = [
  {
    name: "preview",
    summary: "Open the built-in browser panel.",
    description:
      "Switch the side panel to the built-in browser for this workspace."
  },
  {
    name: "navigate",
    summary: "Point the browser at a workspace-relative path, local file image, or local dev-server URL.",
    description:
      "Re-target the browser to another entry file, route, localhost URL, or local image file. Use this after starting npm run dev.",
    params: [
      {
        name: "to",
        description: "Workspace-relative path, route, absolute local image path, freebuddy-file://open?path=<absolute path>, or http://127.0.0.1:<port>/ URL",
        required: true
      }
    ]
  },
  {
    name: "entry",
    summary: "Select the browser entry without changing tabs.",
    description:
      "Set the built-in browser target to a workspace-relative file, local image file, or localhost dev-server URL.",
    params: [
      {
        name: "to",
        description: "Workspace-relative path, absolute local image path, freebuddy-file://open?path=<absolute path>, or http://127.0.0.1:<port>/ URL",
        required: true
      }
    ]
  },
  {
    name: "status",
    summary: "Post a status message toast.",
    description: "Show a transient status notification in FreeBuddy.",
    params: [
      {
        name: "text",
        description: "Status message",
        required: true
      }
    ]
  },
  {
    name: "error",
    summary: "Post an error message toast.",
    description: "Show a transient error notification in FreeBuddy.",
    params: [
      {
        name: "text",
        description: "Error message",
        required: true
      }
    ]
  },
  {
    name: "notify",
    summary: "Post a generic notification toast.",
    description: "Show a transient notification in FreeBuddy.",
    params: [
      {
        name: "text",
        description: "Notification message",
        required: true
      }
    ]
  }
];

export interface ParsedBridgeRequest {
  action: string;
  params: Record<string, string>;
}

export function parseBridgeRequest(
  urlPath: string
): { action: string; params: Record<string, string> } | null {
  const [pathname, queryString] = urlPath.split("?");
  const params: Record<string, string> = {};
  if (queryString) {
    for (const [k, v] of new URLSearchParams(queryString)) {
      params[k] = v;
    }
  }

  // Modern /freebuddy/<action> paths
  if (pathname.startsWith("/freebuddy/")) {
    const action = pathname.slice("/freebuddy/".length);
    return { action, params };
  }

  // Legacy /preview path
  if (pathname === "/preview") {
    return { action: "preview", params };
  }

  return null;
}

export function isKnownBridgeAction(action: string): boolean {
  return BRIDGE_ACTIONS.some((a) => a.name === action);
}

export function buildBridgeSection(port: number): string {
  const lines: string[] = [
    "## FreeBuddy bridge",
    "",
    "You can talk back to FreeBuddy over a local HTTP bridge while it is running.",
    "Always use the browser tool or bridge to open the Built-in Browser after you create or update something previewable; do not wait for the user to open it manually.",
    "The Built-in Browser supports localhost web apps, static HTML, Markdown files, documents, and image files.",
    "When previewing npm/Vite/Next/React/Vue apps, prefer starting the dev server and navigating the browser to its localhost URL instead of opening index.html directly.",
    "",
    "Dev-server preview flow:",
    "```sh",
    "npm run dev -- --host 127.0.0.1",
    `curl -s "http://127.0.0.1:${port}/freebuddy/navigate?to=http%3A%2F%2F127.0.0.1%3A5173%2F"`,
    `curl -s "http://127.0.0.1:${port}/freebuddy/status?text=Preview%20is%20running%20at%20http%3A%2F%2F127.0.0.1%3A5173%2F"`,
    "```",
    "",
    "Markdown/image preview examples:",
    "```sh",
    `curl -s "http://127.0.0.1:${port}/freebuddy/navigate?to=README.md"`,
    `curl -s "http://127.0.0.1:${port}/freebuddy/navigate?to=assets%2Fmockup.png"`,
    `curl -s "http://127.0.0.1:${port}/freebuddy/navigate?to=%2Ftmp%2Fposter.png"`,
    `curl -s "http://127.0.0.1:${port}/freebuddy/navigate?to=freebuddy-file%3A%2F%2Fopen%3Fpath%3D%252Ftmp%252Fposter.png"`,
    "```",
    "",
    "",
    "Available actions:",
    ""
  ];
  for (const action of BRIDGE_ACTIONS) {
    const params = action.params ?? [];
    const query = params.length
      ? "?" + params.map((p) => `${p.name}=<value>`).join("&")
      : "";
    lines.push(`### ${action.name}`);
    lines.push(`${action.summary} ${action.description}`);
    lines.push("```sh");
    lines.push(
      `curl -s "http://127.0.0.1:${port}/freebuddy/${action.name}${query}"`
    );
    lines.push("```");
    if (params.length) {
      lines.push("Parameters:");
      for (const p of params) {
        lines.push(
          `- \`${p.name}\`${p.required ? " (required)" : ""}: ${p.description}`
        );
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}
