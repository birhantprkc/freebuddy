import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useDebugLogsDialogStore } from "@/store/debugLogsDialogStore";
import { useAgentBridgeStore } from "@/store/agentBridgeStore";
import { useNewTaskUiStore } from "@/store/newTaskUiStore";
import { useConversationStore } from "@/store/conversationStore";
import {
  buildAgentLogSelfCheckPrompt,
  type AgentLogSelfCheckPreview
} from "@/utils/agentLogSelfCheck";

type Mode = "agent" | "standard" | "full";

type Preview = AgentLogSelfCheckPreview;

// Electron wraps ipcRenderer.invoke rejections, e.g.
// "Error invoking remote method 'debugLogs:export': Error: Export failed: <cause>".
// Strip the wrapper so toasts don't leak the IPC channel name (see
// skillMarketStore.parseMarketConfirmationMessage for the same pattern).
function unwrapInvokeError(err: unknown): string {
  const message = (err as Error)?.message ?? String(err);
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

export function ExportDebugLogsDialog() {
  const { t, i18n } = useTranslation();
  const open = useDebugLogsDialogStore((s) => s.open);
  const conversations = useConversationStore((s) => s.conversations);
  const setActiveConversation = useConversationStore((s) => s.setActive);
  const requestNewTask = useNewTaskUiStore((s) => s.requestNewTask);
  const setTaskMode = useNewTaskUiStore((s) => s.setTaskMode);
  const setOpen = useDebugLogsDialogStore((s) => s.setOpen);
  const conversationId = useDebugLogsDialogStore((s) => s.conversationId);
  const notify = useAgentBridgeStore((s) => s.notify);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [mode, setMode] = useState<Mode>("standard");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);

  // Conversation-scoped exports default to Agent self-check. Other entry
  // points keep the privacy-safe standard export as their default.
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setMode(conversationId ? "agent" : "standard");
  }

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previousFocusRef.current?.focus();
  }, [open]);
  const previewMode = mode === "standard" ? "standard" : "full";

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPreview(null);
    setPreviewError(false);
    const api = window.freebuddy?.debugLogs;
    if (!api) {
      setPreview({ environment: {}, files: [] });
      return;
    }
    api
      .preview(previewMode, conversationId ? { conversationId } : undefined)
      .then((p) => {
        if (!cancelled) setPreview(p as Preview);
      })
      .catch(() => {
        if (!cancelled) {
          setPreview(null);
          setPreviewError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, previewMode, conversationId]);

  if (!open) return null;

  const close = () => {
    if (!busy) setOpen(false);
  };

  const doExport = async () => {
    if (mode === "agent") return;
    setBusy(true);
    try {
      const result = await window.freebuddy?.debugLogs?.export(
        mode,
        conversationId ? { conversationId } : undefined
      );
      if (result?.path) {
        notify(t("debugLogs.success", { path: result.path }));
        setOpen(false);
      }
    } catch (err) {
      notify(t("debugLogs.error", { message: unwrapInvokeError(err) }));
    } finally {
      setBusy(false);
    }
  };

  const doSelfCheck = async () => {
    if (!conversationId) return;
    const sourceConversation = conversations.find(
      (entry) => entry.id === conversationId
    );
    if (!sourceConversation) return;

    setBusy(true);
    try {
      const debugLogs = window.freebuddy?.debugLogs;
      if (!debugLogs) {
        throw new Error("debug log API is unavailable");
      }
      const prepared = await debugLogs.prepareSelfCheck({ conversationId });

      const prompt = buildAgentLogSelfCheckPrompt({
        conversation: sourceConversation,
        logDirectory: prepared.path,
        language: i18n.resolvedLanguage ?? i18n.language
      });
      setTaskMode("normal");
      requestNewTask({ cwd: prepared.path, draft: prompt });
      setOpen(false);
      await setActiveConversation(undefined);
      notify(t("debugLogs.selfCheckReady"));
    } catch (err) {
      notify(t("debugLogs.selfCheckError", { message: unwrapInvokeError(err) }));
    } finally {
      setBusy(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
      ) ?? []
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        className="modal debug-logs-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h3 id={titleId}>{t("debugLogs.dialogTitle")}</h3>

        {conversationId && (
          <p className="muted debug-logs-scope">{t("debugLogs.scopeConversation")}</p>
        )}

        <div className="debug-logs-modes">
          {conversationId && (
            <label className="debug-logs-mode">
              <input
                type="radio"
                name="debug-logs-mode"
                checked={mode === "agent"}
                disabled={busy}
                onChange={() => setMode("agent")}
              />
              <span>
                <strong>{t("debugLogs.modeAgent")}</strong>
                <small>{t("debugLogs.modeAgentHint")}</small>
              </span>
            </label>
          )}
          <label className="debug-logs-mode">
            <input
              type="radio"
              name="debug-logs-mode"
              checked={mode === "standard"}
              disabled={busy}
              onChange={() => setMode("standard")}
            />
            <span>
              <strong>{t("debugLogs.modeStandard")}</strong>
              <small>{t("debugLogs.modeStandardHint")}</small>
            </span>
          </label>
          <label className="debug-logs-mode">
            <input
              type="radio"
              name="debug-logs-mode"
              checked={mode === "full"}
              disabled={busy}
              onChange={() => setMode("full")}
            />
            <span>
              <strong>{t("debugLogs.modeFull")}</strong>
              <small className="debug-logs-mode-warning">
                {t("debugLogs.modeFullWarning")}
              </small>
            </span>
          </label>
        </div>

        <div className="debug-logs-preview">
          {previewError && (
            <p className="muted">{t("debugLogs.previewError")}</p>
          )}
          {!previewError && !preview && (
            <p className="muted">{t("debugLogs.previewLoading")}</p>
          )}
          {preview && (
            <details className="debug-logs-preview-file">
              <summary>environment.json</summary>
              <pre>{JSON.stringify(preview.environment, null, 2)}</pre>
            </details>
          )}
          {preview && preview.files.length === 0 && (
            <p className="muted">{t("debugLogs.previewEmpty")}</p>
          )}
          {preview &&
            preview.files.map((f) => (
              <details key={f.name} className="debug-logs-preview-file">
                <summary>
                  {f.name}
                  {f.truncated && (
                    <small>
                      {" "}
                      {t("debugLogs.previewTruncated", {
                        shown: f.lines.length,
                        total: f.totalLines
                      })}
                    </small>
                  )}
                </summary>
                <pre>{f.lines.join("\n")}</pre>
              </details>
            ))}
        </div>

        <div className="debug-logs-actions">
          <button type="button" className="link-btn" disabled={busy} onClick={close}>
            {t("debugLogs.cancel")}
          </button>
          <button
            type="button"
            className="primary-btn"
            disabled={busy}
            onClick={() => void (mode === "agent" ? doSelfCheck() : doExport())}
          >
            {busy
              ? t(mode === "agent" ? "debugLogs.selfChecking" : "debugLogs.exporting")
              : t(mode === "agent" ? "debugLogs.selfCheck" : "debugLogs.export")}
          </button>
        </div>
      </div>
    </div>
  );
}
