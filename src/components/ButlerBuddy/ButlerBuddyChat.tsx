import { ArrowUp, Circle, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";

import type { CliStreamItem } from "@/services/cli/parsers";
import type { ConversationMessage } from "@/services/cli/types";
import { cliClient } from "@/services/cli/client";
import { useCliExecutorStore } from "@/store/cliExecutorStore";
import { useConversationStore } from "@/store/conversationStore";

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
  const [ready, setReady] = useState(!hasDesktopBridge);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [previewMessages, setPreviewMessages] = useState(previewSeed);
  const [previewReplying, setPreviewReplying] = useState(false);
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
      <header className="butler-chat-header">
        <img src={petImageUrl} alt="" draggable={false} />
        <strong>ButlerBuddy</strong>
        <Circle
          className="butler-chat-online"
          size={7}
          strokeWidth={2}
          fill="currentColor"
          aria-label="在线"
        />
        <button
          type="button"
          className="butler-chat-close"
          aria-label="关闭 ButlerBuddy 对话"
          onClick={() => window.freebuddy?.butlerBuddy?.hideChat()}
        >
          <X size={15} strokeWidth={1.8} />
        </button>
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
              {message.role === "assistant" && (
                <img src={petImageUrl} alt="" draggable={false} />
              )}
              <div className="butler-chat-bubble">{message.text}</div>
            </div>
          ))
        )}
        {previewReplying && (
          <div className="butler-chat-row role-assistant">
            <img src={petImageUrl} alt="" draggable={false} />
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
