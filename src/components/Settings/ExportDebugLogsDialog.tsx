import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDebugLogsDialogStore } from "@/store/debugLogsDialogStore";
import { useAgentBridgeStore } from "@/store/agentBridgeStore";

type Mode = "standard" | "full";

interface Preview {
  environment: Record<string, unknown>;
  files: Array<{ name: string; totalLines: number; lines: string[]; truncated: boolean }>;
}

export function ExportDebugLogsDialog() {
  const { t } = useTranslation();
  const open = useDebugLogsDialogStore((s) => s.open);
  const setOpen = useDebugLogsDialogStore((s) => s.setOpen);
  const notify = useAgentBridgeStore((s) => s.notify);
  const [mode, setMode] = useState<Mode>("standard");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPreview(null);
    window.freebuddy?.debugLogs
      ?.preview(mode)
      .then((p) => {
        if (!cancelled) setPreview(p as Preview);
      })
      .catch(() => {
        if (!cancelled) setPreview({ environment: {}, files: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [open, mode]);

  if (!open) return null;

  const close = () => {
    if (!busy) setOpen(false);
  };

  const doExport = async () => {
    setBusy(true);
    try {
      const result = await window.freebuddy?.debugLogs?.export(mode);
      if (result?.path) {
        notify(t("debugLogs.success", { path: result.path }));
        setOpen(false);
      }
    } catch (err) {
      notify(
        t("debugLogs.error", { message: (err as Error)?.message ?? String(err) })
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop debug-logs-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className="modal debug-logs-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("debugLogs.dialogTitle")}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
        }}
      >
        <h3>{t("debugLogs.dialogTitle")}</h3>

        <div className="debug-logs-modes" role="radiogroup">
          <label className="debug-logs-mode">
            <input
              type="radio"
              name="debug-logs-mode"
              checked={mode === "standard"}
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
          {!preview && <p className="muted">{t("debugLogs.previewLoading")}</p>}
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
            onClick={() => void doExport()}
          >
            {busy ? t("debugLogs.exporting") : t("debugLogs.export")}
          </button>
        </div>
      </div>
    </div>
  );
}
