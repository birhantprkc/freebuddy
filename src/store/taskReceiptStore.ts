import { create } from "zustand";

import {
  buildTaskReceiptSummary,
  normalizeTaskReceiptCompletion,
  pruneTaskReceiptCompletions,
  shouldAutoOpenTaskReceipt,
  type TaskReceiptCompletion
} from "@/utils/taskReceipt";

const STORAGE_KEY = "freebuddy.butlerBuddy.taskReceipt.v1";

interface PersistedTaskReceiptState {
  completions: TaskReceiptCompletion[];
  autoOpenedDay?: string;
}

interface TaskReceiptState extends PersistedTaskReceiptState {
  open: boolean;
  openReport(): void;
  closeReport(): void;
  recordCompletion(input: TaskReceiptCompletion): boolean;
}

function loadPersistedState(): PersistedTaskReceiptState {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return { completions: [] };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      completions: Array.isArray(parsed.completions)
        ? pruneTaskReceiptCompletions(parsed.completions as TaskReceiptCompletion[])
        : [],
      ...(typeof parsed.autoOpenedDay === "string"
        ? { autoOpenedDay: parsed.autoOpenedDay }
        : {})
    };
  } catch {
    return { completions: [] };
  }
}

function persistState(state: PersistedTaskReceiptState): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // The receipt remains usable for the current session when storage is unavailable.
  }
}

const initial = loadPersistedState();

export const useTaskReceiptStore = create<TaskReceiptState>((set, get) => ({
  ...initial,
  open: false,

  openReport() {
    set({ open: true });
  },

  closeReport() {
    set({ open: false });
  },

  recordCompletion(input) {
    const completion = normalizeTaskReceiptCompletion(input);
    if (!completion) return false;
    const current = get();
    if (current.completions.some((entry) => entry.id === completion.id)) {
      return false;
    }
    const completions = pruneTaskReceiptCompletions([
      completion,
      ...current.completions
    ]);
    const summary = buildTaskReceiptSummary(completions);
    const shouldAutoOpen = shouldAutoOpenTaskReceipt(
      summary,
      completion.result,
      current.autoOpenedDay
    );
    const autoOpenedDay = shouldAutoOpen
      ? summary.dayKey
      : current.autoOpenedDay;
    persistState({ completions, autoOpenedDay });
    set({
      completions,
      autoOpenedDay,
      ...(shouldAutoOpen ? { open: true } : {})
    });
    return true;
  }
}));
