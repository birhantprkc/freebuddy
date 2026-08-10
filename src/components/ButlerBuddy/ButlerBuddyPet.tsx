import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent
} from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw, Star, X, Zap } from "lucide-react";

import {
  classifyPetClick,
  classifyPetPointerRelease,
  isPetInteractionCoolingDown,
  PET_SINGLE_CLICK_DELAY_MS
} from "./petInteractions";
import {
  advancePetArcadeState,
  createPetArcadeState,
  hitPetArcadeBall,
  hitPetArcadeWeakPoint,
  PET_ARCADE_BOSS_MAX_HEALTH,
  PET_ARCADE_FEVER_MAX,
  PET_ARCADE_ULTIMATE_MAX,
  remainingPetArcadeSeconds,
  spawnPetArcadeBall,
  triggerPetArcadeUltimate
} from "./petArcade";

const stateAssetBase = `${import.meta.env.BASE_URL}butlerbuddy/states/v2`;
const arcadeAssetBase = `${import.meta.env.BASE_URL}butlerbuddy/arcade`;
const PET_ARCADE_ASSETS = {
  boss: `${arcadeAssetBase}/boss.png`,
  orb: `${arcadeAssetBase}/orb.png`
};
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

interface PetArcadeBurst {
  id: number;
  x: number;
  y: number;
  hue: number;
  points: number;
  order: number;
}

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
  const arcadeFrameRef = useRef<number | null>(null);
  const arcadeSpawnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arcadeBurstTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(
    new Set()
  );
  const arcadeBurstSequenceRef = useRef(0);
  const arcadeLastHitRef = useRef<number | null>(null);
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
  const [entertainmentEnabled, setEntertainmentEnabled] = useState(
    () =>
      new URLSearchParams(window.location.search).get("entertainment") === "1"
  );
  const arcadeWasEnabledRef = useRef(entertainmentEnabled);
  const [arcadeRunId, setArcadeRunId] = useState(0);
  const [arcadeState, setArcadeState] = useState(createPetArcadeState);
  const [arcadeBursts, setArcadeBursts] = useState<PetArcadeBurst[]>([]);
  const [pageVisible, setPageVisible] = useState(
    () => document.visibilityState !== "hidden"
  );
  const initializedArcadeRunRef = useRef<number | null>(null);

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
  const arcadeFinished =
    arcadeState.phase === "victory" || arcadeState.phase === "timeout";
  const arcadeRemainingSeconds = remainingPetArcadeSeconds(arcadeState);
  const arcadeFeverPercent = Math.round(
    (arcadeState.fever / PET_ARCADE_FEVER_MAX) * 100
  );
  const arcadeBossHealthPercent = Math.round(
    (arcadeState.bossHealth / PET_ARCADE_BOSS_MAX_HEALTH) * 100
  );
  const arcadeUltimatePercent = Math.round(
    (arcadeState.ultimate / PET_ARCADE_ULTIMATE_MAX) * 100
  );
  const arcadeUltimateReady =
    arcadeState.phase === "boss" &&
    arcadeState.ultimate >= PET_ARCADE_ULTIMATE_MAX;

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
    for (const src of Object.values(PET_ARCADE_ASSETS)) {
      const image = new Image();
      image.src = src;
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

  useEffect(() => {
    const off = window.freebuddy?.butlerBuddy?.onPreferencesChanged?.(
      (preferences) => {
        setEntertainmentEnabled(preferences.entertainmentEnabled);
      }
    );
    return () => off?.();
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => {
      setPageVisible(document.visibilityState !== "hidden");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    if (!entertainmentEnabled) {
      if (arcadeWasEnabledRef.current) {
        for (const timer of arcadeBurstTimersRef.current) clearTimeout(timer);
        arcadeBurstTimersRef.current.clear();
        setArcadeState(createPetArcadeState());
        setArcadeBursts([]);
        arcadeLastHitRef.current = null;
      }
      arcadeWasEnabledRef.current = false;
      return;
    }

    if (!pageVisible) return;

    arcadeWasEnabledRef.current = true;
    if (initializedArcadeRunRef.current !== arcadeRunId) {
      const startedAt = Date.now();
      setArcadeState(
        spawnPetArcadeBall(createPetArcadeState(startedAt), startedAt)
      );
      initializedArcadeRunRef.current = arcadeRunId;
    }
    const scheduleNextBall = () => {
      arcadeSpawnTimerRef.current = setTimeout(() => {
        setArcadeState((current) => spawnPetArcadeBall(current, Date.now()));
        scheduleNextBall();
      }, 720);
    };
    scheduleNextBall();

    let previousFrame = performance.now();
    const animate = (frameAt: number) => {
      const elapsed = frameAt - previousFrame;
      previousFrame = frameAt;
      setArcadeState((current) =>
        advancePetArcadeState(current, elapsed, Date.now())
      );
      arcadeFrameRef.current = requestAnimationFrame(animate);
    };
    arcadeFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (arcadeSpawnTimerRef.current) {
        clearTimeout(arcadeSpawnTimerRef.current);
        arcadeSpawnTimerRef.current = null;
      }
      if (arcadeFrameRef.current !== null) {
        cancelAnimationFrame(arcadeFrameRef.current);
        arcadeFrameRef.current = null;
      }
    };
  }, [arcadeRunId, entertainmentEnabled, pageVisible]);

  useEffect(() => {
    if (!arcadeFinished) return;
    if (arcadeSpawnTimerRef.current) {
      clearTimeout(arcadeSpawnTimerRef.current);
      arcadeSpawnTimerRef.current = null;
    }
    if (arcadeFrameRef.current !== null) {
      cancelAnimationFrame(arcadeFrameRef.current);
      arcadeFrameRef.current = null;
    }
  }, [arcadeFinished]);

  useEffect(() => {
    const feedback = arcadeState.lastHit;
    if (!feedback || feedback.id === arcadeLastHitRef.current) return;
    arcadeLastHitRef.current = feedback.id;
    const bursts = feedback.balls.map((ball, order) => {
      arcadeBurstSequenceRef.current += 1;
      return {
        id: arcadeBurstSequenceRef.current,
        x: ball.x,
        y: ball.y,
        hue: ball.hue,
        points: ball.points,
        order
      };
    });
    setArcadeBursts((current) => [...current, ...bursts]);
    for (const burst of bursts) {
      const timer = setTimeout(() => {
        arcadeBurstTimersRef.current.delete(timer);
        setArcadeBursts((current) => {
          if (!current.some((item) => item.id === burst.id)) return current;
          return current.filter((item) => item.id !== burst.id);
        });
      }, 620 + burst.order * 70);
      arcadeBurstTimersRef.current.add(timer);
    }
  }, [arcadeState.lastHit]);

  useEffect(
    () => () => {
      clearPendingSingleClick();
      if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current);
      if (suppressClickTimerRef.current) {
        clearTimeout(suppressClickTimerRef.current);
      }
      for (const timer of arcadeBurstTimersRef.current) clearTimeout(timer);
      arcadeBurstTimersRef.current.clear();
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
    if (entertainmentEnabled) {
      clearPendingSingleClick();
      playInteraction("poke", true);
      if (arcadeFinished) {
        restartArcade();
      } else if (arcadeUltimateReady) {
        setArcadeState((current) =>
          triggerPetArcadeUltimate(current, Date.now())
        );
      } else {
        setArcadeState((current) => spawnPetArcadeBall(current, Date.now()));
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

  const hitArcadeBall = (
    event: MouseEvent<HTMLButtonElement>,
    ballId: string
  ) => {
    event.stopPropagation();
    setArcadeState((current) =>
      hitPetArcadeBall(current, ballId, Date.now())
    );
  };

  const hitArcadeWeakPoint = (
    event: MouseEvent<HTMLButtonElement>,
    weakPoint: number
  ) => {
    event.stopPropagation();
    setArcadeState((current) =>
      hitPetArcadeWeakPoint(current, weakPoint, Date.now())
    );
  };

  const restartArcade = () => {
    for (const timer of arcadeBurstTimersRef.current) clearTimeout(timer);
    arcadeBurstTimersRef.current.clear();
    setArcadeBursts([]);
    arcadeLastHitRef.current = null;
    setArcadeRunId((current) => current + 1);
  };

  const stopEntertainment = () => {
    const updatePreferences =
      window.freebuddy?.butlerBuddy?.updatePreferences;
    if (!updatePreferences) {
      setEntertainmentEnabled(false);
      return;
    }
    void updatePreferences({ entertainmentEnabled: false })
      .then((preferences) => {
        setEntertainmentEnabled(preferences.entertainmentEnabled);
      })
      .catch(() => undefined);
  };

  return (
    <div
      className="butler-pet-surface"
      data-entertainment={entertainmentEnabled}
      aria-label={
        entertainmentEnabled
          ? t("butler.arcadeSurfaceAria")
          : t("butler.petSurfaceAria")
      }
    >
      {entertainmentEnabled && (
        <div className="butler-pet-arcade" data-phase={arcadeState.phase}>
          <div className="butler-pet-arcade-score" aria-live="polite">
            <span>{t("butler.arcadeScore")}</span>
            <strong>{arcadeState.score}</strong>
          </div>
          <div
            className="butler-pet-arcade-fever"
            role="progressbar"
            aria-label={t("butler.arcadeFeverAria")}
            aria-valuemin={0}
            aria-valuemax={PET_ARCADE_FEVER_MAX}
            aria-valuenow={arcadeState.fever}
          >
            <span style={{ width: `${arcadeFeverPercent}%` }} />
            <strong>
              {t("butler.arcadeFever", {
                count: Math.max(1, arcadeState.combo)
              })}
            </strong>
          </div>
          <div
            className="butler-pet-arcade-timer"
            data-urgent={arcadeRemainingSeconds <= 5}
            aria-label={t("butler.arcadeTimeAria", {
              count: arcadeRemainingSeconds
            })}
          >
            <strong>{arcadeRemainingSeconds}</strong>
            <span>{t("butler.arcadeSeconds")}</span>
          </div>
          <button
            type="button"
            className="butler-pet-arcade-close"
            aria-label={t("butler.arcadeStop")}
            title={t("butler.arcadeStop")}
            onClick={stopEntertainment}
          >
            <X aria-hidden="true" size={17} strokeWidth={2.4} />
          </button>

          {(arcadeState.phase === "boss" ||
            (arcadeState.phase === "victory" &&
              arcadeState.lastBossHit)) && (
            <div className="butler-pet-arcade-boss">
              <div className="butler-pet-arcade-boss-health">
                <span>{t("butler.arcadeBoss")}</span>
                <div
                  role="progressbar"
                  aria-label={t("butler.arcadeBossHealthAria")}
                  aria-valuemin={0}
                  aria-valuemax={PET_ARCADE_BOSS_MAX_HEALTH}
                  aria-valuenow={arcadeState.bossHealth}
                >
                  <i style={{ width: `${arcadeBossHealthPercent}%` }} />
                </div>
              </div>
              <div
                className="butler-pet-arcade-boss-stage"
                data-ultimate-hit={arcadeState.lastBossHit?.ultimate ?? false}
              >
                <img src={PET_ARCADE_ASSETS.boss} alt="" draggable={false} />
                {Array.from({ length: 3 }, (_, weakPoint) => (
                  <button
                    key={weakPoint}
                    type="button"
                    className="butler-pet-arcade-weak-point"
                    data-position={weakPoint}
                    data-active={weakPoint === arcadeState.activeWeakPoint}
                    disabled={
                      weakPoint !== arcadeState.activeWeakPoint || arcadeFinished
                    }
                    aria-label={t("butler.arcadeWeakPointAria", {
                      count: weakPoint + 1
                    })}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) =>
                      hitArcadeWeakPoint(event, weakPoint)
                    }
                  >
                    <img src={PET_ARCADE_ASSETS.orb} alt="" draggable={false} />
                    <Zap aria-hidden="true" size={11} fill="currentColor" />
                  </button>
                ))}
                {arcadeState.lastBossHit && (
                  <strong
                    key={arcadeState.lastBossHit.id}
                    className="butler-pet-arcade-damage"
                  >
                    -{arcadeState.lastBossHit.damage}
                  </strong>
                )}
              </div>
            </div>
          )}

          {!arcadeFinished && (
            <span className="butler-pet-arcade-streak" aria-hidden="true" />
          )}
          {arcadeState.balls.map((ball) => (
            <button
              key={ball.id}
              type="button"
              className="butler-pet-arcade-ball"
              data-kind={ball.kind}
              style={{
                left: `${ball.x}%`,
                top: `${ball.y}%`,
                width: `${ball.radius * 2}%`,
                aspectRatio: "1",
                "--arcade-ball-hue": ball.hue,
                "--arcade-ball-shift": `${ball.hue - 160}deg`
              } as CSSProperties}
              aria-label={t(
                ball.kind === "gold"
                  ? "butler.arcadeGoldBallAria"
                  : "butler.arcadeBallAria"
              )}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => hitArcadeBall(event, ball.id)}
            >
              <img src={PET_ARCADE_ASSETS.orb} alt="" draggable={false} />
              {ball.kind === "gold" && (
                <Star aria-hidden="true" size={13} fill="currentColor" />
              )}
            </button>
          ))}
          {arcadeBursts.map((burst) => (
            <span
              key={burst.id}
              className="butler-pet-arcade-burst"
              style={{
                left: `${burst.x}%`,
                top: `${burst.y}%`,
                "--arcade-ball-hue": burst.hue,
                "--arcade-ball-shift": `${burst.hue - 160}deg`,
                animationDelay: `${burst.order * 70}ms`
              } as CSSProperties}
              aria-hidden="true"
            >
              <img src={PET_ARCADE_ASSETS.orb} alt="" />
              <strong>+{burst.points}</strong>
            </span>
          ))}
          {arcadeState.lastHit && arcadeState.lastHit.chainCount > 1 && (
            <strong
              key={arcadeState.lastHit.id}
              className="butler-pet-arcade-chain"
            >
              {t("butler.arcadeChain", {
                count: arcadeState.lastHit.chainCount
              })}
            </strong>
          )}
          {arcadeState.phase === "boss" && (
            <span
              className="butler-pet-arcade-ultimate"
              data-ready={arcadeUltimateReady}
              style={
                {
                  "--arcade-ultimate-progress": `${arcadeUltimatePercent * 3.6}deg`
                } as CSSProperties
              }
              aria-hidden="true"
            >
              <Zap size={11} fill="currentColor" />
              {arcadeUltimateReady
                ? t("butler.arcadeUltimateReady")
                : t("butler.arcadeUltimate", {
                    count: arcadeUltimatePercent
                  })}
            </span>
          )}
          {arcadeFinished && (
            <div className="butler-pet-arcade-result" role="status">
              <strong>
                {t(
                  arcadeState.phase === "victory"
                    ? "butler.arcadeVictory"
                    : "butler.arcadeTimeout"
                )}
              </strong>
              <span>
                {t("butler.arcadeFinalScore", { count: arcadeState.score })}
              </span>
              <button type="button" onClick={restartArcade}>
                <RotateCcw aria-hidden="true" size={13} />
                {t("butler.arcadeReplay")}
              </button>
            </div>
          )}
        </div>
      )}
      <button
        type="button"
        className="butler-pet-button"
        data-state={runtimeState.visualState}
        data-interaction={interaction?.kind}
        data-arcade-phase={entertainmentEnabled ? arcadeState.phase : undefined}
        data-ultimate-ready={arcadeUltimateReady}
        aria-label={
          entertainmentEnabled
            ? t(
                arcadeFinished
                  ? "butler.arcadeReplay"
                  : arcadeUltimateReady
                    ? "butler.arcadeUltimateReadyAria"
                    : "butler.arcadePetAria"
              )
            : t("butler.openChatStateAria", { state: localizedState })
        }
        title={
          entertainmentEnabled
            ? t(
                arcadeUltimateReady
                  ? "butler.arcadeUltimateReadyAria"
                  : "butler.arcadePetTooltip"
              )
            : t("butler.petTooltip")
        }
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
        {!entertainmentEnabled && shortcutHint && (
          <span className="butler-pet-hint" aria-hidden="true">
            {shortcutHint}
          </span>
        )}
      </button>
      {!entertainmentEnabled && taskText && (
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
