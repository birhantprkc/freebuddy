import { ArrowUp, ChevronDown, Circle, MessageCirclePlus, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent
} from "react";

import { SessionConfigPicker } from "@/components/CLI/SessionConfigPicker";
import type { CliStreamItem } from "@/services/cli/parsers";
import type { ConversationMessage } from "@/services/cli/types";
import { cliClient } from "@/services/cli/client";
import { useCliExecutorStore } from "@/store/cliExecutorStore";
import { useConversationStore } from "@/store/conversationStore";
import type { ConfigOptionItem } from "@/store/sessionMetaUtils";
import { mergeSessionMetaItems } from "@/store/sessionMetaUtils";

const PET_CONVERSATION_SETTING = "butlerbuddy.petConversationId";
const BUTLERBUDDY_AGENT_ID = "cli-butlerbuddy";
const petImageUrl = `${import.meta.env.BASE_URL}butlerbuddy-pet.png`;
const EMPTY_MESSAGES: ConversationMessage[] = [];

type PreviewMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

const previewSeed: PreviewMessage[] = [
  {
    id: "preview-user",
    role: "user",
    text: "帮我看看为什么 Codex 连不上"
  },
  {
    id: "preview-assistant",
    role: "assistant",
    text: "我正在检查连接和 CLI 状态…"
  }
];

function parseAssistantItems(content: string): CliStreamItem[] {
  try {
    const parsed = JSON.parse(content) as unknown;
    return Array.isArray(parsed) ? (parsed as CliStreamItem[]) : [];
  } catch {
    return content.trim()
      ? [{ kind: "raw", content }]
      : [];
  }
}

function assistantText(
  message: ConversationMessage,
  liveItems?: CliStreamItem[]
): string {
  const items = liveItems ?? parseAssistantItems(message.content);
  return items
    .flatMap((item) => {
      if (item.kind === "text" && item.role === "assistant") {
        return item.content;
      }
      if (item.kind === "raw") return item.content;
      if (item.kind === "error") return item.message;
      return [];
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export function ButlerBuddyChat() {
  const hasDesktopBridge = cliClient.isAvailable();
  const showHeaderTools = hasDesktopBridge || import.meta.env.DEV;
  const [ready, setReady] = useState(!hasDesktopBridge);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [previewMessages, setPreviewMessages] = useState(previewSeed);
  const [previewReplying, setPreviewReplying] = useState(false);
  const [probedConfigOptions, setProbedConfigOptions] = useState<ConfigOptionItem[]>([]);
  const [probeLoading, setProbeLoading] = useState(false);
  const initializationStartedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeId = useConversationStore((state) => state.activeId);
  const messages = useConversationStore((state) =>
    state.activeId ? state.messages[state.activeId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES
  );
  const live = useConversationStore((state) =>
    state.activeId ? state.live[state.activeId] : undefined
  );
  const conversation = useConversationStore((state) =>
    state.activeId
      ? state.conversations.find((entry) => entry.id === state.activeId)
      : undefined
  );
  const member = useConversationStore((state) =>
    state.members.find((entry) => entry.id === BUTLERBUDDY_AGENT_ID)
  );
  const running = live?.status === "starting" || live?.status === "running";

  const visibleMessages = useMemo(() => {
    if (!hasDesktopBridge) return previewMessages;
    return messages
      .map((message): PreviewMessage | null => {
        if (message.role !== "user" && message.role !== "assistant") {
          return null;
        }
        const text =
          message.role === "assistant"
            ? assistantText(
                message,
                live?.messageId === message.id ? live.items : undefined
              )
            : message.content.trim();
        if (!text && !(message.role === "assistant" && running)) return null;
        return {
          id: message.id,
          role: message.role,
          text: text || "正在思考…"
        };
      })
      .filter((message): message is PreviewMessage => Boolean(message))
      .slice(-30);
  }, [hasDesktopBridge, live, messages, previewMessages, running]);

  // Model candidates: prefer the config-options the agent streamed during this
  // conversation (authoritative, reflects the active model); fall back to
  // probing the butler adapter so the model list is available before the first
  // run too.
  const streamedConfigOptions = useMemo(() => {
    if (!hasDesktopBridge) return [] as ConfigOptionItem[];
    const meta = mergeSessionMetaItems(
      messages
        .filter((message) => message.role === "assistant")
        .flatMap((message) => {
          try {
            const items = JSON.parse(message.content);
            return Array.isArray(items) ? (items as CliStreamItem[]) : [];
          } catch {
            return [];
          }
        }),
      live?.items
    );
    return meta.configOptions;
  }, [hasDesktopBridge, live?.items, messages]);

  // A streamed config-options payload is only usable as the picker source when
  // it actually carries a candidate list. Some updates (e.g. session/
  // set_config_option) only echo back the current override with no `values`,
  // so falling back to anything non-empty would clobber the probe result and
  // leave the dropdown empty.
  const streamedHasModelList = streamedConfigOptions.some(
    (option) => Array.isArray(option.values) && option.values.length > 0
  );
  const modelOptions = streamedHasModelList
    ? streamedConfigOptions
    : probedConfigOptions.length > 0
      ? probedConfigOptions
      : streamedConfigOptions;

  const initializeConversation = useCallback(async () => {
    if (!hasDesktopBridge) return;
    setReady(false);
    setError("");
    try {
      await useCliExecutorStore.getState().load();
      await useConversationStore.getState().load();

      const state = useConversationStore.getState();
      const savedId = await cliClient.getSetting(PET_CONVERSATION_SETTING);
      let conversation = savedId
        ? state.conversations.find(
            (entry) =>
              entry.id === savedId && entry.agentId === BUTLERBUDDY_AGENT_ID
          )
        : undefined;

      if (!conversation) {
        const member = state.members.find(
          (entry) => entry.id === BUTLERBUDDY_AGENT_ID
        );
        if (!member) throw new Error("ButlerBuddy Agent 不可用");
        conversation = await state.newConversation({
          member,
          title: "ButlerBuddy 浮窗"
        });
        await cliClient.setSetting(PET_CONVERSATION_SETTING, conversation.id);
      }

      await useConversationStore.getState().setActive(conversation.id);
      await useConversationStore.getState().loadMessages(conversation.id);
      setReady(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setReady(true);
    }
  }, [hasDesktopBridge]);

  useEffect(() => {
    if (initializationStartedRef.current) return;
    initializationStartedRef.current = true;
    void initializeConversation();
  }, [initializeConversation]);

  useEffect(() => {
    if (!hasDesktopBridge) return;
    const offMessages = window.freebuddy?.cli?.onMessagesChanged?.(
      (conversationId) => {
        const state = useConversationStore.getState();
        if (conversationId !== state.activeId) return;
        const currentLive = state.live[conversationId];
        if (
          currentLive?.status === "starting" ||
          currentLive?.status === "running"
        ) {
          return;
        }
        void state.loadMessages(conversationId);
      }
    );
    return () => offMessages?.();
  }, [hasDesktopBridge]);

  // Header drives the same main-process group drag the pet uses, so the pet and
  // chat translate together. `-webkit-app-region: drag` is not used because its
  // `move` event does not fire reliably on Windows during a native drag.
  useEffect(() => {
    const endDrag = () => window.freebuddy?.butlerBuddy?.endDrag?.();
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("mouseup", endDrag);
    window.addEventListener("blur", endDrag);
    return () => {
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("mouseup", endDrag);
      window.removeEventListener("blur", endDrag);
    };
  }, []);

  const onHeaderPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    // Don't start a drag from interactive header controls.
    if (
      (event.target as HTMLElement).closest(
        ".butler-chat-close, .butler-chat-action, .butler-model-picker"
      )
    )
      return;
    window.freebuddy?.butlerBuddy?.beginDrag?.();
  };

  // Probe the butler adapter for its model list when the conversation hasn't
  // streamed config-options yet (e.g. a brand-new conversation). Re-runs when
  // the adapter changes.
  useEffect(() => {
    if (!hasDesktopBridge) return;
    if (streamedHasModelList) {
      setProbedConfigOptions([]);
      return;
    }
    const m = useConversationStore
      .getState()
      .members.find((entry) => entry.id === BUTLERBUDDY_AGENT_ID);
    if (!m || !cliClient.isAvailable()) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const resolved = useCliExecutorStore.getState().resolve(m.cli.adapter);
      const probeInput = {
        agentId: m.id,
        adapter: m.cli.adapter,
        binary: m.cli.binary || resolved?.binary,
        extraArgs: [
          ...(resolved?.extraArgs ?? []),
          ...(m.cli.extraArgs ?? [])
        ],
        env: { ...(resolved?.env ?? {}), ...(m.cli.env ?? {}) },
        cwd: undefined
      };
      setProbeLoading(true);
      void (async () => {
        try {
          const cached = await cliClient.getCachedSessionConfigOptions(probeInput);
          if (cancelled) return;
          if (cached.length > 0) setProbedConfigOptions(cached);
          const fresh = await cliClient.inspectSessionConfigOptions(probeInput);
          if (cancelled) return;
          if (fresh.length > 0) setProbedConfigOptions(fresh);
        } catch {
          /* best-effort: the picker just stays unavailable */
        } finally {
          if (!cancelled) setProbeLoading(false);
        }
      })();
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hasDesktopBridge, streamedHasModelList, member?.cli.adapter]);

  const onModelChange = (next: Record<string, string>) => {
    if (!activeId) return;
    void useConversationStore
      .getState()
      .setConversationConfigOptionOverrides(activeId, next);
    // Start a fresh agent session on the next send so the newly chosen model is
    // applied at session/new time instead of being lost on a resumed session.
    useConversationStore.getState().requestFreshContext(activeId);
  };

  const startNewConversation = async () => {
    if (running || !hasDesktopBridge) return;
    setError("");
    setDraft("");
    try {
      const state = useConversationStore.getState();
      const m = state.members.find((entry) => entry.id === BUTLERBUDDY_AGENT_ID);
      if (!m) throw new Error("ButlerBuddy Agent 不可用");
      const created = await state.newConversation({
        member: m,
        title: "ButlerBuddy 浮窗"
      });
      await cliClient.setSetting(PET_CONVERSATION_SETTING, created.id);
      await state.setActive(created.id);
      await state.loadMessages(created.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  // "新会话" is triggered from the pet's right-click menu (handled in the main
  // process, which forwards here). Keep a ref so the listener always calls the
  // latest closure without resubscribing.
  const startNewConversationRef = useRef(startNewConversation);
  startNewConversationRef.current = startNewConversation;
  useEffect(() => {
    if (!hasDesktopBridge) return;
    const off = window.freebuddy?.butlerBuddy?.onNewConversation?.(() => {
      void startNewConversationRef.current();
    });
    return () => off?.();
  }, [hasDesktopBridge]);

  useEffect(() => {
    const focusComposer = () => inputRef.current?.focus();
    window.addEventListener("focus", focusComposer);
    const timer = window.setTimeout(focusComposer, 80);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", focusComposer);
    };
  }, [ready]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth"
    });
  }, [visibleMessages, running, previewReplying]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt || running || previewReplying || !ready) return;
    setDraft("");
    setError("");

    if (!hasDesktopBridge) {
      const id = `${Date.now()}`;
      setPreviewMessages((current) => [
        ...current,
        { id: `${id}-user`, role: "user", text: prompt }
      ]);
      setPreviewReplying(true);
      window.setTimeout(() => {
        setPreviewMessages((current) => [
          ...current,
          {
            id: `${id}-assistant`,
            role: "assistant",
            text: "收到，我会在 FreeBuddy 里帮你检查。"
          }
        ]);
        setPreviewReplying(false);
      }, 650);
      return;
    }

    if (!activeId) {
      setError("ButlerBuddy 对话尚未准备好");
      return;
    }

    try {
      // This companion is a separate renderer with its own store; an adapter
      // change made in the main window's Settings is persisted but not pushed
      // here. Re-read the override so sendMessage uses the current adapter.
      await useConversationStore.getState().reloadMemberRuntimeOverrides();
      await useConversationStore.getState().sendMessage({
        conversationId: activeId,
        prompt
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section className="butler-chat-window" aria-label="ButlerBuddy chat">
      <header className="butler-chat-header" onPointerDown={onHeaderPointerDown}>
        <div className="butler-chat-brand">
          <img src={petImageUrl} alt="" draggable={false} />
          <strong>ButlerBuddy</strong>
          <Circle
            className="butler-chat-online"
            size={7}
            strokeWidth={2}
            fill="currentColor"
            aria-label="在线"
          />
        </div>
        <div className="butler-chat-header-controls">
          {showHeaderTools && (
            <div className="butler-chat-header-tools">
              <SessionConfigPicker
                className="butler-model-picker"
                options={modelOptions}
                overrides={conversation?.configOptionOverrides}
                disabled={running || !ready}
                trailingIcon={<ChevronDown size={13} strokeWidth={2.2} />}
                fallback={
                  <span
                    className="butler-model-fallback"
                    title={
                      probeLoading ? "正在加载模型列表" : "当前适配器未提供模型列表"
                    }
                  >
                    {!hasDesktopBridge
                      ? "composer-2.5"
                      : probeLoading
                        ? "模型加载中…"
                        : "模型"}
                    <ChevronDown size={13} strokeWidth={2.2} aria-hidden="true" />
                  </span>
                }
                onChange={onModelChange}
              />
              <button
                type="button"
                className="butler-chat-action"
                aria-label="新会话"
                title="新会话"
                disabled={running || !ready}
                onClick={() => void startNewConversation()}
              >
                <MessageCirclePlus size={16} strokeWidth={1.8} />
              </button>
            </div>
          )}
          {showHeaderTools && (
            <span className="butler-chat-header-divider" aria-hidden="true" />
          )}
          <button
            type="button"
            className="butler-chat-close"
            aria-label="关闭 ButlerBuddy 对话"
            onClick={() => window.freebuddy?.butlerBuddy?.hideChat()}
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>
      </header>

      <div className="butler-chat-messages" ref={scrollRef} aria-live="polite">
        {!ready ? (
          <div className="butler-chat-loading">正在唤醒 ButlerBuddy…</div>
        ) : visibleMessages.length === 0 ? (
          <div className="butler-chat-empty">
            <img src={petImageUrl} alt="" draggable={false} />
            <span>有什么需要我帮你管理的吗？</span>
          </div>
        ) : (
          visibleMessages.map((message) => (
            <div
              key={message.id}
              className={`butler-chat-row role-${message.role}`}
            >
              <div className="butler-chat-bubble">{message.text}</div>
            </div>
          ))
        )}
        {previewReplying && (
          <div className="butler-chat-row role-assistant">
            <div className="butler-chat-bubble butler-chat-typing">正在回复…</div>
          </div>
        )}
      </div>

      {error && <div className="butler-chat-error">{error}</div>}

      <form className="butler-chat-composer" onSubmit={submit}>
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="发消息给 ButlerBuddy…"
          aria-label="发消息给 ButlerBuddy"
          disabled={!ready}
        />
        <button
          type="submit"
          aria-label="发送消息"
          disabled={!draft.trim() || running || previewReplying || !ready}
        >
          <ArrowUp size={17} strokeWidth={2} />
        </button>
      </form>
    </section>
  );
}
