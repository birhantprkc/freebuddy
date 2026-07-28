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
  setTaskMode(mode: NewTaskMode): void;
  setRequestedTeamId(teamId?: string): void;
  requestNewTask(options?: { cwd?: string; projectId?: string }): void;
  /** @deprecated Prefer requestNewTask */
  requestNewTaskCwd(cwd?: string): void;
}

export const useNewTaskUiStore = create<NewTaskUiState>((set) => ({
  taskMode: "normal",
  requestedTeamId: undefined,
  cwdRequestToken: 0,
  requestedCwd: undefined,
  requestedProjectId: undefined,
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
      cwdRequestToken: state.cwdRequestToken + 1
    })),
  requestNewTaskCwd: (cwd) =>
    set((state) => ({
      requestedCwd: cwd,
      requestedProjectId: undefined,
      cwdRequestToken: state.cwdRequestToken + 1
    }))
}));
