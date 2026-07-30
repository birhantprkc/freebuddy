import { debugLogClient } from "@/services/debugLog";

const baseUrl = import.meta.env?.BASE_URL ?? "./";

const SOUNDS = {
  success: `${baseUrl}sounds/finish.mp3`,
  failure: `${baseUrl}sounds/failed.mp3`
} as const;

let audioCache: Partial<Record<keyof typeof SOUNDS, HTMLAudioElement>> = {};

function getAudio(kind: keyof typeof SOUNDS): HTMLAudioElement | undefined {
  if (audioCache[kind]) return audioCache[kind];
  try {
    const audio = new Audio(SOUNDS[kind]);
    audio.preload = "auto";
    audio.volume = 0.7;
    audioCache[kind] = audio;
    return audio;
  } catch {
    return undefined;
  }
}

export function isAppInBackground(): boolean {
  if (typeof document === "undefined") return false;
  return document.hidden;
}

export function playTaskSuccess(backgroundOnly = true): void {
  if (backgroundOnly && !isAppInBackground()) return;
  const audio = getAudio("success");
  if (!audio) return;
  audio.currentTime = 0;
  void audio.play().catch((err: unknown) => {
    debugLogClient.error("sound", "success sound failed", {
      src: audio.currentSrc,
      message: err instanceof Error ? err.message : String(err)
    });
  });
}

export function playTaskFailure(backgroundOnly = true): void {
  if (backgroundOnly && !isAppInBackground()) return;
  const audio = getAudio("failure");
  if (!audio) return;
  audio.currentTime = 0;
  void audio.play().catch((err: unknown) => {
    debugLogClient.error("sound", "failure sound failed", {
      src: audio.currentSrc,
      message: err instanceof Error ? err.message : String(err)
    });
  });
}

export function notifyTaskFinished(
  kind: "success" | "failure",
  title: string,
  body?: string
): void {
  if (!isAppInBackground()) return;
  window.freebuddy?.window?.notifyTask?.({ kind, title, body })?.catch(() => {});
}
