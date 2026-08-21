import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { CliStreamItem } from "@/services/cli/parsers";
import type { ConversationMessage, NativeBrowserState } from "@/services/cli/types";
import type { FeedItem } from "@/services/feed/types";
import { cliClient } from "@/services/cli/client";
import { useConversationStore } from "@/store/conversationStore";
import {
  bundledGameEntry,
  isBundledGameType,
  remoteBrowserOrigin,
  splitAbsoluteLocalFile,
  useBrowserStore
} from "@/store/browserStore";
import { useFeedStore } from "@/store/feedStore";
import {
  buildFeedInterpretPrompt,
  clipFeedTitle,
  isFeedInterpretConversation
} from "../Feeds/feedInterpretation";
import { builtinCliMembers } from "@/config/aiMembers";
import { getAgentIconId } from "@/config/agentIcon";
import { lobehubAvatarUrl } from "@/utils/lobehubAvatar";
import { BrowserToolbar, type BrowserViewport } from "./BrowserToolbar";
import { MarkdownText } from "../CLI/StreamItem";

const EMPTY_MESSAGES: ConversationMessage[] = [];
const FRAME_WIDTH: Record<BrowserViewport, number | null> = {
  responsive: null,
  desktop: 1440,
  tablet: 768,
  mobile: 390
};

const IMAGE_TARGET_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "svg",
  "avif",
  "bmp"
]);

const DOCUMENT_TARGET_EXTENSIONS = new Set(["txt", "log", "json", "yaml", "yml", "csv"]);
const MIN_IMAGE_ZOOM = 0.5;
const MAX_IMAGE_ZOOM = 8;
const EMPTY_NATIVE_BROWSER_STATE: NativeBrowserState = {
  url: "",
  title: "",
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
  visible: false
};

function clampImageZoom(value: number): number {
  return Math.min(MAX_IMAGE_ZOOM, Math.max(MIN_IMAGE_ZOOM, value));
}

function extensionFromLocalPath(filePath: string): string {
  return filePath.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
}

export function browserTargetExtension(
  target: string | undefined,
  url: string | undefined
): string {
  const value = target || url || "";
  try {
    const parsed = new URL(value, "http://local.invalid");
    if (
      parsed.protocol === "freebuddy-file:" ||
      parsed.pathname === "/api/attachment"
    ) {
      const filePath = parsed.searchParams.get("path") ?? parsed.pathname;
      return extensionFromLocalPath(filePath);
    }
    return extensionFromLocalPath(parsed.pathname);
  } catch {
    return extensionFromLocalPath(value);
  }
}

function isMarkdownTarget(target: string | undefined, url: string | undefined): boolean {
  return browserTargetExtension(target, url) === "md";
}

export function isImageBrowserTarget(
  target: string | undefined,
  url: string | undefined
): boolean {
  return IMAGE_TARGET_EXTENSIONS.has(browserTargetExtension(target, url));
}

function isDocumentTarget(target: string | undefined, url: string | undefined): boolean {
  return DOCUMENT_TARGET_EXTENSIONS.has(browserTargetExtension(target, url));
}

function isPdfTarget(target: string | undefined, url: string | undefined): boolean {
  return browserTargetExtension(target, url) === "pdf";
}

export function isExternalOnlyBrowserTarget(value: string | undefined): boolean {
  if (!value || !/^https?:\/\//i.test(value)) return false;
  try {
    const { hostname } = new URL(value);
    return hostname === "mp.weixin.qq.com";
  } catch {
    return false;
  }
}

function extractAssistantText(content: string): string {
  if (!content) return "";
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item: any) => {
          if (typeof item === "string") return item;
          if (item?.type === "text" || item?.kind === "text") return item.text || item.content || "";
          if (item?.type === "message" || item?.kind === "message") return item.text || item.content || "";
          return item?.text || item?.content || "";
        })
        .filter(Boolean)
        .join("\n");
    }
  } catch {
    /* plain text */
  }
  return content;
}

function extractAgentMoveFromText(text: string): {
  action: string;
  speech?: string;
  thought?: string;
  mood?: "confident" | "mocking" | "nervous" | "calm" | "admiring";
} | null {
  if (!text) return null;

  // 1. Try finding json code blocks
  const jsonBlocks = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/gi);
  if (jsonBlocks) {
    for (const block of jsonBlocks) {
      const clean = block.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
      try {
        const parsed = JSON.parse(clean);
        if (parsed && typeof parsed === "object") {
          const action = parsed.action || parsed.actionId || parsed.move || parsed.position || parsed.coord;
          if (typeof action === "string" && /^(?:[A-O]\d{1,2}|[a-i]\d[a-i]\d)$/i.test(action.trim())) {
            return {
              action: action.trim(),
              speech: parsed.speech || parsed.chat || parsed.message || parsed.reply,
              thought: parsed.thought || parsed.reason,
              mood: parsed.mood
            };
          }
        }
      } catch {
        /* try next block */
      }
    }
  }

  // 2. Try parsing raw JSON
  try {
    const parsed = JSON.parse(text.trim());
    if (parsed && typeof parsed === "object") {
      const action = parsed.action || parsed.actionId || parsed.move || parsed.position || parsed.coord;
      if (typeof action === "string" && /^(?:[A-O]\d{1,2}|[a-i]\d[a-i]\d)$/i.test(action.trim())) {
        return {
          action: action.trim(),
          speech: parsed.speech || parsed.chat || parsed.message,
          thought: parsed.thought || parsed.reason,
          mood: parsed.mood
        };
      }
    }
  } catch {
    /* fallback to regex */
  }

  // 3. Fallback regex for move commands e.g. "move: H8" or "move: b2e2"
  const regexMatch = text.match(/(?:\u843d\u5b50|\u8d70\u5b50|\u8d70\u6b65|action|move|coordinate|\u5750\u6807|\u8d70|\u4e0b\u5728)[:\uff1a\s*#]+([A-O]\d{1,2}|[a-i]\d[a-i]\d)\b/i);
  if (regexMatch) {
    return {
      action: regexMatch[1].trim(),
      speech: text.replace(/[#*`]/g, "").slice(0, 100).trim()
    };
  }

  return null;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

export function isNativeRemoteBrowserTarget(value: string | undefined): boolean {
  return remoteBrowserOrigin(value) !== null;
}

function isInsecureRemoteBrowserTarget(value: string | undefined): boolean {
  if (!value || !/^http:\/\//i.test(value)) return false;
  try {
    return !isLoopbackHostname(new URL(value).hostname);
  } catch {
    return false;
  }
}

export const isExternalOnlyDraftTarget = isExternalOnlyBrowserTarget;

function documentRel(target: string | undefined): string | null {
  if (!target || /^https?:\/\//i.test(target)) return null;
  const rel = target.split("?")[0].trim();
  const ext = rel.split(".").pop()?.toLowerCase() ?? "";
  return ext === "md" || DOCUMENT_TARGET_EXTENSIONS.has(ext) ? rel : null;
}

function formatDocumentContent(ext: string, content: string): string {
  if (ext !== "json") return content;
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

function DocumentText({ content, extension }: { content: string; extension: string }) {
  return <pre className={`browser-document-text draft-document-text ${extension}`}>{formatDocumentContent(extension, content)}</pre>;
}

function extractLastFileEditPath(
  items: CliStreamItem[] | undefined,
  messages: ConversationMessage[]
): string | undefined {
  if (items && items.length) {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const it = items[i];
      if (it.kind === "file-edit" && it.path) return it.path;
    }
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    try {
      const parsed = JSON.parse(message.content) as unknown;
      if (!Array.isArray(parsed)) continue;
      const parsedItems = parsed as CliStreamItem[];
      for (let j = parsedItems.length - 1; j >= 0; j -= 1) {
        const it = parsedItems[j];
        if (it.kind === "file-edit" && it.path) return it.path;
      }
    } catch {
      // ignore legacy plain content
    }
  }
  return undefined;
}

export function BrowserCanvas({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState<BrowserViewport>("responsive");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [documentText, setDocumentText] = useState<string | null>(null);
  const [feedActionId, setFeedActionId] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const nativeHostRef = useRef<HTMLDivElement | null>(null);
  const [nativeBrowserState, setNativeBrowserState] = useState<NativeBrowserState>(
    EMPTY_NATIVE_BROWSER_STATE
  );
  const [containerWidth, setContainerWidth] = useState(440);

  useEffect(() => {
    if (!bodyRef.current) return;
    const update = () => {
      if (bodyRef.current) {
        const w = bodyRef.current.clientWidth;
        if (w > 0) setContainerWidth(w);
      }
    };
    update();
    const observer = new ResizeObserver(() => update());
    observer.observe(bodyRef.current);
    return () => observer.disconnect();
  }, []);
  const activeId = useConversationStore((s) => s.activeId);
  const conversations = useConversationStore((s) => s.conversations);
  const cwd = useConversationStore((s) => {
    const conv = s.conversations.find((c) => c.id === s.activeId);
    return conv?.cwd;
  });
  const liveItems = useConversationStore((s) =>
    s.activeId ? s.live[s.activeId]?.items : undefined
  );
  const messages = useConversationStore((s) =>
    s.activeId ? s.messages[s.activeId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES
  );
  const members = useConversationStore((s) => s.members);
  const newConversation = useConversationStore((s) => s.newConversation);
  const sendMessage = useConversationStore((s) => s.sendMessage);
  const isRunning = useConversationStore((s) => (s.activeId ? s.isRunning(s.activeId) : false));
  const feedItems = useFeedStore((s) => s.items);
  const markInterpreted = useFeedStore((s) => s.markInterpreted);
  const entry = useBrowserStore((s) =>
    activeId ? s.byConv[activeId] : undefined
  );
  const active = conversations.find((conv) => conv.id === activeId);
  const hasEntry = Boolean(entry?.url);
  const isMarkdown = isMarkdownTarget(entry?.manualEntry, entry?.url);
  const isImage = isImageBrowserTarget(entry?.manualEntry, entry?.url);
  const isDocument = isDocumentTarget(entry?.manualEntry, entry?.url);
  const isPdf = isPdfTarget(entry?.manualEntry, entry?.url);
  const nativeBrowserAvailable = cliClient.supportsNativeBrowser();
  const isNativeRemote =
    nativeBrowserAvailable && isNativeRemoteBrowserTarget(entry?.manualEntry);
  const isExternalOnly =
    (!isNativeRemote && isExternalOnlyBrowserTarget(entry?.manualEntry)) ||
    isInsecureRemoteBrowserTarget(entry?.manualEntry);
  const pdfUrl = isPdf && entry?.url ? `${entry.url}#view=FitH&navpanes=0` : "";
  const documentExtension = browserTargetExtension(entry?.manualEntry, entry?.url);
  const frameWidth = FRAME_WIDTH[viewport];
  const baseScale = frameWidth && frameWidth > containerWidth ? containerWidth / frameWidth : 1;
  const effectiveScale = (isImage ? 1 : zoom) * baseScale;
  const currentFeedItem = useMemo(
    () => feedItems.find((item) => item.link === entry?.manualEntry),
    [feedItems, entry?.manualEntry]
  );
  const isActiveFeedConversation = isFeedInterpretConversation(messages);

  const canGoBack = isNativeRemote
    ? nativeBrowserState.canGoBack
    : Boolean(entry && entry.historyIndex > 0);
  const canGoForward = isNativeRemote
    ? nativeBrowserState.canGoForward
    : Boolean(entry && entry.history && entry.historyIndex < entry.history.length - 1);

  useEffect(() => {
    if (!activeId) return;
    void useBrowserStore.getState().ensureFor(activeId, cwd);
  }, [activeId, cwd]);

  useEffect(() => {
    if (!activeId || active?.kind !== "game") return;
    const gameType = active.metadata?.gameType;
    if (!isBundledGameType(gameType)) return;
    const current = useBrowserStore.getState().byConv[activeId];
    if (current?.manualEntry) return;
    useBrowserStore.getState().navigate(activeId, bundledGameEntry(gameType));
  }, [activeId, active?.kind, active?.metadata]);

  const lastEditPath = useMemo(
    () => extractLastFileEditPath(liveItems, messages),
    [liveItems, messages]
  );

  useEffect(() => {
    if (!activeId || !lastEditPath) return;
    const ext = lastEditPath.split(".").pop()?.toLowerCase();
    const delay = ext === "css" || ext === "html" || ext === "htm" ? 120 : 450;
    useBrowserStore.getState().scheduleReload(activeId, delay);
  }, [activeId, lastEditPath]);

  useEffect(() => {
    if (!entry?.url) return;
    setIsLoading(true);
    setError(null);
    setMarkdown(null);
    setDocumentText(null);
    if (activeId) {
      useBrowserStore.getState().setLoadState(activeId, "loading");
    }
  }, [activeId, entry?.url]);

  useEffect(() => {
    if (!activeId || !entry?.url || !isExternalOnly) return;
    setIsLoading(false);
    useBrowserStore.getState().setLoadState(activeId, "ready");
  }, [activeId, entry?.url, isExternalOnly]);

  useEffect(() => {
    if (!nativeBrowserAvailable) return;
    return cliClient.onNativeBrowserState((state) => {
      setNativeBrowserState(state);
      if (!activeId || !isNativeRemote) return;
      if (state.url) {
        useBrowserStore.getState().setNativeBrowserUrl(activeId, state.url);
      }
      setIsLoading(state.isLoading);
      useBrowserStore
        .getState()
        .setLoadState(activeId, state.isLoading ? "loading" : "ready");
    });
  }, [activeId, isNativeRemote, nativeBrowserAvailable]);

  // Bridge game canvas iframe with FreeBuddy Game Service and Agent session
  const processedMessageIdsRef = useRef<Set<string>>(new Set());

  const activeConversation = useConversationStore((s) =>
    activeId ? s.conversations.find((c) => c.id === activeId) : undefined
  );

  const agentInfo = useMemo(() => {
    if (!activeConversation) return null;
    const member = builtinCliMembers.find((m) => m.id === activeConversation.agentId);
    const iconId =
      activeConversation.agentId === "cli-butlerbuddy"
        ? "Bilibili"
        : getAgentIconId(activeConversation.adapter, member?.avatar);
    const avatarUrl = iconId ? lobehubAvatarUrl(iconId) : undefined;
    const model =
      activeConversation.configOptionOverrides?.model ||
      activeConversation.configOptionOverrides?.model_config ||
      (activeConversation.metadata as any)?.model ||
      "";

    return {
      agentId: activeConversation.agentId,
      agentName: activeConversation.agentName || member?.name || "AI Agent",
      avatarUrl: avatarUrl || "",
      modelName: model ? String(model) : ""
    };
  }, [activeConversation]);

  useEffect(() => {
    if (frameRef.current?.contentWindow && agentInfo) {
      frameRef.current.contentWindow.postMessage(
        { type: "AGENT_INFO_UPDATE", payload: agentInfo },
        "*"
      );
    }
  }, [agentInfo]);

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== "object" || !activeId) return;

      if (data.type === "PLAYER_MOVE" && data.payload?.actionId) {
        const actionId = String(data.payload.actionId);
        try {
          const moveRes = await window.freebuddy?.game?.playerMove(activeId, actionId);
          const legalMoves = moveRes?.gameState?.legalMoves;
          const candidateList = legalMoves && legalMoves.length > 0
            ? legalMoves.slice(0, 12).map((m: any) => `${m.coord}(${m.description || ""})`).join(", ")
            : "H8, G7, I9, H9";
          const suggestedCoord = legalMoves?.[0]?.coord || "H8";

          if (sendMessage) {
            const isXiangqi = moveRes?.gameState?.gameType === "xiangqi";
            const isWon = moveRes?.gameState?.status === "player_won";
            const promptText = isWon
              ? (isXiangqi ? t("game.playerMoveWonXiangqi", { actionId }) : t("game.playerMoveWonGomoku", { actionId }))
              : (isXiangqi ? t("game.playerMoveXiangqi", { actionId }) : t("game.playerMoveGomoku", { actionId }));

            void sendMessage({
              conversationId: activeId,
              prompt: promptText
            });
          }
        } catch (err) {
          console.error("[FreeBuddy] Failed to process player game move:", err);
        }
      } else if (data.type === "GAME_CANVAS_READY" || data.type === "REQUEST_SYNC") {
        try {
          const state = await window.freebuddy?.game?.getState(activeId);
          if (state && frameRef.current?.contentWindow) {
            frameRef.current.contentWindow.postMessage(
              { type: "FREEBUDDY_GAME_SYNC", payload: { ...state, agentInfo } },
              "*"
            );
          }
        } catch (err) {
          console.error("[FreeBuddy] Failed to fetch game state:", err);
        }
      } else if (data.type === "GAME_RESET") {
        try {
          await window.freebuddy?.game?.resetGame(activeId);
          if (sendMessage) {
            void sendMessage({
              conversationId: activeId,
              prompt: t("game.promptGameReset")
            });
          }
        } catch (err) {
          console.error("[FreeBuddy] Failed to reset game:", err);
        }
      } else if (data.type === "REMIND_AGENT") {
        if (sendMessage) {
          void sendMessage({
            conversationId: activeId,
            prompt: t("game.promptRemindAgent")
          });
        }
      } else if (data.type === "GAME_RESIGN") {
        if (sendMessage) {
          void sendMessage({
            conversationId: activeId,
            prompt: t("game.promptResign")
          });
        }
      }
    };

    window.addEventListener("message", handleMessage);
    const unbindGameEvent = window.freebuddy?.game?.onGameEvent((event: any) => {
      if (event?.conversationId && event.conversationId !== activeId) return;
      if (frameRef.current?.contentWindow && event?.payload) {
        frameRef.current.contentWindow.postMessage(
          { type: "FREEBUDDY_GAME_SYNC", payload: event.payload },
          "*"
        );
      }
    });

    return () => {
      window.removeEventListener("message", handleMessage);
      unbindGameEvent?.();
    };
  }, [activeId, sendMessage]);

  // Observe assistant messages in game conversations to extract moves even without native MCP tool calling
  useEffect(() => {
    if (!activeId || !messages.length) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.role === "assistant") {
      const text = extractAssistantText(lastMsg.content);
      const move = extractAgentMoveFromText(text);
      if (move) {
        const moveKey = `${lastMsg.id}:${move.action}`;
        if (!processedMessageIdsRef.current.has(moveKey)) {
          processedMessageIdsRef.current.add(moveKey);
          void window.freebuddy?.game?.agentMove(
            activeId,
            move.action,
            move.thought,
            move.speech,
            move.mood
          );
        }
      }
    }
  }, [activeId, messages]);

  // Monitor for abnormal stalls (Agent finished generation but turn is still White/2)
  useEffect(() => {
    if (!activeId) return;
    let timer: NodeJS.Timeout | null = null;

    const checkStall = async () => {
      try {
        const state = await window.freebuddy?.game?.getState(activeId);
        if (state && state.status === "playing" && state.turn === 2 && !isRunning) {
          timer = setTimeout(() => {
            if (frameRef.current?.contentWindow) {
              frameRef.current.contentWindow.postMessage(
                { type: "AGENT_STALLED", payload: { stalled: true } },
                "*"
              );
            }
          }, 2500);
        } else {
          if (frameRef.current?.contentWindow) {
            frameRef.current.contentWindow.postMessage(
              { type: "AGENT_STALLED", payload: { stalled: false } },
              "*"
            );
          }
        }
      } catch {
        /* best effort */
      }
    };

    void checkStall();

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [activeId, isRunning, messages]);

  useEffect(() => {
    if (!nativeBrowserAvailable || !isNativeRemote || !entry?.manualEntry) {
      if (nativeBrowserAvailable) void cliClient.hideNativeBrowser();
      setNativeBrowserState(EMPTY_NATIVE_BROWSER_STATE);
      return;
    }

    let cancelled = false;
    const syncNativeBrowser = async (navigate: boolean) => {
      const host = nativeHostRef.current;
      if (!host || cancelled) return;
      const rect = host.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const bounds = {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      };
      try {
        const state = navigate
          ? await cliClient.showNativeBrowser(entry.manualEntry!, bounds)
          : await cliClient.setNativeBrowserBounds(bounds);
        if (!cancelled) {
          setNativeBrowserState(state);
          if (activeId && state.url) {
            useBrowserStore.getState().setNativeBrowserUrl(activeId, state.url);
          }
          setIsLoading(state.isLoading);
        }
      } catch (nativeError) {
        if (cancelled) return;
        void cliClient.hideNativeBrowser();
        setError((nativeError as Error)?.message || t("browser.loadError"));
        setIsLoading(false);
        if (activeId) {
          useBrowserStore
            .getState()
            .setLoadState(activeId, "error", t("browser.loadError"));
        }
      }
    };

    const frame = window.requestAnimationFrame(() => void syncNativeBrowser(true));
    const observer = new ResizeObserver(() => void syncNativeBrowser(false));
    if (nativeHostRef.current) observer.observe(nativeHostRef.current);
    const onWindowResize = () => void syncNativeBrowser(false);
    window.addEventListener("resize", onWindowResize);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", onWindowResize);
      void cliClient.hideNativeBrowser();
    };
  }, [activeId, entry?.manualEntry, isNativeRemote, nativeBrowserAvailable, t]);

  useEffect(() => {
    if (!activeId || !entry?.url || (!isMarkdown && !isDocument)) return;
    const absolute = splitAbsoluteLocalFile(entry.manualEntry ?? "");
    const rel = documentRel(entry?.manualEntry);
    const root = absolute?.root ?? cwd;
    const fileRel = absolute?.rel ?? rel;
    if (!root || !fileRel) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    void cliClient
      .readBrowserMarkdown(root, fileRel)
      .then((text) => {
        if (cancelled) return;
        if (text == null) throw new Error("Document not found");
        if (isMarkdown) {
          setMarkdown(text);
          setDocumentText(null);
        } else {
          setDocumentText(text);
          setMarkdown(null);
        }
        setIsLoading(false);
        useBrowserStore.getState().setLoadState(activeId, "ready");
      })
      .catch(() => {
        if (cancelled) return;
        setMarkdown(null);
        setDocumentText(null);
        setIsLoading(false);
        setError(t("browser.loadError"));
        useBrowserStore
          .getState()
          .setLoadState(activeId, "error", t("browser.loadError"));
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, entry?.manualEntry, entry?.url, isDocument, isMarkdown, t]);

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (!isImage || zoom <= 1) return;
      e.preventDefault();
      setIsDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY };
      panStart.current = { ...pan };
    },
    [isImage, pan, zoom]
  );

  const onDragMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setPan({
        x: panStart.current.x + dx,
        y: panStart.current.y + dy
      });
    },
    [isDragging]
  );

  const onImageWheel = useCallback(
    (event: React.WheelEvent) => {
      if (!isImage) return;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const delta = event.deltaY < 0 ? 0.25 : -0.25;
        setZoom((prev) => clampImageZoom(prev + delta));
      }
    },
    [isImage]
  );

  const onDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleInterpretFeedItem = async (item: FeedItem) => {
    if (!item.link || feedActionId) return;
    const member =
      members.find((entry) => entry.id === active?.agentId) ?? members[0];
    if (!member) return;
    setFeedActionId(item.id);
    try {
      const conv =
        active && isActiveFeedConversation
          ? active
          : await newConversation({
              member,
              cwd: active?.cwd,
              title: clipFeedTitle(item.title),
              approvalMode: active?.approvalMode ?? member.cli.approvalMode
            });
      await markInterpreted(item.id);
      await sendMessage({
        conversationId: conv.id,
        prompt: buildFeedInterpretPrompt(item, t),
        preserveConversationTitle: true,
        internalPrompt: true
      });
      if (!active || !isActiveFeedConversation) {
        useBrowserStore.getState().navigate(conv.id, item.link);
      }
    } finally {
      setFeedActionId(null);
    }
  };

  const handleMarkFeedItemRead = (item: FeedItem) => {
    markInterpreted(item.id);
  };

  return (
    <div className="browser-canvas draft-canvas">
      <BrowserToolbar
        url={isNativeRemote ? nativeBrowserState.url || entry?.manualEntry : entry?.url}
        target={isNativeRemote ? nativeBrowserState.url || entry?.manualEntry : entry?.manualEntry}
        viewport={viewport}
        zoom={zoom}
        showViewport={!isNativeRemote && !isImage && !isDocument && !isMarkdown && !isPdf}
        showZoom={isImage || isPdf}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        isLoading={isNativeRemote ? nativeBrowserState.isLoading : isLoading}
        feedItem={currentFeedItem}
        feedActionBusy={feedActionId === currentFeedItem?.id}
        onNavigate={(target) => activeId && useBrowserStore.getState().navigate(activeId, target)}
        onGoBack={() => {
          if (isNativeRemote) void cliClient.goBackNativeBrowser();
          else if (activeId) useBrowserStore.getState().goBack(activeId);
        }}
        onGoForward={() => {
          if (isNativeRemote) void cliClient.goForwardNativeBrowser();
          else if (activeId) useBrowserStore.getState().goForward(activeId);
        }}
        onReload={() => {
          if (isNativeRemote) void cliClient.reloadNativeBrowser();
          else if (activeId) useBrowserStore.getState().reload(activeId);
        }}
        onViewportChange={setViewport}
        onZoomChange={setZoom}
        onInterpretFeedItem={handleInterpretFeedItem}
        onMarkFeedItemRead={handleMarkFeedItemRead}
        onClose={onClose}
      />

      <div className="browser-body draft-body" ref={bodyRef}>
        {!hasEntry || !entry ? (
          <div className="browser-empty draft-empty">
            <p>
              {!cwd
                ? t("browser.emptyNoWorkspace")
                : t("browser.emptyNoEntry")}
            </p>
          </div>
        ) : isNativeRemote ? (
          <div
            ref={nativeHostRef}
            className="browser-frame-wrap native-browser-host"
            aria-label={t("browser.isolatedSession")}
          >
            <div className="browser-status draft-status">
              {t("browser.isolatedSessionLoading")}
            </div>
          </div>
        ) : isExternalOnly ? (
          <div className="browser-frame-wrap draft-frame-wrap external-only">
            <div className="browser-external-only draft-external-only">
              <strong>{t("browser.externalOnlyTitle")}</strong>
              <p>
                {t("browser.externalOnlyBody")}
              </p>
              <button
                type="button"
                className="browser-open-external-btn"
                onClick={() => entry.url && cliClient.openBrowserExternal(entry.url)}
              >
                {t("browser.openExternal")}
              </button>
            </div>
          </div>
        ) : isMarkdown ? (
          <div className="browser-frame-wrap draft-frame-wrap markdown">
            <div className="browser-markdown-wrap draft-markdown-wrap">
              {markdown ? <MarkdownText content={markdown} cwd={cwd} /> : <div className="browser-status draft-status">{t("browser.loading")}</div>}
            </div>
          </div>
        ) : isDocument ? (
          <div className="browser-frame-wrap draft-frame-wrap document">
            <div className="browser-document-wrap draft-document-wrap">
              {documentText ? (
                <DocumentText content={documentText} extension={documentExtension} />
              ) : (
                <div className="browser-status draft-status">{t("browser.loading")}</div>
              )}
            </div>
          </div>
        ) : isImage ? (
          <div
            className="browser-frame-wrap draft-frame-wrap image"
            onMouseDown={onDragStart}
            onMouseMove={onDragMove}
            onMouseUp={onDragEnd}
            onMouseLeave={onDragEnd}
            onWheel={onImageWheel}
          >
            <div
              className="browser-image-wrap draft-image-wrap"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                cursor: zoom > 1 ? (isDragging ? "grabbing" : "grab") : "default"
              }}
            >
              <img
                src={entry.url}
                alt={entry.manualEntry || "Image preview"}
                className="browser-image draft-image"
                onLoad={() => {
                  setIsLoading(false);
                  if (activeId) useBrowserStore.getState().setLoadState(activeId, "ready");
                }}
                onError={() => {
                  setIsLoading(false);
                  setError(t("browser.loadError"));
                  if (activeId) useBrowserStore.getState().setLoadState(activeId, "error", "Image load error");
                }}
              />
            </div>
          </div>
        ) : isPdf ? (
          <div className="browser-frame-wrap draft-frame-wrap pdf">
            <iframe
              ref={frameRef}
              src={pdfUrl}
              className="browser-frame draft-frame draft-pdf"
              title={entry.manualEntry || "PDF preview"}
              onLoad={() => {
                setIsLoading(false);
                if (activeId) useBrowserStore.getState().setLoadState(activeId, "ready");
              }}
              onError={() => {
                setIsLoading(false);
                setError(t("browser.loadError"));
                if (activeId) useBrowserStore.getState().setLoadState(activeId, "error", "PDF load error");
              }}
            />
          </div>
        ) : (
          <div
            className="browser-frame-wrap draft-frame-wrap"
            style={{
              width: "100%",
              height: "100%",
              overflow: "hidden",
              display: "flex",
              justifyContent: "center",
              alignItems: "flex-start"
            }}
          >
            <div
              style={
                frameWidth || effectiveScale !== 1
                  ? {
                      width: frameWidth ? `${frameWidth}px` : "100%",
                      height: `${100 / effectiveScale}%`,
                      transform: `scale(${effectiveScale})`,
                      transformOrigin: "top center",
                      flexShrink: 0
                    }
                  : { width: "100%", height: "100%" }
              }
            >
              <iframe
                ref={frameRef}
                src={entry.url}
                className="browser-frame draft-frame"
                title={entry.manualEntry || "Browser frame"}
                sandbox="allow-scripts allow-forms allow-modals allow-pointer-lock allow-same-origin"
                style={{ width: "100%", height: "100%", border: 0 }}
                onLoad={() => {
                  setIsLoading(false);
                  if (activeId) useBrowserStore.getState().setLoadState(activeId, "ready");
                }}
                onError={() => {
                  setIsLoading(false);
                  setError(t("browser.loadError"));
                  if (activeId) useBrowserStore.getState().setLoadState(activeId, "error", "Frame load error");
                }}
              />
            </div>
          </div>
        )}

        {isLoading && <div className="browser-loading-bar draft-loading-bar" />}
        {error && <div className="browser-error-banner draft-error">{error}</div>}
      </div>
    </div>
  );
}

export const DraftCanvas = BrowserCanvas;
