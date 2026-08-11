import { create } from "zustand";
import i18next from "i18next";
import { cliClient } from "@/services/cli/client";
import {
  normalizeLanguagePreference,
  resolveLanguagePreference,
  type AppLocale,
  type LanguagePreference
} from "@/utils/detectLocale";
import {
  getSystemTheme,
  normalizeThemePreference,
  resolveThemePreference,
  type ResolvedTheme,
  type ThemePreference
} from "@/utils/detectTheme";

interface SettingsState {
  loaded: boolean;
  language: LanguagePreference;
  resolvedLanguage: AppLocale;
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  telemetryEnabled: boolean;
  butlerBuddyVisible: boolean;
  butlerBuddyShortcutEnabled: boolean;
  butlerBuddyShortcut: string;
  butlerBuddyShortcutRegistered: boolean;
  butlerBuddyShortcutError?: "shortcutUnavailable";
  load(): Promise<void>;
  setLanguage(lng: LanguagePreference): Promise<void>;
  setTheme(
    theme: ThemePreference,
    options?: { syncPeers?: boolean }
  ): Promise<void>;
  setTelemetryEnabled(enabled: boolean): Promise<void>;
  updateButlerBuddyPreferences(input: {
    visible?: boolean;
    shortcutEnabled?: boolean;
    shortcut?: string;
  }): Promise<void>;
  applyButlerBuddyPreferences(prefs: {
    visible: boolean;
    shortcutEnabled: boolean;
    shortcut: string;
    shortcutRegistered: boolean;
    error?: "shortcutUnavailable";
  }): void;
  refreshSystemTheme(): void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  loaded: false,
  language: "system",
  resolvedLanguage: "en",
  theme: "system",
  resolvedTheme: getSystemTheme(),
  telemetryEnabled: true,
  butlerBuddyVisible: true,
  butlerBuddyShortcutEnabled: true,
  butlerBuddyShortcut: "CommandOrControl+Shift+Space",
  butlerBuddyShortcutRegistered: false,
  butlerBuddyShortcutError: undefined,

  async load() {
    const systemLanguage =
      typeof navigator !== "undefined" ? navigator.language : undefined;
    const systemTheme = getSystemTheme();
    if (!cliClient.isAvailable()) {
      const resolved = resolveLanguagePreference("system", systemLanguage);
      await i18next.changeLanguage(resolved);
      set({
        loaded: true,
        language: "system",
        resolvedLanguage: resolved,
        theme: "system",
        resolvedTheme: resolveThemePreference("system", systemTheme),
        telemetryEnabled: true,
        butlerBuddyVisible: true,
        butlerBuddyShortcutEnabled: true,
        butlerBuddyShortcut: "CommandOrControl+Shift+Space",
        butlerBuddyShortcutRegistered: false,
        butlerBuddyShortcutError: undefined
      });
      return;
    }
    const stored = await cliClient.getSetting("language");
    const preference = normalizeLanguagePreference(stored);
    const resolved = resolveLanguagePreference(preference, systemLanguage);
    const storedTheme = await cliClient.getSetting("theme");
    const storedTelemetryEnabled = await cliClient.getSetting("telemetry.enabled");
    const butlerPreferences = await window.freebuddy?.butlerBuddy
      ?.getPreferences()
      .catch(() => undefined);
    const themePreference = normalizeThemePreference(storedTheme);
    const resolvedTheme = resolveThemePreference(themePreference, systemTheme);
    await i18next.changeLanguage(resolved);
    set({
      loaded: true,
      language: preference,
      resolvedLanguage: resolved,
      theme: themePreference,
      resolvedTheme,
      telemetryEnabled: storedTelemetryEnabled !== "false",
      butlerBuddyVisible: butlerPreferences?.visible ?? true,
      butlerBuddyShortcutEnabled: butlerPreferences?.shortcutEnabled ?? true,
      butlerBuddyShortcut:
        butlerPreferences?.shortcut ?? "CommandOrControl+Shift+Space",
      butlerBuddyShortcutRegistered:
        butlerPreferences?.shortcutRegistered ?? false,
      butlerBuddyShortcutError: butlerPreferences?.error
    });
  },

  async setLanguage(lng) {
    const systemLanguage =
      typeof navigator !== "undefined" ? navigator.language : undefined;
    const resolved = resolveLanguagePreference(lng, systemLanguage);
    await i18next.changeLanguage(resolved);
    set({ language: lng, resolvedLanguage: resolved });
    if (cliClient.isAvailable()) {
      await cliClient.setSetting("language", lng);
    }
  },

  async setTheme(theme, options) {
    const resolvedTheme = resolveThemePreference(theme, getSystemTheme());
    set({ theme, resolvedTheme });
    if (cliClient.isAvailable()) {
      await cliClient.setSetting("theme", theme);
    }
    if (options?.syncPeers !== false) {
      window.freebuddy?.window?.broadcastTheme?.(theme);
    }
  },

  async setTelemetryEnabled(enabled) {
    set({ telemetryEnabled: enabled });
    if (cliClient.isAvailable()) {
      await cliClient.setSetting("telemetry.enabled", enabled ? "true" : "false");
    }
  },

  async updateButlerBuddyPreferences(input) {
    const api = window.freebuddy?.butlerBuddy;
    if (!api) {
      set({
        ...(input.visible === undefined
          ? {}
          : { butlerBuddyVisible: input.visible }),
        ...(input.shortcutEnabled === undefined
          ? {}
          : { butlerBuddyShortcutEnabled: input.shortcutEnabled }),
        ...(input.shortcut === undefined
          ? {}
          : { butlerBuddyShortcut: input.shortcut }),
      });
      return;
    }
    const result = await api.updatePreferences(input);
    set({
      butlerBuddyVisible: result.visible,
      butlerBuddyShortcutEnabled: result.shortcutEnabled,
      butlerBuddyShortcut: result.shortcut,
      butlerBuddyShortcutRegistered: result.shortcutRegistered,
      butlerBuddyShortcutError: result.error
    });
  },
  refreshSystemTheme() {
    const systemTheme = getSystemTheme();
    set((state) => ({
      resolvedTheme: resolveThemePreference(state.theme, systemTheme)
    }));
  },
  applyButlerBuddyPreferences(prefs) {
    set({
      butlerBuddyVisible: prefs.visible,
      butlerBuddyShortcutEnabled: prefs.shortcutEnabled,
      butlerBuddyShortcut: prefs.shortcut,
      butlerBuddyShortcutRegistered: prefs.shortcutRegistered,
      butlerBuddyShortcutError: prefs.error
    });
  }
}));
