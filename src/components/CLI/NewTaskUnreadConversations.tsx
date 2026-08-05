import { useMemo } from "react";
import { LoaderCircle, MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";

import { displayAgentName } from "@/config/agentDisplay";
import { useConversationStore } from "@/store/conversationStore";
import { useWorkflowStore } from "@/store/workflowStore";
import { formatDisplayPath } from "@/utils/projectPaths";

import { AgentAvatar } from "./AgentAvatar";
import {
  conversationActivityTime,
  conversationDisplayCwd,
  projectLabelFromCwd
} from "./conversationProjectGrouping";

const UNREAD_PREVIEW_LIMIT = 3;

export function NewTaskUnreadConversations() {
  const { t } = useTranslation();
  const conversations = useConversationStore((s) => s.conversations);
  const unreadConversations = useConversationStore((s) => s.unreadConversations);
  const live = useConversationStore((s) => s.live);
  const setActive = useConversationStore((s) => s.setActive);
  const activeRuns = useWorkflowStore((s) => s.activeRuns);

  const unreadAll = useMemo(() => {
    return conversations
      .filter((conversation) => Boolean(unreadConversations[conversation.id]))
      .sort((a, b) => conversationActivityTime(b) - conversationActivityTime(a));
  }, [conversations, unreadConversations]);

  const unreadItems = unreadAll.slice(0, UNREAD_PREVIEW_LIMIT);

  if (unreadItems.length === 0) return null;

  return (
    <section
      className="new-task-unread"
      aria-label={t("chat.unreadConversationsAria")}
    >
      <div className="new-task-unread-header">
        <h2 className="new-task-unread-title">{t("chat.unreadConversations")}</h2>
        <span className="new-task-unread-count">{unreadAll.length}</span>
      </div>
      <ul className="new-task-unread-list">
        {unreadItems.map((conversation) => {
          const cwd = conversationDisplayCwd(conversation);
          const workspaceLabel = cwd ? projectLabelFromCwd(cwd) : "";
          const agentLabel = displayAgentName(
            conversation.agentName,
            conversation.adapter
          );
          const liveStatus = live[conversation.id]?.status;
          const isRunning =
            liveStatus === "running" || liveStatus === "starting";
          const isWorkflowRunning = activeRuns.some(
            (run) => run.conversationId === conversation.id
          );
          const isBusy = isRunning || isWorkflowRunning;
          const meta = [agentLabel, workspaceLabel].filter(Boolean).join(" · ");

          return (
            <li key={conversation.id}>
              <button
                type="button"
                className={`new-task-unread-item${isBusy ? " busy" : ""}`}
                title={conversation.title}
                onClick={() => void setActive(conversation.id)}
              >
                <AgentAvatar
                  adapter={conversation.adapter}
                  agentId={conversation.agentId}
                  className="new-task-unread-avatar"
                  fallback={<MessageSquare aria-hidden="true" />}
                />
                <span className="new-task-unread-copy">
                  <strong>{conversation.title}</strong>
                  {meta ? (
                    <small title={cwd ? formatDisplayPath(cwd) : undefined}>
                      {meta}
                    </small>
                  ) : null}
                </span>
                <span className="new-task-unread-side">
                  {isBusy ? (
                    <span
                      className="new-task-unread-running"
                      role="status"
                      aria-label={
                        isWorkflowRunning
                          ? t("workflow.runningIndicator")
                          : t("chat.agentRunning")
                      }
                      title={
                        isWorkflowRunning
                          ? t("workflow.runningIndicator")
                          : t("chat.agentRunning")
                      }
                    >
                      <LoaderCircle
                        aria-hidden="true"
                        size={14}
                        strokeWidth={1.75}
                      />
                    </span>
                  ) : (
                    <span
                      className="conv-unread-dot"
                      role="status"
                      aria-label={t("conversations.unread")}
                      title={t("conversations.unread")}
                    />
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
