import { useEffect, useRef, useState, type MouseEvent } from "react";

import { useTranslation } from "react-i18next";
import { PanelRight, X } from "lucide-react";

import { useConversationStore } from "@/store/conversationStore";
import { useDetailLayoutStore, selectDetailWidth } from "@/store/detailLayoutStore";
import { useBrowserStore } from "@/store/browserStore";
import { BrowserCanvas } from "../Browser/BrowserCanvas";
import { WorkspacePanel } from "./WorkspacePanel";
import { FileDiffPanel } from "./FileChanges";
import { useFileDiffStore } from "@/store/fileDiffStore";

export function DetailColumn({ runningCount }: { runningCount: number }) {
  const { t } = useTranslation();
  const activeId = useConversationStore((s) => s.activeId);
  const entry = useBrowserStore((s) =>
    activeId ? s.byConv[activeId] : undefined
  );
  const activeTab = useDetailLayoutStore((s) => s.activeTab);
  const setActiveTab = useDetailLayoutStore((s) => s.setActiveTab);
  const toggleDetailCollapsed = useDetailLayoutStore((s) => s.toggleDetailCollapsed);
  const previousId = useRef(activeId);
  const [browserMounted, setBrowserMounted] = useState(activeTab === "preview");

  useEffect(() => {
    if (activeTab === "preview") setBrowserMounted(true);
  }, [activeTab]);

  useEffect(() => {
    if (!activeId) return;
    const conv = useConversationStore
      .getState()
      .conversations.find((c) => c.id === activeId);
    const openingDiff = useDetailLayoutStore.getState().activeTab === "diff"
      && useFileDiffStore.getState().selection?.conversationId === activeId;
    if (previousId.current !== activeId || (!openingDiff && conv?.kind === "game")) {
      useDetailLayoutStore.getState().setActiveTab(conv?.kind === "game" ? "preview" : "overview");
    }
    previousId.current = activeId;
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
      className={`details-panel workspace-panel detail-column${activeTab !== "overview" ? " detail-column-expanded" : ""}`}
      aria-label={t("workspace.panelAria")}
    >
      <div
        className="detail-resizer"
        role="separator"
        aria-orientation="vertical"
        onMouseDown={onResizeStart}
      />
      <nav className="detail-tabs file-detail-tabs" aria-label={t("workspace.panelAria")}>
        {(["overview", "preview", "diff"] as const).map((tab) => <button
          key={tab} type="button" className={`detail-tab${activeTab === tab ? " active" : ""}`}
          aria-pressed={activeTab === tab} onClick={() => setActiveTab(tab)}
        >
          {t(tab === "overview" ? "fileDiff.overview" : tab === "preview" ? "browser.tabBrowser" : "fileDiff.title")}
          {tab === "preview" && previewAvailable && <span className="detail-tab-badge" aria-label={t("browser.previewBadge")} />}
        </button>)}
        {activeTab !== "overview" && <button type="button" className="detail-panel-collapse-btn detail-tab-close" onClick={() => setActiveTab("overview")} title={t(activeTab === "diff" ? "fileDiff.close" : "browser.close")} aria-label={t(activeTab === "diff" ? "fileDiff.close" : "browser.close")}><X size={16} /></button>}
        <button type="button" className="detail-panel-collapse-btn" onClick={toggleDetailCollapsed} title={t("detail.collapse")} aria-label={t("detail.collapse")}><PanelRight size={16} /></button>
      </nav>
      <div className="detail-tab-body">
        {activeTab === "overview" && <WorkspacePanel runningCount={runningCount} />}
        {(browserMounted || activeTab === "preview") && <div className="detail-browser-host" hidden={activeTab !== "preview"}>
          <BrowserCanvas visible={activeTab === "preview"} />
        </div>}
        {activeTab === "diff" && <FileDiffPanel />}
      </div>
    </aside>
  );
}
