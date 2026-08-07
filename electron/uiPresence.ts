export type MainWorkspaceView =
  | "chat"
  | "scheduledTasks"
  | "workflowTeams"
  | "usage";

export type MainSettingsTab =
  | "general"
  | "cli"
  | "skills"
  | "plugins"
  | "feed"
  | "remote"
  | "about";

export interface MainWindowPresence {
  workspaceView: MainWorkspaceView;
  settingsOpen: boolean;
  settingsTab: MainSettingsTab | null;
  activeConversation: {
    id: string;
    title: string;
    agentId: string;
    agentName: string;
  } | null;
  streaming: boolean;
  updatedAt: string;
}

const WORKSPACE_VIEWS = new Set<MainWorkspaceView>([
  "chat",
  "scheduledTasks",
  "workflowTeams",
  "usage"
]);

const SETTINGS_TABS = new Set<MainSettingsTab>([
  "general",
  "cli",
  "skills",
  "plugins",
  "feed",
  "remote",
  "about"
]);

let latestPresence: MainWindowPresence | null = null;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseMainWindowPresence(
  raw: unknown
): MainWindowPresence | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (!WORKSPACE_VIEWS.has(value.workspaceView as MainWorkspaceView)) return null;
  if (typeof value.settingsOpen !== "boolean") return null;
  if (typeof value.streaming !== "boolean") return null;
  if (!isNonEmptyString(value.updatedAt)) return null;

  let settingsTab: MainSettingsTab | null = null;
  if (value.settingsOpen) {
    if (!SETTINGS_TABS.has(value.settingsTab as MainSettingsTab)) return null;
    settingsTab = value.settingsTab as MainSettingsTab;
  } else if (value.settingsTab !== null && value.settingsTab !== undefined) {
    return null;
  }

  let activeConversation: MainWindowPresence["activeConversation"] = null;
  if (value.activeConversation !== null && value.activeConversation !== undefined) {
    if (
      typeof value.activeConversation !== "object" ||
      Array.isArray(value.activeConversation)
    ) {
      return null;
    }
    const conv = value.activeConversation as Record<string, unknown>;
    if (
      !isNonEmptyString(conv.id) ||
      typeof conv.title !== "string" ||
      !isNonEmptyString(conv.agentId) ||
      typeof conv.agentName !== "string"
    ) {
      return null;
    }
    activeConversation = {
      id: conv.id,
      title: conv.title,
      agentId: conv.agentId,
      agentName: conv.agentName
    };
  }

  return {
    workspaceView: value.workspaceView as MainWorkspaceView,
    settingsOpen: value.settingsOpen,
    settingsTab,
    activeConversation,
    streaming: value.streaming,
    updatedAt: value.updatedAt
  };
}

export function setMainWindowPresence(raw: unknown): boolean {
  const parsed = parseMainWindowPresence(raw);
  if (!parsed) return false;
  latestPresence = parsed;
  return true;
}

export function getMainWindowPresence(): MainWindowPresence | null {
  return latestPresence;
}

export function clearMainWindowPresence(): void {
  latestPresence = null;
}

export function formatMainWindowPresenceSummary(
  presence: MainWindowPresence
): string {
  const settings = presence.settingsOpen
    ? `settings=${presence.settingsTab}`
    : "settings=closed";
  const conversation = presence.activeConversation
    ? `conversation="${presence.activeConversation.title.replace(/"/g, '\\"')}" (${presence.activeConversation.agentId})`
    : "conversation=none";
  return (
    `[FreeBuddy main window] view=${presence.workspaceView}; ${settings}; ` +
    `${conversation}; streaming=${presence.streaming}`
  );
}
