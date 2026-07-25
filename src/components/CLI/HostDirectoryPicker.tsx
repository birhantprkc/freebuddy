import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronUp, Folder, FolderOpen, X } from "lucide-react";

interface DirEntry {
  name: string;
}

interface ListDirsResult {
  path: string;
  parent: string | null;
  roots: string[];
  entries: DirEntry[];
}

function pathSep(p: string): string {
  return p.includes("\\") ? "\\" : "/";
}

function basename(p: string): string {
  const parts = p.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

function containingRoot(path: string, roots: string[]): string | null {
  const norm = (s: string) => s.replace(/\\/g, "/").replace(/\/+$/, "");
  const n = norm(path);
  for (const root of roots) {
    const r = norm(root);
    if (n === r || n.startsWith(r + "/")) return root;
  }
  return roots[0] ?? null;
}

export function HostDirectoryPicker({
  initialPath,
  onSelect,
  onClose
}: {
  initialPath?: string | null;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [cwd, setCwd] = useState<string | null>(initialPath ?? null);
  const [data, setData] = useState<ListDirsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  const load = useCallback(async (target: string | null) => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const qs = target ? `?path=${encodeURIComponent(target)}` : "";
      const res = await fetch(`/api/listDirs${qs}`);
      const json = (await res.json()) as { ok?: boolean; error?: string; result?: ListDirsResult };
      if (id !== reqId.current) return;
      if (!res.ok || !json.ok || !json.result) {
        setError(json.error || `http_${res.status}`);
        setData(null);
      } else {
        setData(json.result);
        setCwd(json.result.path);
      }
    } catch (e) {
      if (id !== reqId.current) return;
      setError((e as Error)?.message || "fetch_failed");
      setData(null);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(cwd);
  }, [load, cwd]);

  const navigate = (target: string | null) => {
    if (target === null) return;
    setCwd(target);
  };

  const result = data;
  const currentPath = result?.path ?? cwd ?? "";
  const sep = pathSep(currentPath);
  const roots = result?.roots ?? [];
  const root = result ? containingRoot(result.path, roots) : null;
  const relSegments =
    result && root ? result.path.slice(root.length).split(/[\\/]/).filter(Boolean) : [];

  return (
    <div
      className="modal-backdrop host-dir-picker-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) onClose();
      }}
    >
      <div
        className="modal host-dir-picker"
        role="dialog"
        aria-modal="true"
        aria-label={t("chat.selectWorkspaceTitle")}
      >
        <div className="host-dir-picker-header">
          <h3>{t("chat.selectWorkspaceTitle")}</h3>
          <button
            type="button"
            className="host-dir-picker-close"
            aria-label={t("common.cancel")}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <div className="host-dir-picker-toolbar">
          {roots.length > 1 && (
            <div className="host-dir-picker-roots" role="group">
              {roots.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`host-dir-picker-root${r === root ? " active" : ""}`}
                  title={r}
                  onClick={() => navigate(r)}
                >
                  <Folder size={14} />
                  <span>{basename(r)}</span>
                </button>
              ))}
            </div>
          )}

          <div className="host-dir-picker-breadcrumb">
            {result && root && (
              <>
                <button
                  type="button"
                  className="host-dir-picker-crumb"
                  onClick={() => navigate(root)}
                >
                  {basename(root)}
                </button>
                {relSegments.map((seg, idx) => {
                  const abs = root + sep + relSegments.slice(0, idx + 1).join(sep);
                  return (
                    <span key={abs} className="host-dir-picker-crumb-wrap">
                      <span className="host-dir-picker-crumb-sep">{sep}</span>
                      <button
                        type="button"
                        className="host-dir-picker-crumb"
                        onClick={() => navigate(abs)}
                      >
                        {seg}
                      </button>
                    </span>
                  );
                })}
              </>
            )}
          </div>

          <button
            type="button"
            className="host-dir-picker-up"
            disabled={!result?.parent}
            onClick={() => result?.parent && navigate(result.parent)}
          >
            <ChevronUp size={16} />
            {t("chat.selectWorkspaceUp")}
          </button>
        </div>

        <div className="host-dir-picker-entries">
          {loading ? (
            <p className="host-dir-picker-state">…</p>
          ) : error ? (
            <p className="host-dir-picker-state host-dir-picker-error">{error}</p>
          ) : result && result.entries.length === 0 ? (
            <p className="host-dir-picker-state">{t("chat.selectWorkspaceEmpty")}</p>
          ) : (
            result?.entries.map((entry) => {
              const abs = currentPath + sep + entry.name;
              return (
                <button
                  key={abs}
                  type="button"
                  className="host-dir-picker-entry"
                  onClick={() => navigate(abs)}
                >
                  <FolderOpen size={16} />
                  <span>{entry.name}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="host-dir-picker-footer">
          <code className="host-dir-picker-path" title={currentPath}>
            {currentPath}
          </code>
          <div className="host-dir-picker-actions">
            <button type="button" className="permission-btn" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="permission-btn permission-btn-primary"
              disabled={loading || !!error || !currentPath}
              onClick={() => currentPath && onSelect(currentPath)}
            >
              {t("chat.selectWorkspaceSelect")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
