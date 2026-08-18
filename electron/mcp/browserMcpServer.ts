import path from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

type BrowserAction =
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

interface BrowserToolResponse {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
}

const recipeSchema = {
  waitForSelector: z.string().trim().max(500).optional(),
  rowSelector: z.string().trim().min(1).max(500),
  fields: z.record(z.string().trim().min(1).max(80), z.string().trim().min(1).max(500)),
  maxItems: z.number().int().min(1).max(20).optional()
};

function environment(): { endpoint: string; token: string } {
  const endpoint =
    process.env.FREEBUDDY_BROWSER_ENDPOINT?.trim() ||
    process.env.FREEBUDDY_DRAFT_ENDPOINT?.trim();
  const token =
    process.env.FREEBUDDY_BROWSER_TOKEN?.trim() ||
    process.env.FREEBUDDY_DRAFT_TOKEN?.trim();
  if (!endpoint || !token) {
    throw new Error("FreeBuddy Browser tool environment is incomplete.");
  }
  return { endpoint, token };
}

export async function invokeBrowserBridge(
  action: BrowserAction,
  params: Record<string, unknown>
): Promise<BrowserToolResponse> {
  const { endpoint, token } = environment();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ action, params }),
    signal: AbortSignal.timeout(30_000)
  });
  const result = (await response.json().catch(() => ({
    ok: false,
    error: `Browser bridge returned HTTP ${response.status}`
  }))) as BrowserToolResponse;
  if (!response.ok) {
    throw new Error(result.error || `Browser bridge returned HTTP ${response.status}`);
  }
  return result;
}

function toolResult(result: BrowserToolResponse) {
  const screenshot =
    result.screenshot && typeof result.screenshot === "object"
      ? (result.screenshot as {
          mimeType?: unknown;
          data?: unknown;
          width?: unknown;
          height?: unknown;
        })
      : undefined;
  const structuredContent = screenshot
    ? {
        ...result,
        screenshot: {
          mimeType: screenshot.mimeType,
          width: screenshot.width,
          height: screenshot.height
        }
      }
    : result;
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(structuredContent, null, 2) },
      ...(typeof screenshot?.data === "string" && typeof screenshot?.mimeType === "string"
        ? [{ type: "image" as const, data: screenshot.data, mimeType: screenshot.mimeType }]
        : [])
    ],
    structuredContent,
    ...(result.ok === false ? { isError: true } : {})
  };
}

function toolError(error: unknown) {
  return toolResult({ ok: false, error: (error as Error)?.message || String(error) });
}

export function createBrowserMcpServer(): McpServer {
  const server = new McpServer({
    name: "freebuddy-browser",
    version: process.env.FB_APP_VERSION || "0.1.0"
  });

  server.registerTool(
    "browser_navigate",
    {
      title: "Navigate Built-in Browser",
      description:
        "Open or navigate FreeBuddy's built-in browser for the current conversation. Supports web URLs, localhost dev servers, workspace-relative files (HTML/Markdown/images/PDFs), and local paths.",
      inputSchema: {
        url: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "URL (e.g. http://127.0.0.1:5173/ or https://...), workspace-relative file, or absolute path. Omit to focus the existing target."
          ),
        target: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Alias for url."),
        open: z
          .boolean()
          .optional()
          .default(true)
          .describe("Open and focus the browser panel in FreeBuddy UI."),
        waitForReady: z
          .boolean()
          .optional()
          .default(true)
          .describe("Wait for the page to finish loading before returning.")
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async (args) => {
      try {
        const target = args.url || args.target;
        return toolResult(
          await invokeBrowserBridge("navigate", { ...args, target: target || args.target })
        );
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "browser_inspect",
    {
      title: "Inspect Browser State",
      description:
        "Inspect the current browser URL, load state, recent console logs, and optionally capture a visual screenshot.",
      inputSchema: {
        screenshot: z
          .boolean()
          .optional()
          .default(false)
          .describe("Capture visible browser preview as image content."),
        console: z
          .boolean()
          .optional()
          .default(true)
          .describe("Include recent console logs from the browser viewport."),
        includeHtml: z
          .boolean()
          .optional()
          .default(false)
          .describe("Include DOM excerpt if available.")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async (args) => {
      try {
        return toolResult(await invokeBrowserBridge("inspect", args));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "browser_screenshot",
    {
      title: "Capture Browser Screenshot",
      description: "Capture the visible built-in browser viewport and return it as PNG image content.",
      inputSchema: {
        fullPage: z
          .boolean()
          .optional()
          .default(false)
          .describe("Capture entire scrollable page.")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async (args) => {
      try {
        return toolResult(
          await invokeBrowserBridge("screenshot", { ...args, screenshot: true })
        );
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "browser_click",
    {
      title: "Click Browser Element",
      description: "Click an element by CSS selector in the built-in browser.",
      inputSchema: {
        selector: z.string().trim().min(1).max(500).describe("CSS selector of element to click.")
      },
      annotations: { destructiveHint: false, openWorldHint: true }
    },
    async (args) => {
      try {
        return toolResult(await invokeBrowserBridge("click", args));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "browser_fill",
    {
      title: "Fill Browser Input Field",
      description: "Type or fill text into an input element by CSS selector.",
      inputSchema: {
        selector: z.string().trim().min(1).max(500).describe("CSS selector of input field."),
        text: z.string().max(4000).describe("Text value to fill into the input.")
      },
      annotations: { destructiveHint: false, openWorldHint: true }
    },
    async (args) => {
      try {
        return toolResult(
          await invokeBrowserBridge("fill", {
            selector: args.selector,
            value: args.text,
            text: args.text
          })
        );
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "browser_scroll",
    {
      title: "Scroll Browser Page",
      description: "Scroll the browser page vertically by pixels.",
      inputSchema: {
        y: z.number().int().min(-5000).max(5000).optional().default(700)
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
    },
    async (args) => {
      try {
        return toolResult(await invokeBrowserBridge("scroll", args));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "browser_get_dom",
    {
      title: "Get Page DOM / Structure",
      description: "Extract current page DOM or markdown representation.",
      inputSchema: {
        mode: z
          .enum(["markdown", "html", "text", "accessibility_tree"])
          .optional()
          .default("markdown")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
    },
    async (args) => {
      try {
        return toolResult(await invokeBrowserBridge("get_dom", args));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "browser_eval",
    {
      title: "Evaluate JavaScript in Browser",
      description: "Execute a JavaScript expression in the browser context.",
      inputSchema: {
        script: z.string().trim().min(1).max(10000).describe("JavaScript expression to evaluate.")
      },
      annotations: { destructiveHint: false, openWorldHint: true }
    },
    async (args) => {
      try {
        return toolResult(await invokeBrowserBridge("eval", args));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "browser_extract",
    {
      title: "Extract Structured Rows",
      description: "Extract structured rows from the page using CSS selectors.",
      inputSchema: {
        waitForSelector: recipeSchema.waitForSelector,
        rowSelector: recipeSchema.rowSelector,
        fields: recipeSchema.fields,
        maxItems: recipeSchema.maxItems
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
    },
    async (args) => {
      try {
        return toolResult(await invokeBrowserBridge("extract", args));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "browser_report",
    {
      title: "Report Browser / Build Status",
      description: "Show a concise status or build notification inside FreeBuddy UI.",
      inputSchema: {
        level: z.enum(["status", "success", "error"]).optional().default("status"),
        message: z.string().trim().min(1).max(1000)
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async (args) => {
      try {
        return toolResult(await invokeBrowserBridge("report", args));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "browser_open",
    {
      title: "Open Browser URL",
      description: "Open a URL in the browser.",
      inputSchema: {
        url: z.string().trim().min(1),
        visible: z.boolean().optional().default(true)
      },
      annotations: { destructiveHint: false, openWorldHint: true }
    },
    async (args) => {
      try {
        return toolResult(
          await invokeBrowserBridge("navigate", {
            url: args.url,
            target: args.url,
            open: args.visible,
            visible: args.visible
          })
        );
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "browser_close",
    {
      title: "Close Browser",
      description: "Close or reset current browser session.",
      inputSchema: {},
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async () => {
      try {
        return toolResult(await invokeBrowserBridge("close", {}));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  return server;
}

export async function runBrowserMcpServer(): Promise<void> {
  const server = createBrowserMcpServer();
  await server.connect(new StdioServerTransport());
}

const isMainModule =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  runBrowserMcpServer().catch((error) => {
    console.error("[FreeBuddy Browser MCP]", error);
    process.exitCode = 1;
  });
}
