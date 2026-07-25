import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ipcSource = fs.readFileSync(new URL("../electron/cli/ipc.ts", import.meta.url), "utf8");
const draftCanvasSource = fs.readFileSync(
  new URL("../src/components/Draft/DraftCanvas.tsx", import.meta.url),
  "utf8"
);
const draftToolbarSource = fs.readFileSync(
  new URL("../src/components/Draft/DraftToolbar.tsx", import.meta.url),
  "utf8"
);
const feedCardSource = fs.readFileSync(
  new URL("../src/components/Feeds/FeedCard.tsx", import.meta.url),
  "utf8"
);

async function loadDraftPreviewStoreModule() {
  const source = fs.readFileSync(
    new URL("../src/store/draftPreviewStore.ts", import.meta.url),
    "utf8"
  );
  const output = ts
    .transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022
      }
    })
    .outputText.replace(
      /^import \{ create \} from "zustand";\s*$/m,
      "const create = (factory) => factory(() => {}, () => ({}));"
    )
    .replace(
      /^import \{[^}]*\} from "@\/utils\/chatAttachments";\s*$/m,
      [
        "const attachmentPreviewUrl = (filePath) => {",
        '  const normalized = String(filePath || "").trim().replace(/\\\\/g, "/");',
        "  if (!normalized) return \"\";",
        '  if (typeof window !== "undefined" && window.freebuddy?.platform === "web") {',
        "    const params = new URLSearchParams({ path: normalized });",
        "    const token = window.freebuddy.sessionToken?.()?.trim();",
        '    if (token) params.set("token", token);',
        '    return `/api/attachment?${params.toString()}`;',
        "  }",
        '  return `freebuddy-file://open?path=${encodeURIComponent(normalized)}`;',
        "};",
        "const withWebMediaAuth = (url, extra) => {",
        "  if (!url) return \"\";",
        '  const parsed = new URL(url, "http://local.invalid");',
        '  if (typeof window !== "undefined" && window.freebuddy?.platform === "web") {',
        "    const token = window.freebuddy.sessionToken?.()?.trim();",
        '    if (token) parsed.searchParams.set("token", token);',
        "  }",
        "  if (extra) for (const [k, v] of Object.entries(extra)) parsed.searchParams.set(k, v);",
        '  return parsed.protocol.startsWith("http")',
        "    ? `${parsed.pathname}${parsed.search}${parsed.hash}`",
        "    : parsed.toString();",
        "};"
      ].join("\n")
    );
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

async function loadDraftCanvasModule() {
  const source = fs.readFileSync(
    new URL("../src/components/Draft/DraftCanvas.tsx", import.meta.url),
    "utf8"
  );
  const output = ts
    .transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022
      }
    })
    .outputText.replace(/import[\s\S]*?from "react";\n/, "")
    .replace(/import[\s\S]*?from "react-i18next";\n/, "")
    .replace(/import[\s\S]*?from "@\/services\/cli\/client";\n/, "")
    .replace(/import[\s\S]*?from "@\/store\/conversationStore";\n/, "")
    .replace(/import[\s\S]*?from "@\/store\/draftPreviewStore";\n/, "")
    .replace(/import[\s\S]*?from "\.\/DraftToolbar";\n/, "")
    .replace(/import[\s\S]*?from "\.\.\/CLI\/StreamItem";\n/, "");
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("Draft preview keeps freebuddy-file image URLs as direct image sources", async () => {
  const { composeDraftPreviewUrl } = await loadDraftPreviewStoreModule();
  const source = "freebuddy-file://open?path=%2Ftmp%2Fgenerated%20poster.png";
  const url = composeDraftPreviewUrl("/Users/me/workspace", source, 7);
  const parsed = new URL(url);

  assert.equal(parsed.protocol, "freebuddy-file:");
  assert.equal(parsed.hostname, "open");
  assert.equal(parsed.searchParams.get("path"), "/tmp/generated poster.png");
  assert.equal(parsed.searchParams.get("freebuddyDraft"), "7");
});

test("Draft image detection reads extension from freebuddy-file path query", async () => {
  const { isImageDraftTarget } = await loadDraftCanvasModule();
  const source = "freebuddy-file://open?path=%2Ftmp%2Fgenerated%20poster.png";

  assert.equal(isImageDraftTarget(source, source), true);
  assert.equal(isImageDraftTarget("freebuddy-file://open?path=%2Ftmp%2Fnotes.txt", ""), false);
});

test("Draft image detection reads extension from /api/attachment path query", async () => {
  const { isImageDraftTarget, draftTargetExtension } = await loadDraftCanvasModule();
  const source = "/api/attachment?path=%2Ftmp%2Fgenerated%20poster.png&freebuddyDraft=3";

  assert.equal(draftTargetExtension(undefined, source), "png");
  assert.equal(isImageDraftTarget(undefined, source), true);
  assert.equal(
    isImageDraftTarget(undefined, "/api/attachment?path=%2Ftmp%2Fnotes.txt"),
    false
  );
});

test("Draft preview converts absolute local image paths to freebuddy-file URLs", async () => {
  const { composeDraftPreviewUrl } = await loadDraftPreviewStoreModule();
  const previous = globalThis.window;
  globalThis.window = undefined;
  try {
    const filePath = path.normalize("/tmp/generated poster.png").replace(/\\/g, "/");
    const url = composeDraftPreviewUrl("/Users/me/workspace", filePath, 3);
    const parsed = new URL(url);

    assert.equal(parsed.protocol, "freebuddy-file:");
    assert.equal(parsed.hostname, "open");
    assert.equal(decodeURIComponent(parsed.searchParams.get("path") ?? ""), filePath);
    assert.equal(parsed.searchParams.get("freebuddyDraft"), "3");
  } finally {
    globalThis.window = previous;
  }
});

test("Draft preview converts absolute local image paths to /api/attachment on web", async () => {
  const { composeDraftPreviewUrl } = await loadDraftPreviewStoreModule();
  const previous = globalThis.window;
  globalThis.window = { freebuddy: { platform: "web" } };
  try {
    const filePath = path.normalize("/tmp/generated poster.png").replace(/\\/g, "/");
    const url = composeDraftPreviewUrl("/Users/me/workspace", filePath, 3);
    const parsed = new URL(url, "http://local.invalid");

    assert.equal(parsed.pathname, "/api/attachment");
    assert.equal(decodeURIComponent(parsed.searchParams.get("path") ?? ""), filePath);
    assert.equal(parsed.searchParams.get("freebuddyDraft"), "3");
  } finally {
    globalThis.window = previous;
  }
});

test("Draft preview converts workspace-relative HTML to /api/draft-render on web", async () => {
  const { composeDraftPreviewUrl } = await loadDraftPreviewStoreModule();
  const previous = globalThis.window;
  globalThis.window = { freebuddy: { platform: "web" } };
  try {
    const url = composeDraftPreviewUrl("/Users/me/workspace", "index.html", 4);
    const parsed = new URL(url, "http://local.invalid");

    assert.equal(parsed.pathname, "/api/draft-render/%2FUsers%2Fme%2Fworkspace/index.html");
    assert.equal(parsed.searchParams.get("v"), "4");
  } finally {
    globalThis.window = previous;
  }
});

test("Draft preview resolves workspace-relative images to absolute file preview URLs", async () => {
  const { composeDraftPreviewUrl } = await loadDraftPreviewStoreModule();
  const previous = globalThis.window;
  try {
    globalThis.window = { freebuddy: { platform: "web" } };
    const webUrl = composeDraftPreviewUrl(
      "/Users/me/workspace",
      "generated-images/poster.png",
      4
    );
    const webParsed = new URL(webUrl, "http://local.invalid");
    assert.equal(webParsed.pathname, "/api/attachment");
    assert.equal(
      decodeURIComponent(webParsed.searchParams.get("path") ?? ""),
      "/Users/me/workspace/generated-images/poster.png"
    );

    globalThis.window = undefined;
    const desktopUrl = composeDraftPreviewUrl(
      "/Users/me/workspace",
      "generated-images/poster.png",
      2
    );
    const desktopParsed = new URL(desktopUrl);
    assert.equal(desktopParsed.protocol, "freebuddy-file:");
    assert.equal(
      decodeURIComponent(desktopParsed.searchParams.get("path") ?? ""),
      "/Users/me/workspace/generated-images/poster.png"
    );
  } finally {
    globalThis.window = previous;
  }
});

test("Draft preview converts absolute HTML paths to freebuddy-draft URLs without a workspace", async () => {
  const { composeDraftPreviewUrl } = await loadDraftPreviewStoreModule();
  const filePath = "/Users/me/docs/v2ex_discussion.html";
  const url = composeDraftPreviewUrl("", filePath, 5);
  const parsed = new URL(url);

  assert.equal(parsed.protocol, "freebuddy-draft:");
  assert.equal(parsed.hostname, "render");
  assert.equal(parsed.pathname, "/%2FUsers%2Fme%2Fdocs/v2ex_discussion.html");
  assert.equal(parsed.searchParams.get("v"), "5");
});

test("Draft preview converts absolute markdown paths to freebuddy-draft URLs without a workspace", async () => {
  const { composeDraftPreviewUrl, splitAbsoluteLocalFile } =
    await loadDraftPreviewStoreModule();
  const filePath = "/Users/me/docs/notes.md";
  const url = composeDraftPreviewUrl("", filePath, 2);
  const parsed = new URL(url);

  assert.equal(parsed.protocol, "freebuddy-draft:");
  assert.equal(parsed.hostname, "render");
  assert.equal(parsed.pathname, "/%2FUsers%2Fme%2Fdocs/notes.md");
  assert.equal(parsed.searchParams.get("v"), "2");
  assert.deepEqual(splitAbsoluteLocalFile(filePath), {
    root: "/Users/me/docs",
    rel: "notes.md"
  });
});

test("Draft preview prefers absolute HTML draft roots over conversation cwd", async () => {
  const { composeDraftPreviewUrl } = await loadDraftPreviewStoreModule();
  const filePath = "/tmp/outside/page.html";
  const url = composeDraftPreviewUrl("/Users/me/workspace", filePath, 9);
  const parsed = new URL(url);

  assert.equal(parsed.hostname, "render");
  assert.equal(parsed.pathname, "/%2Ftmp%2Foutside/page.html");
});

test("Draft preview keeps remote article URLs inside the preview target", async () => {
  const { composeDraftPreviewUrl } = await loadDraftPreviewStoreModule();
  const source = "https://example.com/article?from=rss";
  const url = composeDraftPreviewUrl("/Users/me/workspace", source, 11);
  const parsed = new URL(url);

  assert.equal(parsed.protocol, "https:");
  assert.equal(parsed.hostname, "example.com");
  assert.equal(parsed.pathname, "/article");
  assert.equal(parsed.searchParams.get("from"), "rss");
  assert.equal(parsed.searchParams.get("freebuddyDraft"), "11");
});

test("Draft preview supports remote URLs but not relative files without a workspace", async () => {
  const { composeDraftPreviewUrl } = await loadDraftPreviewStoreModule();
  const remote = composeDraftPreviewUrl("", "https://example.com/article", 4);

  assert.equal(new URL(remote).hostname, "example.com");
  assert.equal(composeDraftPreviewUrl("", "index.html", 4), "");
});

test("Draft canvas loads absolute markdown via readDraftMarkdown without a workspace", () => {
  assert.match(draftCanvasSource, /splitAbsoluteLocalFile/);
  assert.match(
    draftCanvasSource,
    /const root = absolute\?\.root \?\? cwd/
  );
  assert.match(
    draftCanvasSource,
    /const fileRel = absolute\?\.rel \?\? rel/
  );
  assert.match(draftCanvasSource, /readDraftMarkdown\(root, fileRel\)/);
  assert.doesNotMatch(draftCanvasSource, /fetch\(entry\.url\)/);
});

test("Draft preview keeps WeChat article URLs exact because they are signed", async () => {
  const { composeDraftPreviewUrl } = await loadDraftPreviewStoreModule();
  const source = "https://mp.weixin.qq.com/s?__biz=test&mid=1&idx=1&sn=abc#rd";
  const url = composeDraftPreviewUrl("/Users/me/workspace", source, 11);
  const parsed = new URL(url);

  assert.equal(parsed.hostname, "mp.weixin.qq.com");
  assert.equal(parsed.searchParams.get("__biz"), "test");
  assert.equal(parsed.searchParams.get("freebuddyDraft"), null);
  assert.equal(parsed.hash, "#rd");
});

test("Draft preview treats WeChat articles as external-only targets", async () => {
  const { isExternalOnlyDraftTarget } = await loadDraftCanvasModule();
  const source = "https://mp.weixin.qq.com/s?__biz=test&mid=1&idx=1&sn=abc#rd";

  assert.equal(isExternalOnlyDraftTarget(source), true);
  assert.equal(isExternalOnlyDraftTarget("https://example.com/article"), false);
  assert.match(draftCanvasSource, /const isExternalOnly = isExternalOnlyDraftTarget/);
  assert.match(draftCanvasSource, /draft\.externalOnlyTitle/);
  assert.match(draftCanvasSource, /draft-external-only/);
});

test("Draft external open supports remote article URLs", () => {
  assert.match(ipcSource, /\^https\?:\\\/\\\//);
  assert.doesNotMatch(ipcSource, /https\?:\\\/\\\/\(localhost\|127/);
});

test("Draft external open supports freebuddy-file preview URLs", () => {
  assert.match(ipcSource, /resolveAttachmentFilePath/);
  assert.match(ipcSource, /url\.startsWith\("freebuddy-file:\/\/"\)/);
  assert.match(ipcSource, /pathToFileURL\(filePath\)\.toString\(\)/);
});

test("Draft toolbar shows feed actions only when a feed item is active", () => {
  assert.match(draftToolbarSource, /feedItem\?: FeedItem/);
  assert.match(draftToolbarSource, /onInterpretFeedItem\?: \(item: FeedItem\) => void/);
  assert.match(draftToolbarSource, /onMarkFeedItemRead\?: \(item: FeedItem\) => void/);
  assert.match(draftToolbarSource, /feedItem && \(/);
  assert.match(draftToolbarSource, /draft\.feedInterpret/);
  assert.match(draftToolbarSource, /draft\.feedMarkRead/);
});

test("Draft canvas wires feed preview actions to the active feed item", () => {
  assert.match(draftCanvasSource, /useFeedStore/);
  assert.match(draftCanvasSource, /currentFeedItem/);
  assert.match(draftCanvasSource, /item\.link === entry\?\.manualEntry/);
  assert.match(draftCanvasSource, /markInterpreted\(item\.id\)/);
  assert.match(draftCanvasSource, /buildFeedInterpretPrompt\(item, t\)/);
  assert.match(draftCanvasSource, /feedItem=\{currentFeedItem\}/);
  assert.match(draftCanvasSource, /onInterpretFeedItem=\{handleInterpretFeedItem\}/);
  assert.match(draftCanvasSource, /onMarkFeedItemRead=\{handleMarkFeedItemRead\}/);
});

test("Feed interpretation logic is shared by card and draft actions", () => {
  assert.match(feedCardSource, /from "\.\/feedInterpretation"/);
  assert.doesNotMatch(feedCardSource, /function buildInterpretPrompt/);
  assert.doesNotMatch(feedCardSource, /function isFeedInterpretConversation/);
});
