import { useEffect, type MouseEvent } from "react";

import { useTranslation } from "react-i18next";
import { Globe, PanelRight } from "lucide-react";

import { useConversationStore } from "@/store/conversationStore";
import { useDetailLayoutStore, selectDetailWidth } from "@/store/detailLayoutStore";
import { useBrowserStore } from "@/store/browserStore";
import { BrowserCanvas } from "../Browser/BrowserCanvas";
import { WorkspacePanel } from "./WorkspacePanel";

export function DetailColumn({ runningCount }: { runningCount: number }) {
  const { t } = useTranslation();
  const activeId = useConversationStore((s) => s.activeId);
  const entry = useBrowserStore((s) =>
    activeId ? s.byConv[activeId] : undefined
  );
  const activeTab = useDetailLayoutStore((s) => s.activeTab);
  const setActiveTab = useDetailLayoutStore((s) => s.setActiveTab);
  const toggleDetailCollapsed = useDetailLayoutStore((s) => s.toggleDetailCollapsed);

  useEffect(() => {
    if (!activeId) return;
    const conv = useConversationStore
      .getState()
      .conversations.find((c) => c.id === activeId);
    useDetailLayoutStore
      .getState()
      .setActiveTab(conv?.kind === "game" ? "preview" : "overview");
    void useBrowserStore.getState().ensureFor(activeId, conv?.cwd);
  }, [activeId]);

  const previewAvailable = Boolean(entry?.url);

  const onResizeStart = (e: MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = selectDetailWidth(useDetailLayoutStore.getState());
    const onMove = (ev: globalThis.MouseEvent) => {
      useDetailLayoutStore.getState().setWidth(startWidth - (ev.clientX - startX));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <aside
      className="details-panel workspace-panel detail-column"
      aria-label={t("workspace.panelAria")}
    >
      <div
        className="detail-resizer"
        role="separator"
        aria-orientation="vertical"
        onMouseDown={onResizeStart}
      />
      <div className="detail-tab-body">
        {activeTab === "overview" ? (
          <>
            <div className="detail-entry-row">
              <button
                type="button"
                className={`detail-entry${previewAvailable ? " available" : ""}`}
                onClick={() => setActiveTab("preview")}
                title={t("browser.tabBrowser")}
              >
                <Globe size={15} className="detail-entry-icon" />
                <span>{t("browser.tabBrowser")}</span>
                {previewAvailable && (
                  <span
                    className="detail-entry-badge"
                    aria-label={t("browser.previewBadge")}
                  />
                )}
              </button>
              <button
                type="button"
                className="detail-panel-collapse-btn"
                onClick={toggleDetailCollapsed}
                title={t("detail.collapse")}
                aria-label={t("detail.collapse")}
              >
                <PanelRight size={16} aria-hidden="true" />
              </button>
            </div>
            <WorkspacePanel runningCount={runningCount} />
          </>
        ) : (
          <BrowserCanvas onClose={() => setActiveTab("overview")} />
        )}
      </div>
    </aside>
  );
}
