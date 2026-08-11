type PreferenceBroadcastWindow<TWebContents> = {
  isDestroyed(): boolean;
  webContents: TWebContents;
};

export function broadcastButlerBuddyPreferences<TPreferences, TWebContents>(
  windows: ReadonlyArray<PreferenceBroadcastWindow<TWebContents> | null>,
  preferences: TPreferences,
  send: (
    webContents: TWebContents,
    channel: "butlerBuddy:preferencesChanged",
    preferences: TPreferences
  ) => void
): void {
  for (const win of windows) {
    if (!win || win.isDestroyed()) continue;
    send(win.webContents, "butlerBuddy:preferencesChanged", preferences);
  }
}
