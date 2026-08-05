import { create } from "zustand";

export type NewTaskMode = "normal" | "team";

interface NewTaskUiState {
  taskMode: NewTaskMode;
  requestedTeamId?: string;
  /** Bumped whenever a new-task cwd/project should be applied (including clear). */
  cwdRequestToken: number;
  /** Absolute project cwd to prefill; undefined clears the field. */
  requestedCwd?: string;
  /** Project id to attach when creating the conversation. */
  requestedProjectId?: string;
  /** Optional composer text to apply when the new-task page opens. */
  requestedDraft?: string;
  setTaskMode(mode: NewTaskMode): void;
  setRequestedTeamId(teamId?: string): void;
  requestNewTask(options?: { cwd?: string; projectId?: string; draft?: string }): void;
  /** @deprecated Prefer requestNewTask */
  requestNewTaskCwd(cwd?: string): void;
}

export const useNewTaskUiStore = create<NewTaskUiState>((set) => ({
  taskMode: "normal",
  requestedTeamId: undefined,
  cwdRequestToken: 0,
  requestedCwd: undefined,
  requestedProjectId: undefined,
  requestedDraft: undefined,
  setTaskMode: (taskMode) =>
    set((state) => ({
      taskMode,
      requestedTeamId: taskMode === "normal" ? undefined : state.requestedTeamId
    })),
  setRequestedTeamId: (requestedTeamId) => set({ requestedTeamId }),
  requestNewTask: (options) =>
    set((state) => ({
      requestedCwd: options?.cwd,
      requestedProjectId: options?.projectId,
      requestedDraft: options?.draft,
      cwdRequestToken: state.cwdRequestToken + 1
    })),
  requestNewTaskCwd: (cwd) =>
    set((state) => ({
      requestedCwd: cwd,
      requestedProjectId: undefined,
      requestedDraft: undefined,
      cwdRequestToken: state.cwdRequestToken + 1
    }))
}));
