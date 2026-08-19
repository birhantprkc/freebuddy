import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe,
  Lock,
  Maximize2,
  Minimize2,
  RotateCw,
  X
} from "lucide-react";

import { cliClient } from "@/services/cli/client";
import type { FeedItem } from "@/services/feed/types";
import { useConversationStore } from "@/store/conversationStore";
import { useBrowserStore } from "@/store/browserStore";

export type BrowserViewport = "responsive" | "desktop" | "tablet" | "mobile";

const VIEWPORTS: Array<{ key: BrowserViewport; labelKey?: string; label?: string }> = [
  { key: "responsive", labelKey: "browser.viewportResponsive" },
  { key: "desktop", label: "1440" },
  { key: "tablet", label: "768" },
  { key: "mobile", label: "390" }
];
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;

function isRemoteHttpUrl(value: string | undefined): value is string {
  return /^https?:\/\//i.test(value ?? "");
}

export function BrowserToolbar({
  url,
  target,
  viewport,
  zoom,
  showViewport = true,
  showZoom,
  canGoBack,
  canGoForward,
  isLoading,
  feedItem,
  feedActionBusy,
  onNavigate,
  onGoBack,
  onGoForward,
  onReload,
  onViewportChange,
  onZoomChange,
  onInterpretFeedItem,
  onMarkFeedItemRead,
  onClose
}: {
  url?: string;
  target?: string;
  viewport: BrowserViewport;
  zoom: number;
  showViewport?: boolean;
  showZoom?: boolean;
  canGoBack?: boolean;
  canGoForward?: boolean;
  isLoading?: boolean;
  feedItem?: FeedItem;
  feedActionBusy?: boolean;
  onNavigate?: (target: string) => void;
  onGoBack?: () => void;
  onGoForward?: () => void;
  onReload?: () => void;
  onViewportChange: (viewport: BrowserViewport) => void;
  onZoomChange: (zoom: number) => void;
  onInterpretFeedItem?: (item: FeedItem) => void;
  onMarkFeedItemRead?: (item: FeedItem) => void;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const activeId = useConversationStore((s) => s.activeId);
  const [addressInput, setAddressInput] = useState(target || url || "");
  const [isEditingAddress, setIsEditingAddress] = useState(false);

  const displayAddress = isEditingAddress ? addressInput : (target || url || "");

  const canOpenExternal = Boolean(
    url && (cliClient.isAvailable() || isRemoteHttpUrl(url))
  );

  const isSecure = Boolean(url && (/^https:\/\//i.test(url) || url.startsWith("freebuddy-")));

  const openExternal = () => {
    if (!url || !canOpenExternal) return;
    if (cliClient.isAvailable()) {
      void cliClient
        .openBrowserExternal(url)
        .then((opened) => {
          if (!opened && isRemoteHttpUrl(url)) {
            window.open(url, "_blank", "noopener,noreferrer");
          }
        })
        .catch(() => {
          if (isRemoteHttpUrl(url)) {
            window.open(url, "_blank", "noopener,noreferrer");
          }
        });
      return;
    }
    if (isRemoteHttpUrl(url)) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const handleAddressSubmit = (e: FormEvent) => {
    e.preventDefault();
    setIsEditingAddress(false);
    const trimmed = addressInput.trim();
    if (!trimmed || !activeId) return;
    if (onNavigate) {
      onNavigate(trimmed);
    } else {
      useBrowserStore.getState().navigate(activeId, trimmed);
    }
  };

  const viewportOptions = useMemo(() => VIEWPORTS, []);
  const setZoom = (next: number) => onZoomChange(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)));

  return (
    <div className="browser-toolbar draft-toolbar">
      {/* Navigation Buttons */}
      <div className="browser-nav-group">
        <button
          type="button"
          className="browser-nav-btn draft-action"
          disabled={!canGoBack}
          onClick={onGoBack}
          title={t("browser.back")}
          aria-label={t("browser.back")}
        >
          <ArrowLeft size={15} />
        </button>
        <button
          type="button"
          className="browser-nav-btn draft-action"
          disabled={!canGoForward}
          onClick={onGoForward}
          title={t("browser.forward")}
          aria-label={t("browser.forward")}
        >
          <ArrowRight size={15} />
        </button>
        <button
          type="button"
          className={`browser-nav-btn draft-action${isLoading ? " is-loading" : ""}`}
          onClick={onReload}
          title={t("browser.refresh")}
          aria-label={t("browser.refresh")}
        >
          <RotateCw size={14} className={isLoading ? "spin" : ""} />
        </button>
      </div>

      {/* Omnibar Address Bar */}
      <form className="browser-omnibar-form" onSubmit={handleAddressSubmit}>
        <div className="browser-omnibar-wrap">
          <span className="browser-omnibar-icon">
            {isSecure ? <Lock size={13} className="text-success" /> : <Globe size={13} />}
          </span>
          <input
            type="text"
            className="browser-omnibar-input"
            value={displayAddress}
            placeholder={t("browser.addressPlaceholder")}
            onFocus={() => {
              setIsEditingAddress(true);
              setAddressInput(target || url || "");
            }}
            onBlur={() => setIsEditingAddress(false)}
            onChange={(e) => setAddressInput(e.target.value)}
          />
        </div>
      </form>

      {/* Viewport Select */}
      {showViewport && (
        <select
          className="browser-viewport-select draft-viewport-select"
          value={viewport}
          aria-label={t("browser.viewport")}
          onChange={(e) => onViewportChange(e.target.value as BrowserViewport)}
        >
          {viewportOptions.map((option) => (
            <option key={option.key} value={option.key}>
              {option.labelKey ? t(option.labelKey) : option.label}
            </option>
          ))}
        </select>
      )}

      {/* Zoom Controls for Images/Docs */}
      {showZoom && (
        <div className="browser-zoom-control draft-zoom-control">
          <button
            type="button"
            className="browser-zoom-btn draft-action"
            onClick={() => setZoom(zoom - 0.25)}
            disabled={zoom <= MIN_ZOOM}
            title={t("browser.zoomOut")}
            aria-label={t("browser.zoomOut")}
          >
            <Minimize2 size={13} />
          </button>
          <button
            type="button"
            className="browser-zoom-value draft-zoom-value"
            onClick={() => onZoomChange(1)}
            title={t("browser.resetZoom")}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className="browser-zoom-btn draft-action"
            onClick={() => setZoom(zoom + 0.25)}
            disabled={zoom >= MAX_ZOOM}
            title={t("browser.zoomIn")}
            aria-label={t("browser.zoomIn")}
          >
            <Maximize2 size={13} />
          </button>
        </div>
      )}

      {/* Feed Actions */}
      {feedItem && (
        <div className="browser-feed-actions draft-feed-actions">
          {onInterpretFeedItem && (
            <button
              type="button"
              className="browser-feed-btn draft-feed-action interpret"
              disabled={feedActionBusy}
              onClick={() => onInterpretFeedItem(feedItem)}
            >
              {t("browser.feedInterpret")}
            </button>
          )}
          {onMarkFeedItemRead && (
            <button
              type="button"
              className="browser-feed-btn draft-feed-action"
              disabled={feedActionBusy}
              onClick={() => onMarkFeedItemRead(feedItem)}
            >
              {t("browser.feedMarkRead")}
            </button>
          )}
        </div>
      )}

      {/* External Browser Button */}
      {canOpenExternal && (
        <button
          type="button"
          className="browser-action-btn draft-action"
          onClick={openExternal}
          title={t("browser.openExternal")}
          aria-label={t("browser.openExternal")}
        >
          <ExternalLink size={14} />
        </button>
      )}

      {/* Close Button */}
      {onClose && (
        <button
          type="button"
          className="browser-action-btn draft-action draft-close"
          onClick={onClose}
          title={t("browser.close")}
          aria-label={t("browser.close")}
        >
          <X size={14} />
        </button>
      )}

    </div>
  );
}

export type DraftViewport = BrowserViewport;
export const DraftToolbar = BrowserToolbar;
