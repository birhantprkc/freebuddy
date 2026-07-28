import { create } from "zustand";
import { remapPinnedCwdKeysToProjectIds } from "@/components/CLI/conversationProjectGrouping";
import type { Project } from "@/services/cli/types";

const STORAGE_KEY = "freebuddy.projects.pinned.v1";

function loadPinnedKeys(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((key): key is string => typeof key === "string" && key.length > 0);
  } catch {
    return [];
  }
}

function persistPinnedKeys(keys: string[]) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // Pin state is progressive enhancement.
  }
}

function pinnedKeysEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  return a.every((key, index) => key === b[index]);
}

interface PinnedProjectsState {
  pinnedKeys: string[];
  isPinned(key: string): boolean;
  pin(key: string): void;
  unpin(key: string): void;
  toggle(key: string): void;
}

export const usePinnedProjectsStore = create<PinnedProjectsState>((set, get) => ({
  pinnedKeys: loadPinnedKeys(),

  isPinned(key) {
    return get().pinnedKeys.includes(key);
  },

  pin(key) {
    set((state) => {
      if (state.pinnedKeys.includes(key)) return state;
      const pinnedKeys = [key, ...state.pinnedKeys];
      persistPinnedKeys(pinnedKeys);
      return { pinnedKeys };
    });
  },

  unpin(key) {
    set((state) => {
      if (!state.pinnedKeys.includes(key)) return state;
      const pinnedKeys = state.pinnedKeys.filter((entry) => entry !== key);
      persistPinnedKeys(pinnedKeys);
      return { pinnedKeys };
    });
  },

  toggle(key) {
    if (get().isPinned(key)) get().unpin(key);
    else get().pin(key);
  }
}));

/** Remap cwd-based pin keys to project ids after projects load. No-op if unchanged. */
export function remapPins(projects: Project[]) {
  const { pinnedKeys } = usePinnedProjectsStore.getState();
  const next = remapPinnedCwdKeysToProjectIds(pinnedKeys, projects);
  if (pinnedKeysEqual(pinnedKeys, next)) return;
  persistPinnedKeys(next);
  usePinnedProjectsStore.setState({ pinnedKeys: next });
}
