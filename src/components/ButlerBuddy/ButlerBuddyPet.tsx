import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent
} from "react";
import { useTranslation } from "react-i18next";

import {
  classifyPetClick,
  classifyPetPointerRelease,
  isPetInteractionCoolingDown,
  PET_SINGLE_CLICK_DELAY_MS
} from "./petInteractions";
const stateAssetBase = `${import.meta.env.BASE_URL}butlerbuddy/states/v2`;
const PET_STATE_ASSETS: Record<
  ButlerBuddyVisualState,
  { motion: string; poster: string }
> = {
  idle: {
    motion: `${stateAssetBase}/idle.webp`,
    poster: `${stateAssetBase}/posters/idle.png`
  },
  working: {
    motion: `${stateAssetBase}/working.webp`,
    poster: `${stateAssetBase}/posters/working.png`
  },
  celebrating: {
    motion: `${stateAssetBase}/celebrating.webp`,
    poster: `${stateAssetBase}/posters/celebrating.png`
  },
  comforting: {
    motion: `${stateAssetBase}/comforting.webp`,
    poster: `${stateAssetBase}/posters/comforting.png`
  },
  sleeping: {
    motion: `${stateAssetBase}/sleeping.webp`,
    poster: `${stateAssetBase}/posters/sleeping.png`
  }
};

type PetInteraction = "pat" | "poke" | "land";

function initialRuntimeState(): ButlerBuddyRuntimeState {
  const previewParams = new URLSearchParams(window.location.search);
  const previewState = previewParams.get("petState") as ButlerBuddyVisualState | null;
  const visualState =
    !window.freebuddy?.butlerBuddy &&
    previewState &&
    Object.hasOwn(PET_STATE_ASSETS, previewState)
      ? previewState
      : "idle";
  const previewTaskText = previewParams.get("taskText")?.trim();
  const previewTaskCount = Math.max(
    1,
    Number.parseInt(previewParams.get("taskCount") ?? "1", 10) || 1
  );
  const previewTaskKind = previewParams.get("taskKind");
  const taskKind: ButlerBuddyTaskKind =
    previewTaskKind === "completed" || previewTaskKind === "failure"
      ? previewTaskKind
      : "running";
  return {
    visualState,
    since: new Date().toISOString(),
    ...(visualState === "working" && previewTaskText
      ? {
          taskText: previewTaskText,
          taskConversationId: "preview",
          taskKind,
          taskCount: previewTaskCount
        }
      : {})
  };
}

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
  const pendingSingleClickRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastInteractionAtRef = useRef<number | null>(null);
  const interactionSequenceRef = useRef(0);
  const [runtimeState, setRuntimeState] =
    useState<ButlerBuddyRuntimeState>(initialRuntimeState);
  const [interaction, setInteraction] = useState<{
    kind: PetInteraction;
    sequence: number;
  } | null>(null);
  const [shortcutHint, setShortcutHint] = useState(() =>
    compactShortcut("CommandOrControl+Shift+Space")
  );

  const stateAssets = PET_STATE_ASSETS[runtimeState.visualState];
  const localizedState = t(`butler.states.${runtimeState.visualState}`);
  const taskKind = runtimeState.taskKind ?? "running";
  const taskText =
    runtimeState.taskText && runtimeState.taskConversationId
      ? t(
          taskKind === "failure"
            ? "butler.failedTask"
            : taskKind === "completed"
              ? "butler.completedTask"
              : "butler.runningTask",
          { task: runtimeState.taskText }
        )
      : null;
  const taskAriaLabel = runtimeState.taskText
    ? t(
        taskKind === "failure"
          ? "butler.openFailedTaskAria"
          : taskKind === "completed"
            ? "butler.openCompletedTaskAria"
            : "butler.openRunningTaskAria",
        {
          task: runtimeState.taskText,
          count: runtimeState.taskCount ?? 1
        }
      )
    : undefined;
  const additionalTaskCount = Math.max(
    0,
    (runtimeState.taskCount ?? 1) - 1
  );
  const beginDrag = () => window.freebuddy?.butlerBuddy?.beginDrag?.();
  const endDrag = () => window.freebuddy?.butlerBuddy?.endDrag?.();

  const clearPendingSingleClick = () => {
    if (pendingSingleClickRef.current) {
      clearTimeout(pendingSingleClickRef.current);
      pendingSingleClickRef.current = null;
    }
  };

  const playInteraction = (kind: PetInteraction, force = false): boolean => {
    const now = Date.now();
    if (
      !force &&
      isPetInteractionCoolingDown(lastInteractionAtRef.current, now)
    ) {
      return false;
    }
    lastInteractionAtRef.current = now;
    interactionSequenceRef.current += 1;
    setInteraction({ kind, sequence: interactionSequenceRef.current });
    if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current);
    interactionTimerRef.current = setTimeout(() => {
      interactionTimerRef.current = null;
      setInteraction(null);
    }, kind === "land" ? 520 : 460);
    return true;
  };

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

  useEffect(() => {
    for (const assets of Object.values(PET_STATE_ASSETS)) {
      for (const src of [assets.motion, assets.poster]) {
        const image = new Image();
        image.src = src;
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    const bridge = window.freebuddy?.butlerBuddy;
    const applyState = (state: ButlerBuddyRuntimeState | undefined) => {
      if (active && state && PET_STATE_ASSETS[state.visualState]) {
        setRuntimeState(state);
      }
    };
    void bridge?.getRuntimeState?.().then(applyState).catch(() => undefined);
    const off = bridge?.onRuntimeStateChanged?.(applyState);
    return () => {
      active = false;
      off?.();
    };
  }, []);

  useEffect(
    () => () => {
      clearPendingSingleClick();
      if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current);
      if (suppressClickTimerRef.current) {
        clearTimeout(suppressClickTimerRef.current);
      }
    },
    []
  );

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
    clearPendingSingleClick();
    downRef.current = { x: event.screenX, y: event.screenY };
    beginDrag();
  };

  const onPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    const down = downRef.current;
    downRef.current = null;
    endDrag();
    if (down) {
      const release = classifyPetPointerRelease(down, {
        x: event.screenX,
        y: event.screenY
      });
      if (release === "drag") {
        suppressClickRef.current = true;
        playInteraction("land", true);
        if (suppressClickTimerRef.current) {
          clearTimeout(suppressClickTimerRef.current);
        }
        suppressClickTimerRef.current = setTimeout(() => {
          suppressClickRef.current = false;
          suppressClickTimerRef.current = null;
        }, 500);
      }
    }
  };

  const cancelPointer = () => {
    downRef.current = null;
    endDrag();
  };

  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      if (suppressClickTimerRef.current) {
        clearTimeout(suppressClickTimerRef.current);
        suppressClickTimerRef.current = null;
      }
      return;
    }
    const coolingDown = isPetInteractionCoolingDown(
      lastInteractionAtRef.current,
      Date.now()
    );
    const action = classifyPetClick(event.detail, coolingDown);
    if (action === "ignore") return;
    if (action === "poke") {
      clearPendingSingleClick();
      playInteraction("poke");
      return;
    }

    clearPendingSingleClick();
    pendingSingleClickRef.current = setTimeout(() => {
      pendingSingleClickRef.current = null;
      if (playInteraction("pat")) {
        window.freebuddy?.butlerBuddy?.toggleChat();
      }
    }, PET_SINGLE_CLICK_DELAY_MS);
  };

  return (
    <div
      className="butler-pet-surface"
      aria-label={t("butler.petSurfaceAria")}
    >
      <button
        type="button"
        className="butler-pet-button"
        data-state={runtimeState.visualState}
        data-interaction={interaction?.kind}
        aria-label={t("butler.openChatStateAria", { state: localizedState })}
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
        <span
          key={interaction?.sequence ?? 0}
          className="butler-pet-actor"
          aria-hidden="true"
        >
          <img
            className="butler-pet-art butler-pet-art-motion"
            src={stateAssets.motion}
            alt=""
            draggable={false}
          />
          <img
            className="butler-pet-art butler-pet-art-poster"
            src={stateAssets.poster}
            alt=""
            draggable={false}
          />
        </span>
        {shortcutHint && (
          <span className="butler-pet-hint" aria-hidden="true">
            {shortcutHint}
          </span>
        )}
      </button>
      {taskText && (
        <button
          type="button"
          className="butler-pet-task-bubble"
          data-task-kind={taskKind}
          aria-label={taskAriaLabel}
          title={taskText}
          onClick={() => window.freebuddy?.butlerBuddy?.openCurrentTask?.()}
        >
          <span className="butler-pet-task-viewport" aria-hidden="true">
            <span className="butler-pet-task-track">
              <span className="butler-pet-task-copy">{taskText}</span>
              <span className="butler-pet-task-copy" aria-hidden="true">
                {taskText}
              </span>
            </span>
          </span>
          {additionalTaskCount > 0 && (
            <span className="butler-pet-task-count" aria-hidden="true">
              +{additionalTaskCount}
            </span>
          )}
        </button>
      )}
    </div>
  );
}
