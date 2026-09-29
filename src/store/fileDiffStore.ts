import { create } from "zustand";
import type { FileEdit } from "@/utils/fileDiff";
import { useDetailLayoutStore } from "./detailLayoutStore";

interface DiffSelection { conversationId: string; messageId?: string; edits: FileEdit[]; index: number }
interface FileDiffState {
  selection?: DiffSelection;
  open(selection: DiffSelection): void;
  select(index: number): void;
  refresh(conversationId: string, messageId: string, edits: FileEdit[]): void;
}

export const useFileDiffStore = create<FileDiffState>((set, get) => ({
  open(selection) {
    set({ selection });
    const layout = useDetailLayoutStore.getState();
    layout.setActiveTab("diff");
    layout.setDetailCollapsed(false);
  },
  select(index) {
    const selection = get().selection;
    if (selection && index >= 0 && index < selection.edits.length) set({ selection: { ...selection, index } });
  },
  refresh(conversationId, messageId, edits) {
    const selection = get().selection;
    if (selection?.conversationId === conversationId && selection.messageId === messageId) {
      set({ selection: { ...selection, edits, index: Math.min(selection.index, Math.max(0, edits.length - 1)) } });
    }
  }
}));
