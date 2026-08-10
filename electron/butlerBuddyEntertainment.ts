export const BUTLER_PET_SIZE = 108;
export const BUTLER_PET_ARCADE_WIDTH = 360;
export const BUTLER_PET_ARCADE_HEIGHT = 300;

export type ButlerBuddyBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ButlerBuddyPetWindow = {
  isDestroyed(): boolean;
  getBounds(): ButlerBuddyBounds;
  setBounds(bounds: ButlerBuddyBounds, animate: boolean): void;
};

function clampWindowCoordinate(
  value: number,
  start: number,
  available: number,
  size: number
): number {
  return Math.max(start, Math.min(Math.round(value), start + available - size));
}

function petActorCenterOffset(entertainmentEnabled: boolean) {
  return entertainmentEnabled
    ? { x: BUTLER_PET_ARCADE_WIDTH / 2, y: BUTLER_PET_ARCADE_HEIGHT - 56 }
    : { x: BUTLER_PET_SIZE / 2, y: BUTLER_PET_SIZE / 2 };
}

export function calculateButlerBuddyEntertainmentBounds(
  currentBounds: ButlerBuddyBounds,
  workArea: ButlerBuddyBounds,
  enabled: boolean,
  previousEnabled: boolean
): ButlerBuddyBounds {
  const currentOffset = petActorCenterOffset(previousEnabled);
  const nextOffset = petActorCenterOffset(enabled);
  const width = enabled ? BUTLER_PET_ARCADE_WIDTH : BUTLER_PET_SIZE;
  const height = enabled ? BUTLER_PET_ARCADE_HEIGHT : BUTLER_PET_SIZE;
  const actorX = currentBounds.x + currentOffset.x;
  const actorY = currentBounds.y + currentOffset.y;

  return {
    width,
    height,
    x: clampWindowCoordinate(
      actorX - nextOffset.x,
      workArea.x,
      workArea.width,
      width
    ),
    y: clampWindowCoordinate(
      actorY - nextOffset.y,
      workArea.y,
      workArea.height,
      height
    )
  };
}

export function applyButlerBuddyEntertainmentTransition(input: {
  enabled: boolean;
  previousEnabled: boolean;
  pet: ButlerBuddyPetWindow | null;
  getWorkArea(bounds: ButlerBuddyBounds): ButlerBuddyBounds;
  hideChat(): void;
  syncChatPosition(): void;
}): boolean {
  const { enabled, previousEnabled, pet } = input;
  if (!pet || pet.isDestroyed() || enabled === previousEnabled) return false;
  if (enabled) input.hideChat();

  const currentBounds = pet.getBounds();
  pet.setBounds(
    calculateButlerBuddyEntertainmentBounds(
      currentBounds,
      input.getWorkArea(currentBounds),
      enabled,
      previousEnabled
    ),
    false
  );
  input.syncChatPosition();
  return true;
}

export function persistButlerBuddyEntertainmentChange(input: {
  enabled: boolean;
  previousEnabled: boolean;
  persist(enabled: boolean): void;
  applyTransition(enabled: boolean, previousEnabled: boolean): void;
}): boolean {
  if (input.enabled === input.previousEnabled) return false;
  input.persist(input.enabled);
  input.applyTransition(input.enabled, input.previousEnabled);
  return true;
}

type PreferenceBroadcastWindow<TWebContents> = {
  isDestroyed(): boolean;
  webContents: TWebContents;
};

export function broadcastButlerBuddyPreferences<TPreferences, TWebContents>(
  windows: ReadonlyArray<PreferenceBroadcastWindow<TWebContents> | null>,
  preferences: TPreferences,
  send: (
    webContents: TWebContents,
    channel: "butlerBuddy:preferencesChanged",
    preferences: TPreferences
  ) => void
): void {
  for (const win of windows) {
    if (!win || win.isDestroyed()) continue;
    send(win.webContents, "butlerBuddy:preferencesChanged", preferences);
  }
}
