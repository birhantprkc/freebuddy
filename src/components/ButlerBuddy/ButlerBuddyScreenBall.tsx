import { RotateCcw, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  advanceScreenBallState,
  createScreenBallArcadeState,
  hitScreenBall,
  maxScreenBallCount,
  remainingScreenBallSeconds,
  screenBallIntersectsSegment,
  screenBallSpawnIntervalMs,
  screenBallVolleySize,
  spawnScreenBall,
  spawnScreenBallVolley,
  type ScreenBallArcadeState
} from "./screenBallArcade";

type SessionPayload = {
  sessionId: string;
  display: { id: number | string; x: number; y: number; width: number; height: number };
  petOrigin: { x: number; y: number };
};

type HitRegion = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: "ball" | "control";
};

type BurstEffect = {
  id: string;
  x: number;
  y: number;
  kind: "ball" | "bomb";
};

type SwipeTrailSegment = {
  id: string;
  x: number;
  y: number;
  length: number;
  angle: number;
};

type SwipePointer = {
  pointerId: number;
  sessionId: string;
  x: number;
  y: number;
  hitIds: Set<string>;
};

type ScreenPointerStart = Pick<globalThis.PointerEvent, "pointerId" | "screenX" | "screenY">;

type ScreenBallHitSound = "ball" | "bomb";
type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

const HIT_PADDING = 10;
const SWIPE_HIT_PADDING = 14;
const BURST_DURATION_MS = 520;
const SCREEN_BALL_VISUAL_SCALE = 1.8;
const SCREEN_BALL_SOUND_STORAGE_KEY = "freebuddy.screenBallSoundEnabled";
const SCREEN_BALL_ORB_ASSET = `${import.meta.env.BASE_URL}butlerbuddy/arcade/orb.png`;
const CLOCK_ORIGIN =
  typeof performance.timeOrigin === "number"
    ? performance.timeOrigin
    : Date.now() - performance.now();

function monotonicNow(): number {
  return CLOCK_ORIGIN + performance.now();
}

function readScreenBallSoundEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(SCREEN_BALL_SOUND_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function createScreenBallAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextConstructor =
    window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
  if (!AudioContextConstructor) return null;
  try {
    return new AudioContextConstructor();
  } catch {
    return null;
  }
}

function playScreenBallHitSound(
  audioContext: AudioContext,
  kind: ScreenBallHitSound
): void {
  const now = audioContext.currentTime;
  const isBomb = kind === "bomb";
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = isBomb ? "sawtooth" : "triangle";
  oscillator.frequency.setValueAtTime(isBomb ? 150 : 680, now);
  oscillator.frequency.exponentialRampToValueAtTime(isBomb ? 38 : 180, now + (isBomb ? 0.42 : 0.16));
  gain.gain.setValueAtTime(isBomb ? 0.2 : 0.12, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + (isBomb ? 0.46 : 0.18));
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + (isBomb ? 0.48 : 0.2));

  if (isBomb) {
    const sub = audioContext.createOscillator();
    const subGain = audioContext.createGain();
    sub.type = "square";
    sub.frequency.setValueAtTime(72, now);
    sub.frequency.exponentialRampToValueAtTime(24, now + 0.38);
    subGain.gain.setValueAtTime(0.11, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    sub.connect(subGain).connect(audioContext.destination);
    sub.start(now);
    sub.stop(now + 0.42);
  }
}

function initialState(session: SessionPayload, at = Date.now()): ScreenBallArcadeState {
  return spawnScreenBall(
    createScreenBallArcadeState({
      at,
      bounds: {
        left: 0,
        top: 0,
        right: session.display.width,
        bottom: session.display.height
      },
      origin: session.petOrigin
    }),
    { at, random: Math.random, origin: session.petOrigin }
  );
}

export function ButlerBuddyScreenBall() {
  const { t } = useTranslation();
  const bridge = window.freebuddy?.butlerBuddy;
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [state, setState] = useState<ScreenBallArcadeState | null>(null);
  const [bursts, setBursts] = useState<BurstEffect[]>([]);
  const [trailSegments, setTrailSegments] = useState<SwipeTrailSegment[]>([]);
  const [screenBallSoundEnabled, setScreenBallSoundEnabled] = useState(
    readScreenBallSoundEnabled
  );
  const sessionRef = useRef<SessionPayload | null>(null);
  const stateRef = useRef<ScreenBallArcadeState | null>(null);
  const hitRegionsRef = useRef<HitRegion[]>([]);
  const swipeRef = useRef<SwipePointer | null>(null);
  const burstTimersRef = useRef<Set<number>>(new Set());
  const burstSequenceRef = useRef(0);
  const trailSequenceRef = useRef(0);
  const trailClearTimerRef = useRef<number | null>(null);
  const publishTimerRef = useRef<number | null>(null);
  const lastSpawnAtRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  stateRef.current = state;

  const beginSwipe = (event: ScreenPointerStart, initialHitId?: string) => {
    const currentSession = sessionRef.current;
    if (!currentSession) return;
    swipeRef.current = {
      pointerId: event.pointerId,
      sessionId: currentSession.sessionId,
      x: event.screenX,
      y: event.screenY,
      hitIds: initialHitId ? new Set([initialHitId]) : new Set()
    };
  };

  const submitHit = (ballId: string) => {
    const currentSession = sessionRef.current;
    if (currentSession) {
      bridge?.reportScreenBallHit?.(currentSession.sessionId, ballId);
    }
  };

  const emitBurst = (ball: { x: number; y: number; kind?: string }) => {
    const id = `screen-ball-burst-${burstSequenceRef.current++}`;
    const kind: BurstEffect["kind"] = ball.kind === "bomb" ? "bomb" : "ball";
    setBursts((current) => [...current, { id, x: ball.x, y: ball.y, kind }].slice(-16));
    const timer = window.setTimeout(() => {
      burstTimersRef.current.delete(timer);
      setBursts((current) => current.filter((burst) => burst.id !== id));
    }, BURST_DURATION_MS);
    burstTimersRef.current.add(timer);
  };

  const emitSwipeTrail = (segment: Omit<SwipeTrailSegment, "id">) => {
    const id = `screen-ball-trail-${trailSequenceRef.current++}`;
    setTrailSegments((current) => [...current, { ...segment, id }].slice(-14));
    if (trailClearTimerRef.current !== null) {
      window.clearTimeout(trailClearTimerRef.current);
    }
    trailClearTimerRef.current = window.setTimeout(() => {
      trailClearTimerRef.current = null;
      setTrailSegments([]);
    }, 180);
  };

  useEffect(() => {
    let active = true;
    const applySession = (payload: SessionPayload | null) => {
      if (!active || !payload) return;
      const at = monotonicNow();
      const previous = sessionRef.current;
      sessionRef.current = payload;
      setSession(payload);
      setState((current) => {
        if (!current || !previous || previous.sessionId !== payload.sessionId) {
          return initialState(payload, at);
        }
        const oldWidth = Math.max(1, previous.display.width);
        const oldHeight = Math.max(1, previous.display.height);
        const widthScale = payload.display.width / oldWidth;
        const heightScale = payload.display.height / oldHeight;
        const bounds = {
          left: 0,
          top: 0,
          right: payload.display.width,
          bottom: payload.display.height
        };
        const balls = current.balls.map((ball) => ({
          ...ball,
          x: Math.max(ball.radius, Math.min(payload.display.width - ball.radius, ball.x * widthScale)),
          y: Math.max(ball.radius, Math.min(payload.display.height - ball.radius, ball.y * heightScale)),
          vx: ball.vx * widthScale,
          vy: ball.vy * heightScale
        }));
        return {
          ...current,
          bounds,
          spawnOrigin: {
            x: payload.petOrigin.x,
            y: payload.petOrigin.y
          },
          balls
        };
      });
      lastSpawnAtRef.current = at;
    };
    void bridge?.getScreenBallSession?.().then(applySession).catch(() => undefined);
    const off = bridge?.onScreenBallSession?.(applySession);
    return () => {
      active = false;
      off?.();
    };
  }, [bridge]);

  useEffect(() => {
    const reportPointer = (event: PointerEvent) => {
      bridge?.reportScreenBallPointer?.(event.screenX, event.screenY);
      if (screenBallSoundEnabled && !audioContextRef.current) {
        audioContextRef.current = createScreenBallAudioContext();
        void audioContextRef.current?.resume().catch(() => undefined);
      }
      const currentSession = sessionRef.current;
      const currentState = stateRef.current;
      if (!currentSession || !currentState || currentState.phase !== "playing") {
        swipeRef.current = null;
        return;
      }
      const point = { x: event.screenX, y: event.screenY };
      const previous = swipeRef.current;
      if (
        !previous ||
        previous.pointerId !== event.pointerId ||
        previous.sessionId !== currentSession.sessionId
      ) {
        beginSwipe(event);
        return;
      }
      const start = {
        x: previous.x - currentSession.display.x,
        y: previous.y - currentSession.display.y
      };
      const end = {
        x: point.x - currentSession.display.x,
        y: point.y - currentSession.display.y
      };
      const deltaX = end.x - start.x;
      const deltaY = end.y - start.y;
      const length = Math.hypot(deltaX, deltaY);
      if (length >= 1) {
        emitSwipeTrail({
          x: start.x,
          y: start.y,
          length,
          angle: Math.atan2(deltaY, deltaX)
        });
      }
      for (const ball of currentState.balls) {
        if (
          !previous.hitIds.has(ball.id) &&
          screenBallIntersectsSegment(ball, start, end, SWIPE_HIT_PADDING)
        ) {
          previous.hitIds.add(ball.id);
          submitHit(ball.id);
        }
      }
      previous.x = point.x;
      previous.y = point.y;
    };
    const resetSwipe = () => {
      swipeRef.current = null;
    };
    window.addEventListener("pointermove", reportPointer);
    window.addEventListener("pointerup", resetSwipe);
    window.addEventListener("pointercancel", resetSwipe);
    window.addEventListener("blur", resetSwipe);
    return () => {
      window.removeEventListener("pointermove", reportPointer);
      window.removeEventListener("pointerup", resetSwipe);
      window.removeEventListener("pointercancel", resetSwipe);
      window.removeEventListener("blur", resetSwipe);
    };
  }, [bridge, screenBallSoundEnabled]);

  useEffect(() => {
    const off = bridge?.onScreenBallHitAccepted?.((payload) => {
      const currentSession = sessionRef.current;
      const currentState = stateRef.current;
      if (!currentSession || payload.sessionId !== currentSession.sessionId || !currentState) {
        return;
      }
      const target = currentState.balls.find((ball) => ball.id === payload.ballId);
      if (!target) return;
      emitBurst(target);
      if (screenBallSoundEnabled) {
        const audioContext = audioContextRef.current ?? createScreenBallAudioContext();
        audioContextRef.current = audioContext;
        if (audioContext) {
          void audioContext.resume().catch(() => undefined);
          try {
            playScreenBallHitSound(audioContext, target.kind === "bomb" ? "bomb" : "ball");
          } catch {
            // Audio is an enhancement; a blocked or unavailable context must not stop gameplay.
          }
        }
      }
      setState((current) =>
        current ? hitScreenBall(current, payload.ballId, monotonicNow()) : current
      );
    });
    return () => off?.();
  }, [bridge, screenBallSoundEnabled]);

  useEffect(() => {
    if (!session || !state || state.phase !== "playing") return;
    let previous = performance.now();
    const animate = (frameAt: number) => {
      const elapsed = Math.max(0, Math.min(250, frameAt - previous));
      previous = frameAt;
      const at = monotonicNow();
      setState((current) => {
        if (!current || current.phase !== "playing") return current;
        let next = advanceScreenBallState(current, elapsed, at);
        if (
          next.phase === "playing" &&
          next.balls.length < maxScreenBallCount(next.level) &&
          at - lastSpawnAtRef.current >= screenBallSpawnIntervalMs(next.level)
        ) {
          next = spawnScreenBallVolley(next, {
            at,
            origin: session.petOrigin,
            random: Math.random,
            count: screenBallVolleySize(next.level)
          });
          lastSpawnAtRef.current = at;
        }
        return next;
      });
      frameRef.current = requestAnimationFrame(animate);
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [session, state?.phase]);

  const hitRegions = useMemo(() => {
    if (!session || !state) return [];
    const regions: HitRegion[] = state.balls.map((ball) => ({
      id: ball.id,
      x:
        session.display.x +
        ball.x -
        ball.radius * SCREEN_BALL_VISUAL_SCALE -
        HIT_PADDING,
      y:
        session.display.y +
        ball.y -
        ball.radius * SCREEN_BALL_VISUAL_SCALE -
        HIT_PADDING,
      width: ball.radius * SCREEN_BALL_VISUAL_SCALE * 2 + HIT_PADDING * 2,
      height: ball.radius * SCREEN_BALL_VISUAL_SCALE * 2 + HIT_PADDING * 2,
      kind: "ball" as const
    }));
    regions.push({
      id: "screen-ball-sound",
      x: session.display.x + session.display.width - 108,
      y: session.display.y + 12,
      width: 52,
      height: 52,
      kind: "control" as const
    });
    regions.push({
      id: "screen-ball-close",
      x: session.display.x + session.display.width - 72,
      y: session.display.y + 12,
      width: 52,
      height: 52,
      kind: "control" as const
    });
    if (state.phase !== "playing") {
      regions.push({
        id: "screen-ball-replay",
        x: session.display.x + session.display.width / 2 - 92,
        y: session.display.y + session.display.height / 2 + 42,
        width: 184,
        height: 48,
        kind: "control" as const
      });
    }
    return regions;
  }, [session, state]);

  useEffect(() => {
    hitRegionsRef.current = hitRegions;
    if (!bridge?.publishScreenBallHitRegions || publishTimerRef.current !== null) {
      return;
    }
    publishTimerRef.current = window.setTimeout(() => {
      publishTimerRef.current = null;
      bridge.publishScreenBallHitRegions?.(hitRegionsRef.current);
    }, 33);
  }, [bridge, hitRegions]);

  useEffect(
    () => () => {
      if (publishTimerRef.current !== null) {
        window.clearTimeout(publishTimerRef.current);
        publishTimerRef.current = null;
      }
      for (const timer of burstTimersRef.current) window.clearTimeout(timer);
      burstTimersRef.current.clear();
      if (trailClearTimerRef.current !== null) {
        window.clearTimeout(trailClearTimerRef.current);
        trailClearTimerRef.current = null;
      }
      swipeRef.current = null;
      audioContextRef.current?.close().catch(() => undefined);
      audioContextRef.current = null;
    },
    []
  );

  if (!session || !state) return null;
  const remainingSeconds = remainingScreenBallSeconds(state, monotonicNow());

  const close = () => bridge?.closeScreenBall?.(session.sessionId);
  const replay = () => bridge?.startScreenBall?.();
  const toggleScreenBallSound = () => {
    setScreenBallSoundEnabled((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SCREEN_BALL_SOUND_STORAGE_KEY, String(next));
      } catch {
        // Local storage can be unavailable in a restricted renderer profile.
      }
      if (next) {
        void audioContextRef.current?.resume().catch(() => undefined);
      } else {
        void audioContextRef.current?.suspend().catch(() => undefined);
      }
      return next;
    });
  };

  return (
    <main className="butler-screen-ball-surface" aria-label={t("butler.screenBallSurfaceAria")}>
      <section className="butler-screen-ball-hud" aria-live="polite">
        <div className="butler-screen-ball-stat">
          <span>{t("butler.screenBallScore")}</span>
          <strong>{state.score}</strong>
        </div>
        <div className="butler-screen-ball-stat">
          <span>{t("butler.screenBallLevel")}</span>
          <strong>{state.level}</strong>
        </div>
        <div className="butler-screen-ball-stat">
          <span>{t("butler.screenBallMisses")}</span>
          <strong>{state.missed}/10</strong>
        </div>
        <div className="butler-screen-ball-stat">
          <span>{t("butler.screenBallTime")}</span>
          <strong>{remainingSeconds}s</strong>
        </div>
        <span className="butler-screen-ball-swipe-hint">
          {t("butler.screenBallSwipeHint")}
        </span>
        <button
          type="button"
          className="butler-screen-ball-sound"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleScreenBallSound();
          }}
          aria-label={t(
            screenBallSoundEnabled
              ? "butler.screenBallSoundOn"
              : "butler.screenBallSoundOff"
          )}
          title={t(
            screenBallSoundEnabled
              ? "butler.screenBallSoundOn"
              : "butler.screenBallSoundOff"
          )}
        >
          {screenBallSoundEnabled ? (
            <Volume2 aria-hidden="true" size={16} />
          ) : (
            <VolumeX aria-hidden="true" size={16} />
          )}
        </button>
        <button
          type="button"
          className="butler-screen-ball-close"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            close();
          }}
          aria-label={t("butler.screenBallStop")}
          title={t("butler.screenBallStop")}
        >
          <X aria-hidden="true" size={18} />
        </button>
      </section>
      {state.balls.map((ball) => (
        <button
          key={ball.id}
          type="button"
          className={`butler-screen-ball-ball butler-screen-ball-ball--${ball.color ?? "mint"}`}
          style={{
            left: `${ball.x}px`,
            top: `${ball.y}px`,
            width: `${ball.radius * SCREEN_BALL_VISUAL_SCALE * 2}px`,
            height: `${ball.radius * SCREEN_BALL_VISUAL_SCALE * 2}px`
          }}
          aria-label={t(
            ball.kind === "bomb" ? "butler.screenBallBombAria" : "butler.screenBallBallAria"
          )}
          onPointerDown={(event) => {
            beginSwipe(event, ball.id);
            event.preventDefault();
            event.stopPropagation();
            submitHit(ball.id);
          }}
        >
          <img
            className="butler-screen-ball-orb"
            src={SCREEN_BALL_ORB_ASSET}
            alt=""
            draggable={false}
          />
        </button>
      ))}
      {bursts.map((burst) => (
        <span
          key={burst.id}
          className={`butler-screen-ball-burst ${
            burst.kind === "bomb" ? "butler-screen-ball-burst--bomb" : ""
          }`}
          style={{ left: `${burst.x}px`, top: `${burst.y}px` }}
          aria-hidden="true"
        >
          {Array.from({ length: 14 }, (_, index) => (
            <i
              key={index}
              style={{
                transform: `rotate(${index * (360 / 14)}deg) translateY(-${
                  burst.kind === "bomb" ? 42 : 30
                }px)`
              }}
            />
          ))}
        </span>
      ))}
      {trailSegments.map((segment) => (
        <span
          key={segment.id}
          className="butler-screen-ball-swipe-trail"
          style={{
            left: `${segment.x}px`,
            top: `${segment.y}px`,
            width: `${segment.length}px`,
            transform: `rotate(${segment.angle}rad)`
          }}
          aria-hidden="true"
        />
      ))}
      {state.phase !== "playing" && (
        <section
          className={`butler-screen-ball-result ${
            state.terminalReason === "bomb-hit" ? "butler-screen-ball-result--bomb" : ""
          }`}
          role="status"
        >
          <strong>
            {t(
              state.terminalReason === "miss-limit"
                ? "butler.screenBallMissLimit"
                : state.terminalReason === "bomb-hit"
                  ? "butler.screenBallBombHit"
                : state.terminalReason === "stopped"
                  ? "butler.screenBallStopped"
                  : "butler.screenBallPerfect"
            )}
          </strong>
          <span>{t("butler.screenBallFinalScore", { count: state.score })}</span>
          <span>
            {t("butler.screenBallSummary", {
              reaction: state.averageReactionTime === null
                ? "—"
                : `${Math.round(state.averageReactionTime)}ms`,
              combo: state.maxCombo,
              misses: state.missed
            })}
          </span>
          <button
            type="button"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              replay();
            }}
          >
            <RotateCcw aria-hidden="true" size={14} />
            {t("butler.screenBallReplay")}
          </button>
        </section>
      )}
    </main>
  );
}
