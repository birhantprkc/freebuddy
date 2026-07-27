import { useEffect, useId, useState } from "react";
import { Folder, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cliClient } from "@/services/cli/client";
import type { Project } from "@/services/cli/types";
import { useProjectStore } from "@/store/projectStore";
import { projectLabelFromCwd } from "./conversationProjectGrouping";

export type ProjectFormModalProps = {
  open: boolean;
  mode: "create" | "edit";
  initial?: Project | null;
  onClose: () => void;
  onSaved: (project: Project) => void;
  onDeleted?: (projectId: string) => void;
};

function normalizeFolderPath(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

function pathsEqual(a: string, b: string): boolean {
  return normalizeFolderPath(a).toLowerCase() === normalizeFolderPath(b).toLowerCase();
}

export function ProjectFormModal({
  open,
  mode,
  initial,
  onClose,
  onSaved,
  onDeleted
}: ProjectFormModalProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const createProject = useProjectStore((s) => s.create);
  const updateProject = useProjectStore((s) => s.update);
  const removeProject = useProjectStore((s) => s.remove);

  const [name, setName] = useState("");
  const [folders, setFolders] = useState<string[]>([]);
  const [primaryPath, setPrimaryPath] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && initial) {
      setName(initial.name);
      setFolders([...initial.folders]);
      setPrimaryPath(initial.primaryPath);
    } else {
      setName("");
      setFolders([]);
      setPrimaryPath("");
    }
    setSaving(false);
    setError(undefined);
  }, [open, mode, initial]);

  if (!open) return null;

  const canSave =
    name.trim().length > 0 &&
    folders.length > 0 &&
    folders.some((folder) => pathsEqual(folder, primaryPath));

  const addFolder = async () => {
    try {
      const path = await cliClient.selectDirectory();
      if (!path) return;
      const normalized = normalizeFolderPath(path);
      if (folders.some((folder) => pathsEqual(folder, normalized))) return;
      const nextFolders = [...folders, normalized];
      setFolders(nextFolders);
      if (!primaryPath) setPrimaryPath(normalized);
      if (!name.trim()) setName(projectLabelFromCwd(normalized));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const removeFolder = (path: string) => {
    const nextFolders = folders.filter((folder) => !pathsEqual(folder, path));
    setFolders(nextFolders);
    if (nextFolders.length === 0) {
      setPrimaryPath("");
      return;
    }
    if (pathsEqual(primaryPath, path)) {
      setPrimaryPath(nextFolders[0]);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError(t("conversations.projectNameRequired"));
      return;
    }
    if (folders.length === 0) {
      setError(t("conversations.projectFoldersRequired"));
      return;
    }
    const primary =
      folders.find((folder) => pathsEqual(folder, primaryPath)) ?? folders[0];
    setSaving(true);
    setError(undefined);
    try {
      const input = {
        name: name.trim(),
        folders: folders.map(normalizeFolderPath),
        primaryPath: normalizeFolderPath(primary)
      };
      const project =
        mode === "edit" && initial
          ? await updateProject({ id: initial.id, ...input })
          : await createProject(input);
      onSaved(project);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!initial) return;
    const confirmed = window.confirm(
      t("conversations.deleteProjectConfirmOnly", { name: initial.name })
    );
    if (!confirmed) return;
    setSaving(true);
    setError(undefined);
    try {
      await removeProject(initial.id);
      onDeleted?.(initial.id);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-backdrop project-form-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="modal project-form-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id={titleId}>
          {mode === "edit"
            ? t("conversations.editProject")
            : t("conversations.newProject")}
        </h3>

        <label className="project-form-field">
          <span>{t("conversations.projectNamePlaceholder")}</span>
          <div className="project-form-name-row">
            <Folder aria-hidden="true" size={16} strokeWidth={1.7} />
            <input
              type="text"
              value={name}
              autoFocus
              placeholder={t("conversations.projectNamePlaceholder")}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleSave();
                }
              }}
            />
          </div>
        </label>

        <div className="project-form-folders">
          <div className="project-form-folders-header">
            <span>{t("conversations.sourceFolders")}</span>
          </div>
          {folders.length === 0 ? (
            <p className="project-form-folders-empty muted">
              {t("conversations.projectFoldersRequired")}
            </p>
          ) : (
            <ul className="project-form-folder-list">
              {folders.map((folder) => {
                const isPrimary = pathsEqual(folder, primaryPath);
                return (
                  <li key={folder} className="project-form-folder-row">
                    <button
                      type="button"
                      className="project-form-folder-path"
                      title={folder}
                      onClick={() => setPrimaryPath(folder)}
                    >
                      <span className="project-form-folder-label">
                        {projectLabelFromCwd(folder)}
                      </span>
                      <span className="project-form-folder-full">{folder}</span>
                    </button>
                    {isPrimary ? (
                      <span className="project-form-primary-badge">
                        {t("conversations.primary")}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="project-form-set-primary"
                        onClick={() => setPrimaryPath(folder)}
                      >
                        {t("conversations.setPrimary")}
                      </button>
                    )}
                    <button
                      type="button"
                      className="icon-btn project-form-remove-folder"
                      title={t("conversations.removeFolder")}
                      aria-label={t("conversations.removeFolder")}
                      onClick={() => removeFolder(folder)}
                    >
                      <X aria-hidden="true" size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            type="button"
            className="project-form-add-folder"
            onClick={() => void addFolder()}
            disabled={saving}
          >
            {t("conversations.addFolder")}
          </button>
        </div>

        {error && <div className="project-form-error">{error}</div>}

        <div className="modal-actions project-form-actions">
          {mode === "edit" && (
            <button
              type="button"
              className="danger project-form-delete"
              onClick={() => void handleDelete()}
              disabled={saving}
            >
              {t("conversations.deleteProject")}
            </button>
          )}
          <div className="project-form-actions-end">
            <button type="button" onClick={onClose} disabled={saving}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="primary"
              disabled={saving || !canSave}
              onClick={() => void handleSave()}
            >
              {saving ? t("common.saving") : t("conversations.saveProject")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
