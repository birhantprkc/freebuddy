import { RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import {
  advanceScreenBallState,
  createScreenBallArcadeState,
  hitScreenBall,
  remainingScreenBallSeconds,
  SCREEN_BALL_MAX_BALLS,
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

const SPAWN_INTERVAL_MS = 900;
const HIT_PADDING = 10;
const petImageUrl = `${import.meta.env.BASE_URL}butlerbuddy-pet.png`;
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
  const sessionRef = useRef<SessionPayload | null>(null);
  const hitRegionsRef = useRef<HitRegion[]>([]);
  const publishTimerRef = useRef<number | null>(null);
  const lastSpawnAtRef = useRef(0);
  const frameRef = useRef<number | null>(null);

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
    };
    window.addEventListener("pointermove", reportPointer);
    return () => window.removeEventListener("pointermove", reportPointer);
  }, [bridge]);

  useEffect(() => {
    const off = bridge?.onScreenBallHitAccepted?.((payload) => {
      if (!session || payload.sessionId !== session.sessionId) return;
      setState((current) =>
        current ? hitScreenBall(current, payload.ballId, monotonicNow()) : current
      );
    });
    return () => off?.();
  }, [bridge, session]);

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
          next.balls.length < SCREEN_BALL_MAX_BALLS &&
          at - lastSpawnAtRef.current >= SPAWN_INTERVAL_MS
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
    },
    []
  );

  if (!session || !state) return null;
  const remainingSeconds = remainingScreenBallSeconds(state, monotonicNow());
  const launcherStyle = {
    left: `${session.petOrigin.x}px`,
    top: `${session.petOrigin.y}px`
  } as CSSProperties;

  const close = () => bridge?.closeScreenBall?.(session.sessionId);
  const replay = () => bridge?.startScreenBall?.();
  const submitHit = (ballId: string) => {
    bridge?.reportScreenBallHit?.(session.sessionId, ballId);
  };

  return (
    <main className="butler-screen-ball-surface" aria-label={t("butler.screenBallSurfaceAria")}>
      <div className="butler-screen-ball-launcher" style={launcherStyle} aria-hidden="true">
        <span />
        <img src={petImageUrl} alt="" draggable={false} />
      </div>
      <section className="butler-screen-ball-hud" aria-live="polite">
        <div className="butler-screen-ball-stat">
          <span>{t("butler.screenBallScore")}</span>
          <strong>{state.score}</strong>
        </div>
        <div className="butler-screen-ball-stat">
          <span>{t("butler.screenBallMisses")}</span>
          <strong>{state.missed}/10</strong>
        </div>
        <div className="butler-screen-ball-stat">
          <span>{t("butler.screenBallTime")}</span>
          <strong>{remainingSeconds}s</strong>
        </div>
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
          className="butler-screen-ball-ball"
          style={{
            left: `${ball.x}px`,
            top: `${ball.y}px`,
            width: `${ball.radius * 2}px`,
            height: `${ball.radius * 2}px`
          }}
          aria-label={t("butler.screenBallBallAria")}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            submitHit(ball.id);
          }}
        >
          <span />
        </button>
      ))}
      {state.phase !== "playing" && (
        <section className="butler-screen-ball-result" role="status">
          <strong>
            {t(
              state.terminalReason === "miss-limit"
                ? "butler.screenBallMissLimit"
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
