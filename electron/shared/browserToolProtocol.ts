export type BrowserToolAction =
  | "navigate"
  | "inspect"
  | "screenshot"
  | "click"
  | "fill"
  | "type"
  | "scroll"
  | "eval"
  | "get_dom"
  | "extract"
  | "report"
  | "open"
  | "close"
  | "show";

export type BrowserLoadState = "idle" | "loading" | "ready" | "error";

export interface BrowserCaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserScreenshot {
  mimeType: "image/png";
  data: string;
  width: number;
  height: number;
}

export interface BrowserConsoleEntry {
  level: "debug" | "info" | "warning" | "error";
  message: string;
  source?: string;
  line?: number;
  timestamp: string;
}

export interface BrowserToolEvent {
  requestId: string;
  conversationId: string;
  cwd: string;
  action: BrowserToolAction;
  params: Record<string, unknown>;
}

export interface BrowserToolResult {
  ok: boolean;
  conversationId: string;
  cwd: string;
  target?: string;
  resolvedUrl?: string;
  loadState?: BrowserLoadState;
  visible?: boolean;
  message?: string;
  error?: string;
  updatedAt?: string;
  diagnostics?: { console: BrowserConsoleEntry[] };
  screenshot?: BrowserScreenshot;
  screenshotError?: string;
  /** Renderer-only capture hint, stripped before the result reaches the agent. */
  captureRect?: BrowserCaptureRect;
  dom?: string;
  result?: unknown;
  rows?: unknown[];
}

export interface BrowserToolResolution {
  requestId: string;
  result: BrowserToolResult;
}

export interface AcpStdioMcpServer {
  name: string;
  command: string;
  args: string[];
  env: Array<{ name: string; value: string }>;
}

// Type aliases for seamless transition
export type DraftToolAction = BrowserToolAction;
export type DraftLoadState = BrowserLoadState;
export type DraftCaptureRect = BrowserCaptureRect;
export type DraftScreenshot = BrowserScreenshot;
export type DraftConsoleEntry = BrowserConsoleEntry;
export type DraftToolEvent = BrowserToolEvent;
export type DraftToolResult = BrowserToolResult;
export type DraftToolResolution = BrowserToolResolution;
