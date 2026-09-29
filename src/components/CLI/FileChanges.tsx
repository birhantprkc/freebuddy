import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, ChevronRight, Copy, FileDiff as FileDiffIcon } from "lucide-react";
import type { CliStreamItem } from "@/services/cli/parsers";
import { useFileDiffStore } from "@/store/fileDiffStore";
import { useConversationStore } from "@/store/conversationStore";
import { buildFileDiff, collectFileEdits, foldDiffRows, type FileEdit } from "@/utils/fileDiff";
import { copyToClipboard } from "@/utils/clipboard";

export function FileChangesCard({ items, conversationId, messageId }: { items: CliStreamItem[]; conversationId: string; messageId: string }) {
  const { t } = useTranslation();
  const edits = useMemo(() => collectFileEdits(items), [items]);
  const [expanded, setExpanded] = useState(false);
  const files = useMemo(() => {
    const grouped = new Map<string, { path: string; index: number; added: number; removed: number; unknown: boolean }>();
    edits.forEach((edit, index) => {
      const file = grouped.get(edit.path) ?? { path: edit.path, index, added: 0, removed: 0, unknown: false };
      const diff = buildFileDiff(edit);
      file.added += diff.added;
      file.removed += diff.removed;
      file.unknown ||= !!diff.notice;
      grouped.set(edit.path, file);
    });
    return [...grouped.values()];
  }, [edits]);
  useEffect(() => setExpanded(false), [conversationId, messageId]);
  useEffect(() => { useFileDiffStore.getState().refresh(conversationId, messageId, edits); }, [conversationId, messageId, edits]);
  if (!edits.length) return null;
  const open = (index: number) => useFileDiffStore.getState().open({ conversationId, messageId, edits, index });
  const counts = (added: number, removed: number) => <span className="file-change-counts"><span>+{added}</span><span>-{removed}</span></span>;
  return <section className="file-changes-card" aria-label={t("fileDiff.title")}>
    {(expanded ? files : files.slice(0, 3)).map((file) => <button type="button" className="file-change-entry" key={file.path} title={file.path} aria-label={`${t("fileDiff.view")}: ${file.path}`} onClick={() => open(file.index)}>
      <FileDiffIcon size={18} className="file-change-icon" aria-hidden="true" />
      <span className="file-change-path">{file.path.split(/[\\/]/).pop() || file.path}</span>
      {file.unknown ? <span className="file-change-unavailable">{t("fileDiff.countsUnavailable")}</span> : counts(file.added, file.removed)}
      <ChevronRight size={16} className="file-change-chevron" aria-hidden="true" />
    </button>)}
    {files.length > 3 && <button type="button" className="file-changes-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      {t(expanded ? "fileDiff.showLess" : "fileDiff.showMore", { count: files.length - 3 })}<ChevronDown size={18} className={expanded ? "is-expanded" : undefined} />
    </button>}
  </section>;
}

function DiffContent({ edit }: { edit: FileEdit }) {
  const { t } = useTranslation();
  const diff = useMemo(() => buildFileDiff(edit), [edit]);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const rows = useMemo(() => expanded ? diff.rows : foldDiffRows(diff.rows), [diff, expanded]);
  const copy = async () => {
    const text = edit.patch ?? diff.rows.map((row) => `${row.kind === "add" ? "+" : row.kind === "delete" ? "-" : " "}${row.text}`).join("\n");
    try { await copyToClipboard(text); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  };
  return <>
    <div className="file-diff-heading">
      <strong title={edit.path}>{edit.path}</strong>
      {!diff.notice && <span className="file-diff-counts"><span>+{diff.added}</span> <span>−{diff.removed}</span></span>}
      {!!diff.rows.length && <button type="button" className="detail-panel-collapse-btn" onClick={() => void copy()} title={t(copied ? "fileDiff.copied" : "fileDiff.copy")} aria-label={t(copied ? "fileDiff.copied" : "fileDiff.copy")}>{copied ? <Check size={15} /> : <Copy size={15} />}</button>}
    </div>
    {diff.partial && <p className="file-diff-notice">{t("fileDiff.partial")}</p>}
    {diff.notice && <p className="file-diff-notice" role="status">{t(`fileDiff.${diff.notice}`)}</p>}
    {copyError && <p role="alert">{t("fileDiff.copyError")}</p>}
    {!diff.notice && !diff.added && !diff.removed && !diff.rows.some((row) => row.kind === "meta") && <p className="file-diff-notice">{t("fileDiff.identical")}</p>}
    <div className="file-diff-scroll" tabIndex={0} aria-label={t("fileDiff.title")}>
      <div className="file-diff-lines">
        {rows.map((row, index) => row.kind === "fold"
          ? <button type="button" className="file-diff-fold" key={index} onClick={() => setExpanded(true)}>{t("fileDiff.expand", { count: row.count })}</button>
          : <div className={`file-diff-line file-diff-${row.kind}`} key={index}>
            <span className="file-diff-number">{row.oldLine}</span><span className="file-diff-number">{row.newLine}</span>
            <span className="file-diff-sign">{row.kind === "add" ? "+" : row.kind === "delete" ? "−" : " "}</span><code>{row.text || " "}</code>
          </div>)}
      </div>
    </div>
  </>;
}

export function FileDiffPanel() {
  const { t } = useTranslation();
  const activeId = useConversationStore((s) => s.activeId);
  const selection = useFileDiffStore((s) => s.selection);
  const current = selection?.conversationId === activeId ? selection : undefined;
  const edit = current?.edits[current.index];
  return <section className="file-diff-panel" aria-label={t("fileDiff.title")}>
    {current && edit ? <>
      <label className="file-diff-picker">{t("fileDiff.record")}
        <select value={current.index} onChange={(event) => useFileDiffStore.getState().select(Number(event.target.value))}>
          {current.edits.map((item, index) => <option key={index} value={index}>{index + 1}. {item.path} · {t(`fileDiff.${item.action}`)}</option>)}
        </select>
      </label>
      <DiffContent key={`${current.conversationId}:${current.messageId}:${current.index}:${edit.path}`} edit={edit} />
    </> : <p className="file-diff-empty"><FileDiffIcon size={30} />{t("fileDiff.empty")}</p>}
  </section>;
}
