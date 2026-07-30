import { create } from "zustand";

interface DebugLogsDialogState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useDebugLogsDialogStore = create<DebugLogsDialogState>((set) => ({
  open: false,
  setOpen: (open) => set({ open })
}));
