export type ScreenBallBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ScreenBallDisplaySnapshot = ScreenBallBounds & {
  id: number | string;
};

export type ScreenBallHitRegion = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: "ball" | "control";
};

export type ScreenBallSession = {
  id: string;
  display: ScreenBallDisplaySnapshot;
};

export function snapshotScreenBallDisplay(
  display: { id: number | string; workArea: ScreenBallBounds }
): ScreenBallDisplaySnapshot {
  return { id: display.id, ...display.workArea };
}

export function displayChangedForScreenBall(
  current: ScreenBallDisplaySnapshot | null,
  next: ScreenBallDisplaySnapshot
): boolean {
  return current !== null && current.id !== next.id;
}

export function clampScreenBallBounds(
  bounds: ScreenBallBounds,
  display: ScreenBallDisplaySnapshot
): ScreenBallBounds {
  const width = Math.min(Math.max(1, bounds.width), display.width);
  const height = Math.min(Math.max(1, bounds.height), display.height);
  return {
    width,
    height,
    x: Math.max(display.x, Math.min(Math.round(bounds.x), display.x + display.width - width)),
    y: Math.max(display.y, Math.min(Math.round(bounds.y), display.y + display.height - height))
  };
}

export function projectScreenBallPoint(
  point: { x: number; y: number },
  from: ScreenBallDisplaySnapshot,
  to: ScreenBallDisplaySnapshot
): { x: number; y: number } {
  const nx = from.width > 0 ? (point.x - from.x) / from.width : 0.5;
  const ny = from.height > 0 ? (point.y - from.y) / from.height : 0.5;
  return {
    x: to.x + Math.max(0, Math.min(1, nx)) * to.width,
    y: to.y + Math.max(0, Math.min(1, ny)) * to.height
  };
}

export function hitRegionContainsPoint(
  region: ScreenBallHitRegion,
  point: { x: number; y: number }
): boolean {
  return (
    point.x >= region.x &&
    point.x <= region.x + region.width &&
    point.y >= region.y &&
    point.y <= region.y + region.height
  );
}

export function shouldCaptureScreenBallPointer(
  regions: readonly ScreenBallHitRegion[],
  point: { x: number; y: number }
): boolean {
  return regions.some((region) => hitRegionContainsPoint(region, point));
}

export function isCurrentScreenBallSession(
  session: ScreenBallSession | null,
  sessionId: string
): boolean {
  return Boolean(session && session.id === sessionId);
}

export function disposeScreenBallSession(
  session: ScreenBallSession | null
): ScreenBallSession | null {
  return session === null ? null : null;
}
