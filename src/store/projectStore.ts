import { create } from "zustand";

import { remapPins } from "@/store/pinnedProjectsStore";
import { cliClient } from "@/services/cli/client";
import type { Project, ProjectInput } from "@/services/cli/types";

interface ProjectState {
  projects: Project[];
  loading: boolean;
  loaded: boolean;
  error?: string;
  refresh(): Promise<void>;
  create(input: ProjectInput): Promise<Project>;
  update(input: ProjectInput & { id: string }): Promise<Project>;
  remove(id: string): Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  loading: false,
  loaded: false,
  error: undefined,

  async refresh() {
    if (!cliClient.isAvailable()) return;
    set({ loading: true, error: undefined });
    try {
      const projects = await cliClient.listProjects();
      remapPins(projects);
      set({ projects, loaded: true });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      set({ loading: false });
    }
  },

  async create(input) {
    const project = await cliClient.createProject(input);
    await get().refresh();
    return get().projects.find((entry) => entry.id === project.id) ?? project;
  },

  async update(input) {
    const project = await cliClient.updateProject(input);
    await get().refresh();
    return get().projects.find((entry) => entry.id === project.id) ?? project;
  },

  async remove(id) {
    await cliClient.deleteProject(id);
    await get().refresh();
  }
}));
