type EventBroadcaster = (channel: string, payload: unknown) => void;

let activeBroadcaster: EventBroadcaster | null = null;

export function setEventBroadcaster(fn: EventBroadcaster | null): void {
  activeBroadcaster = fn;
}

export function broadcastEvent(channel: string, payload: unknown): void {
  if (!activeBroadcaster) return;
  try {
    activeBroadcaster(channel, payload);
  } catch {
    // broadcaster must never disrupt the desktop send path
  }
}
