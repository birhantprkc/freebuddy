export const PET_DRAG_THRESHOLD_PX = 3;
export const PET_INTERACTION_COOLDOWN_MS = 400;
export const PET_SINGLE_CLICK_DELAY_MS = 320;

export interface PetScreenPoint {
  x: number;
  y: number;
}

export type PetPointerRelease = "click" | "drag";
export type PetClickAction = "queue-pat" | "poke" | "ignore";

export function classifyPetPointerRelease(
  down: PetScreenPoint,
  up: PetScreenPoint,
  threshold = PET_DRAG_THRESHOLD_PX
): PetPointerRelease {
  return Math.hypot(up.x - down.x, up.y - down.y) >= threshold
    ? "drag"
    : "click";
}

export function isPetInteractionCoolingDown(
  lastInteractionAt: number | null,
  now: number,
  cooldownMs = PET_INTERACTION_COOLDOWN_MS
): boolean {
  return (
    lastInteractionAt !== null &&
    now >= lastInteractionAt &&
    now - lastInteractionAt < cooldownMs
  );
}

export function classifyPetClick(
  clickDetail: number,
  coolingDown: boolean
): PetClickAction {
  if (coolingDown) return "ignore";
  return clickDetail >= 2 ? "poke" : "queue-pat";
}
