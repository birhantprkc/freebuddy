import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dog, LogOut, Settings } from "lucide-react";
import { useConversationStore } from "@/store/conversationStore";
import { useSettingsStore } from "@/store/settingsStore";

export function SidebarUserMenu({
  onOpenSettings,
  showLogout = true
}: {
  onOpenSettings: () => void;
  showLogout?: boolean;
}) {
  const { t } = useTranslation();
  const me = useConversationStore((s) => s.currentUser);
  const butlerVisible = useSettingsStore((s) => s.butlerBuddyVisible);
  const updateButler = useSettingsStore((s) => s.updateButlerBuddyPreferences);
  const platform = window.freebuddy?.platform;
  const canTogglePet =
    platform !== "web" &&
    Boolean(window.freebuddy?.butlerBuddy?.updatePreferences);
  const username =
    me?.username?.trim() ||
    (platform !== "web" ? t("sidebar.hostAccount") : "");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleLogout = () => {
    try {
      window.freebuddy?.session?.logout?.();
    } catch {
      /* ignore */
    }
  };

  const initial = (username.trim()[0] ?? "?").toUpperCase();

  return (
    <div className="sidebar-user-menu" ref={ref}>
      <button
        type="button"
        className={`footer-action sidebar-user-trigger${open ? " open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={username}
      >
        <span className="sidebar-user-avatar" aria-hidden="true">
          {initial}
        </span>
        <span className="sidebar-user-name">{username}</span>
      </button>
      {open && (
        <div className="sidebar-user-dropdown" role="menu">
          <button
            type="button"
            className="sidebar-user-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenSettings();
            }}
          >
            <Settings size={15} strokeWidth={1.8} />
            {t("common.settings")}
          </button>
          {canTogglePet && (
            <button
              type="button"
              className="sidebar-user-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void updateButler({ visible: !butlerVisible });
              }}
            >
              <Dog size={15} strokeWidth={1.8} />
              {butlerVisible ? t("sidebar.hidePet") : t("sidebar.showPet")}
            </button>
          )}
          {showLogout && (
            <button
              type="button"
              className="sidebar-user-item danger"
              role="menuitem"
              onClick={handleLogout}
            >
              <LogOut size={15} strokeWidth={1.8} />
              {t("sidebar.logout")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
