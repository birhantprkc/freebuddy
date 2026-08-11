import { RotateCcw, X } from "lucide-react";
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
  spawnScreenBall,
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

const HIT_PADDING = 10;
const SWIPE_HIT_PADDING = 14;
const BURST_DURATION_MS = 420;
const CLOCK_ORIGIN =
  typeof performance.timeOrigin === "number"
    ? performance.timeOrigin
    : Date.now() - performance.now();

function monotonicNow(): number {
  return CLOCK_ORIGIN + performance.now();
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
    setBursts((current) => [...current, { id, x: ball.x, y: ball.y, kind }].slice(-12));
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
  }, [bridge]);

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
      setState((current) =>
        current ? hitScreenBall(current, payload.ballId, monotonicNow()) : current
      );
    });
    return () => off?.();
  }, [bridge]);

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
          next = spawnScreenBall(next, {
            at,
            origin: session.petOrigin,
            random: Math.random
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
      x: session.display.x + ball.x - ball.radius - HIT_PADDING,
      y: session.display.y + ball.y - ball.radius - HIT_PADDING,
      width: ball.radius * 2 + HIT_PADDING * 2,
      height: ball.radius * 2 + HIT_PADDING * 2,
      kind: "ball" as const
    }));
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
    },
    []
  );

  if (!session || !state) return null;
  const remainingSeconds = remainingScreenBallSeconds(state, monotonicNow());

  const close = () => bridge?.closeScreenBall?.(session.sessionId);
  const replay = () => bridge?.startScreenBall?.();

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
            width: `${ball.radius * 2}px`,
            height: `${ball.radius * 2}px`
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
          <span />
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
          {Array.from({ length: 8 }, (_, index) => (
            <i
              key={index}
              style={{ transform: `rotate(${index * 45}deg) translateY(-18px)` }}
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
