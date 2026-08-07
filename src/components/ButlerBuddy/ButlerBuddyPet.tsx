import { Circle } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";

const petImageUrl = `${import.meta.env.BASE_URL}butlerbuddy-pet.png`;
const DRAG_THRESHOLD = 3;

function compactShortcut(shortcut: string): string {
  const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
  return shortcut
    .replace("CommandOrControl", isMac ? "⌘" : "Ctrl")
    .replace("Shift", "⇧")
    .replace("Alt", isMac ? "⌥" : "Alt")
    .replace(/\+/g, " ");
}

export function ButlerBuddyPet() {
  const { t } = useTranslation();
  // Dragging is driven by the main process: on press we send beginDrag, on
  // release we send endDrag, and the main process polls the global cursor
  // position to move the window. This is necessary because the pet window is
  // `transparent: true` + `focusable: false`; on Windows it cannot reliably
  // receive pointermove while another always-on-top window (the chat) is in
  // front, so a renderer-driven drag stalls. We still distinguish a click from
  // a drag locally so a press that releases in place toggles the chat.
  const downRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  const [shortcutHint, setShortcutHint] = useState(() =>
    compactShortcut("CommandOrControl+Shift+Space")
  );

  const beginDrag = () => window.freebuddy?.butlerBuddy?.beginDrag?.();
  const endDrag = () => window.freebuddy?.butlerBuddy?.endDrag?.();

  const refreshShortcutHint = () => {
    void window.freebuddy?.butlerBuddy
      ?.getPreferences?.()
      .then((preferences) => {
        setShortcutHint(
          preferences.shortcutEnabled
            ? compactShortcut(preferences.shortcut)
            : t("butler.clickToChat")
        );
      })
      .catch(() => undefined);
  };

  useEffect(refreshShortcutHint, []);

  // Safety net: if the pointerup happens off-window (so the button never sees
  // it), still release the main-process drag loop when the window loses capture
  // or the user releases anywhere.
  useEffect(() => {
    const release = () => {
      if (downRef.current) {
        endDrag();
        downRef.current = null;
      }
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("blur", release);
    };
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    downRef.current = { x: event.screenX, y: event.screenY };
    beginDrag();
  };

  const onPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    const down = downRef.current;
    downRef.current = null;
    endDrag();
    if (down) {
      const moved =
        Math.hypot(event.screenX - down.x, event.screenY - down.y) >=
        DRAG_THRESHOLD;
      if (moved) suppressClickRef.current = true;
    }
  };

  const cancelPointer = () => {
    downRef.current = null;
    endDrag();
  };

  const onClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    window.freebuddy?.butlerBuddy?.toggleChat();
  };

  return (
    <div className="butler-pet-surface" aria-label="ButlerBuddy floating companion">
      <button
        type="button"
        className="butler-pet-button"
        aria-label={t("butler.openChatAria")}
        title={t("butler.petTooltip")}
        onPointerEnter={refreshShortcutHint}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={cancelPointer}
        onContextMenu={(event) => {
          event.preventDefault();
          window.freebuddy?.butlerBuddy?.openMenu?.();
        }}
        onClick={onClick}
      >
        <img src={petImageUrl} alt="" draggable={false} />
        <Circle
          className="butler-pet-online"
          size={12}
          strokeWidth={3}
          fill="currentColor"
          aria-hidden="true"
        />
        {shortcutHint && (
          <span className="butler-pet-hint" aria-hidden="true">
            {shortcutHint}
          </span>
        )}
      </button>
    </div>
  );
}
