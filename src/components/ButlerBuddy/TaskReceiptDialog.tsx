import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent
} from "react";
import { BadgeCheck, Copy, Download, Leaf, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import sidebarLogoUrl from "../../../assets/sidebar-logo.png";
import { useAgentBridgeStore } from "@/store/agentBridgeStore";
import { useTaskReceiptStore } from "@/store/taskReceiptStore";
import { copyToClipboard } from "@/utils/clipboard";
import { buildTaskReceiptSummary } from "@/utils/taskReceipt";
import { renderTaskReceiptPng } from "@/utils/taskReceiptImage";

const petImageUrl = `${import.meta.env.BASE_URL}butlerbuddy/states/posters/celebrating.png`;

function saveDataUrlWithBrowser(dataUrl: string, fileName: string) {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = fileName;
  anchor.click();
}

export function TaskReceiptDialog() {
  const { t, i18n } = useTranslation();
  const open = useTaskReceiptStore((state) => state.open);
  const completions = useTaskReceiptStore((state) => state.completions);
  const closeReport = useTaskReceiptStore((state) => state.closeReport);
  const notify = useAgentBridgeStore((state) => state.notify);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [saving, setSaving] = useState(false);
  const summary = buildTaskReceiptSummary(completions);
  const today = new Date();
  const dateLabel = new Intl.DateTimeFormat(
    i18n.resolvedLanguage?.startsWith("zh") ? "zh-CN" : "en",
    { year: "numeric", month: "long", day: "numeric" }
  ).format(today);
  const representativeTasks = summary.representativeTasks.length
    ? summary.representativeTasks
    : [t("taskReceipt.emptyTask")];

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previousFocusRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !saving) {
      event.preventDefault();
      closeReport();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [tabindex]:not([tabindex="-1"])'
      ) ?? []
    );
    if (!focusable.length) return;
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

  const shareText = t("taskReceipt.shareText", {
    count: summary.successCount,
    streak: summary.streakDays,
    rate: summary.completionRate
  });

  const saveReceipt = async () => {
    setSaving(true);
    try {
      const dataUrl = await renderTaskReceiptPng(
        {
          dateLabel,
          successCount: summary.successCount,
          streakDays: summary.streakDays,
          completionRate: summary.completionRate,
          tasks: summary.representativeTasks,
          copy: {
            brand: "FreeBuddy",
            title: t("taskReceipt.cardTitle"),
            completed: t("taskReceipt.completed"),
            itemUnit: t("taskReceipt.itemUnit"),
            streak: t("taskReceipt.streak"),
            dayUnit: t("taskReceipt.dayUnit"),
            completionRate: t("taskReceipt.completionRate"),
            approved: t("taskReceipt.approved")
          }
        },
        { logoUrl: sidebarLogoUrl, petUrl: petImageUrl }
      );
      const fileName = `FreeBuddy-${summary.dayKey || "task-receipt"}.png`;
      const result = await window.freebuddy?.window?.saveImage?.({
        dataUrl,
        suggestedName: fileName
      });
      if (window.freebuddy?.window?.saveImage && !result?.path) return;
      if (!window.freebuddy?.window?.saveImage) {
        saveDataUrlWithBrowser(dataUrl, fileName);
      }
      notify(
        result?.path
          ? t("taskReceipt.savedWithPath", { path: result.path })
          : t("taskReceipt.saved")
      );
    } catch (error) {
      notify(
        t("taskReceipt.saveFailed", {
          message: error instanceof Error ? error.message : String(error)
        })
      );
    } finally {
      setSaving(false);
    }
  };

  const copyShareText = async () => {
    try {
      await copyToClipboard(shareText);
      notify(t("taskReceipt.copied"));
    } catch {
      notify(t("taskReceipt.copyFailed"));
    }
  };

  return (
    <div
      className="modal-backdrop task-receipt-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) closeReport();
      }}
    >
      <div
        ref={dialogRef}
        className="task-receipt-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <button
          type="button"
          className="task-receipt-close"
          aria-label={t("taskReceipt.closeAria")}
          disabled={saving}
          onClick={closeReport}
        >
          <X size={22} strokeWidth={1.8} />
        </button>

        <article className="task-receipt-card" aria-label={t("taskReceipt.cardAria")}>
          <header className="task-receipt-brand-row">
            <span className="task-receipt-brand">
              <img src={sidebarLogoUrl} alt="" />
              <strong>FreeBuddy</strong>
            </span>
          </header>

          <h2 id={titleId}>{t("taskReceipt.cardTitle")}</h2>
          <div className="task-receipt-perforation" aria-hidden="true" />

          <section className="task-receipt-total">
            <span>{t("taskReceipt.completed")}</span>
            <Leaf
              className="task-receipt-laurel task-receipt-laurel-left"
              size={68}
              strokeWidth={1.3}
              aria-hidden="true"
            />
            <strong>{summary.successCount}</strong>
            <b>{t("taskReceipt.itemUnit")}</b>
            <Leaf
              className="task-receipt-laurel task-receipt-laurel-right"
              size={68}
              strokeWidth={1.3}
              aria-hidden="true"
            />
          </section>

          <ul className="task-receipt-list">
            {representativeTasks.slice(0, 3).map((task, index) => (
              <li key={`${task}-${index}`}>
                <BadgeCheck size={19} strokeWidth={2} aria-hidden="true" />
                <span title={task}>{task}</span>
              </li>
            ))}
          </ul>

          <section className="task-receipt-stats">
            <div>
              <span>{t("taskReceipt.streak")}</span>
              <strong>
                {summary.streakDays} {t("taskReceipt.dayUnit")}
              </strong>
            </div>
            <div>
              <span>{t("taskReceipt.completionRate")}</span>
              <strong>{summary.completionRate}%</strong>
            </div>
          </section>

          <div className="task-receipt-approval" aria-label={t("taskReceipt.approvedAria")}>
            <BadgeCheck size={34} strokeWidth={1.7} aria-hidden="true" />
            <span>ButlerBuddy</span>
            <strong>{t("taskReceipt.approved")}</strong>
          </div>

          <img
            className="task-receipt-pet"
            src={petImageUrl}
            alt={t("taskReceipt.petAlt")}
          />
          <time className="task-receipt-date" dateTime={summary.dayKey}>
            {dateLabel}
          </time>
        </article>

        <footer className="task-receipt-actions">
          <button
            type="button"
            className="primary"
            disabled={saving}
            onClick={() => void saveReceipt()}
          >
            <Download size={18} aria-hidden="true" />
            {saving ? t("taskReceipt.saving") : t("taskReceipt.save")}
          </button>
          <button type="button" onClick={() => void copyShareText()}>
            <Copy size={18} aria-hidden="true" />
            {t("taskReceipt.copy")}
          </button>
        </footer>
      </div>
    </div>
  );
}
