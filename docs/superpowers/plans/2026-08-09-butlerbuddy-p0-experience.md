# ButlerBuddy P0 Experience Implementation Plan

> Follow TDD: add or extend a failing test before each production change. Keep each task independently reviewable.

**Goal:** Make ButlerBuddy feel alive, personal, lightly interactive, and faster to start useful pet-like conversations without adding maintenance pressure or social/sharing scope.

**Architecture:** The Electron main process owns a deterministic ButlerBuddy state coordinator. Existing UI presence supplies the active working signal; existing task-finished call sites report success/failure before native-notification suppression. Pet and chat renderers subscribe through the preload bridge. Profile preferences remain main-process persisted settings and are injected into ButlerBuddy prompts as sanitized identity metadata only.

**Reference:** [P0 product spec](../specs/2026-08-09-butlerbuddy-p0-experience-design.zh-CN.md) · [Figma audit](https://www.figma.com/design/m50WRgu6X6n5FLIWJ4dl3R)

## Global constraints

- P0 includes five states, three personalities, three interactions, and four quick scenes.
- No share cards, friend graph, shop, currency, feeding, punishment loop, or background timer.
- State changes and interactions never invoke an LLM.
- Personality never changes confirmation, permission, privacy, or tool boundaries.
- Do not transmit prompt text, pet names, conversation titles/ids, file names, paths, or workspace data in telemetry.
- Preserve current click-to-chat, drag, right-click menu, global shortcut, persistent conversation, and always-on-top behavior.
- Use real transparent pet assets; do not ship emoji or text-symbol placeholders.
- Respect `prefers-reduced-motion` and do not add a permanent animation timer in JavaScript.

## Proposed file map

| File | Responsibility |
|---|---|
| `electron/butlerBuddyState.ts` | Pure state reduction, coordinator, transient expiry and safe runtime snapshot |
| `electron/main.ts` | State lifecycle, IPC registration, presence/task-result wiring and broadcasts |
| `electron/preload.ts` | Runtime state, task-result and profile-preference bridge |
| `electron/cli/ipc.ts` | ButlerBuddy-only sanitized identity prefix |
| `src/types/freebuddy.d.ts` | Renderer-facing state/profile bridge types |
| `src/utils/soundEffects.ts` | Report every task result before background notification suppression |
| `src/components/ButlerBuddy/ButlerBuddyPet.tsx` | Subscribe and render state; tap/double-click/landing feedback |
| `src/components/ButlerBuddy/ButlerBuddyChat.tsx` | Name/state in header and four quick scenes |
| `src/components/ButlerBuddy/ButlerBuddyAdoptionDialog.tsx` | First-run name/personality flow |
| `src/components/Settings/GeneralTab.tsx` | Edit pet name/personality and reopen adoption UI |
| `src/store/settingsStore.ts` | Profile preference state and updates |
| `src/locales/en.json` / `src/locales/zh-CN.json` | State, personality, adoption and quick-scene copy |
| `styles.css` | State/motion, adoption, quick-scene and reduced-motion styles |
| `public/butlerbuddy/states/*` | Animated WebP state assets and static posters |
| `assets/skills/butlerbuddy/SKILL.md` | Personality is tone-only; quick-scene handling guidance |
| `electron/telemetry.ts` | Privacy-safe P0 events |
| `tests/butlerbuddy-pet-state.test.mjs` | Reducer/coordinator behavior |
| `tests/butlerbuddy.test.mjs` | IPC, profile, UI and privacy contracts |

---

## Task 0: Lock the asset and copy contract

**Files:**

- Create: `public/butlerbuddy/states/idle.webp`
- Create: `public/butlerbuddy/states/working.webp`
- Create: `public/butlerbuddy/states/celebrating.webp`
- Create: `public/butlerbuddy/states/comforting.webp`
- Create: `public/butlerbuddy/states/sleeping.webp`
- Create: `public/butlerbuddy/states/posters/*.png`
- Modify: `src/locales/en.json`
- Modify: `src/locales/zh-CN.json`

### Work

- Produce five transparent 512×512 motion assets with identical body anchor and padding.
- Produce one static poster per state for reduced-motion mode.
- Add final state names, personality names/descriptions, adoption copy and quick-scene labels/prompts.
- Keep prompt text separate from visible label text.

### Acceptance

- [ ] Switching state assets does not move or resize the body inside the 108×108 window.
- [ ] Looping assets have no visible first/last-frame jump.
- [ ] Every state is distinguishable without relying only on the online dot or color.
- [ ] Each animated asset is ≤500 KB and the animated set is ≤3 MB total.
- [ ] Both locales contain every new key; no production string is hardcoded in React.
- [ ] No emoji, ASCII face, text symbol or placeholder rectangle ships as pet artwork.

### Verification

- `sips -g pixelWidth -g pixelHeight public/butlerbuddy/states/**/*.{png,webp}` or platform equivalent.
- Manual contact sheet review at 108×108 and 200% display scaling.

---

## Task 1: Implement the pure pet state model

**Files:**

- Create: `electron/butlerBuddyState.ts`
- Create: `tests/butlerbuddy-pet-state.test.mjs`
- Modify: `tsconfig.electron.json`

### Work

- Define `ButlerBuddyVisualState` and serializable `ButlerBuddyRuntimeState`.
- Implement a pure reducer/context evaluator with explicit priority:
  `celebrating|comforting > working > sleeping > idle`.
- Implement a coordinator that owns one transient-expiry timeout and only emits when the resolved snapshot changes.
- Inject `now()` / scheduler dependencies so time behavior is deterministic in tests.
- Treat killed/stopped runs as neutral.
- Include the standalone state module in the Electron TypeScript build.

### Acceptance

- [ ] Default resolves to `idle`.
- [ ] `streaming=true` resolves to `working` outside an active transient.
- [ ] Success resolves to `celebrating` for 4 seconds; failure resolves to `comforting` for 4 seconds.
- [ ] A transient expiry re-evaluates current context instead of forcing `idle`.
- [ ] 00:00–07:00 resolves to `sleeping` only when not working/transient.
- [ ] Identical inputs do not emit duplicate updates or restart transient timers.
- [ ] Invalid events are rejected without replacing the last valid state.

### Tests

- [ ] Add table-driven reducer priority tests.
- [ ] Add fake-clock transient expiry tests.
- [ ] Add “work starts during celebration” and “failure while sleeping” tests.
- [ ] Add killed/stopped neutral-result test.

Run:

```bash
node --test --test-force-exit tests/butlerbuddy-pet-state.test.mjs
```

---

## Task 2: Wire state and task events across Electron windows

**Files:**

- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/freebuddy.d.ts`
- Modify: `src/utils/soundEffects.ts`
- Modify: `tests/butlerbuddy.test.mjs`

### Work

- Instantiate the coordinator in the main process and broadcast snapshots to pet/chat windows.
- Map valid `freebuddy:uiPresence.streaming` updates to the working signal.
- Add `butlerBuddy:getRuntimeState`, `butlerBuddy:runtimeStateChanged` and `butlerBuddy:reportTaskResult`.
- Add `reportTaskResult` to the preload bridge.
- Call `reportTaskResult` inside `notifyTaskFinished` before the existing foreground/background early return.
- Validate IPC senders and payload enums; do not accept arbitrary metadata.

### Acceptance

- [ ] A foreground conversation completion still reaches the pet even when no native notification is shown.
- [ ] Conversation, scheduled-task and workflow completion use the same result path.
- [ ] Pet and chat receive the same runtime snapshot after opening late.
- [ ] A destroyed/hidden chat window does not prevent pet updates.
- [ ] Runtime IPC contains no title, prompt, content, id or path.
- [ ] Existing native notifications and success/failure sounds behave exactly as before.

### Tests

- [ ] Contract assertions cover all new IPC channel names and preload methods.
- [ ] Test that task reporting occurs before `if (!background) return`.
- [ ] Test payload validation and sender allowlist behavior where extractable.

---

## Task 3: Render states and add lightweight interactions

**Files:**

- Modify: `src/components/ButlerBuddy/ButlerBuddyPet.tsx`
- Modify: `styles.css`
- Modify: `src/locales/en.json`
- Modify: `src/locales/zh-CN.json`
- Modify: `tests/butlerbuddy.test.mjs`

### Work

- Fetch initial runtime state, subscribe to changes and choose the correct asset/poster.
- Keep functional state and short local interaction overlay separate.
- Single click: play head-pat feedback and preserve chat toggle.
- Double click: play poke feedback without a second chat flash/toggle.
- Drag end beyond the current threshold: play landing rebound and suppress click.
- Add a 400ms interaction cooldown.
- Update accessible name with pet name and localized current state.

### Acceptance

- [ ] State changes become visible within 300ms of receiving the IPC snapshot.
- [ ] Single click still toggles chat exactly once.
- [ ] Double click triggers poke feedback and does not rapidly hide/show chat.
- [ ] Dragging never opens chat and pet/chat group positioning does not drift.
- [ ] Landing feedback plays once per completed drag.
- [ ] Interaction feedback returns to the underlying state (`working`, etc.).
- [ ] `prefers-reduced-motion: reduce` uses static posters and disables jump/shake/rebound transforms.
- [ ] No continuous renderer timer is used for idle animation.

### Tests

- [ ] Extract click/double-click/drag suppression decisions into pure helpers and unit test them.
- [ ] Extend source contract tests for state assets, reduced-motion CSS and accessible copy.
- [ ] Manual matrix: macOS + Windows, 100%/200% scaling, chat hidden/open.

---

## Task 4: Add name, personality, adoption and settings

**Files:**

- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/freebuddy.d.ts`
- Modify: `src/store/settingsStore.ts`
- Create: `src/components/ButlerBuddy/ButlerBuddyAdoptionDialog.tsx`
- Modify: `src/components/Settings/GeneralTab.tsx`
- Modify: `src/App.tsx`
- Modify: `styles.css`
- Modify: locales and tests

### Work

- Extend `ButlerBuddyPreferences` with sanitized `name`, `personality`, `profileConfigured`, and `profilePromptSeen`.
- Keep backward-compatible defaults for existing installations.
- Show the adoption dialog once from the main window when the pet is enabled and the prompt has not been seen.
- Support “完成领养” and “以后再说”; neither path disables the pet.
- Add name/personality editing and “重新设置” to General settings.
- Replace visible `ButlerBuddy` chat/pet labels with the configured name where it reads naturally.

### Acceptance

- [ ] Existing users upgrade with `ButlerBuddy` + `gentle` defaults and no crash.
- [ ] The automatic prompt appears at most once per profile.
- [ ] “以后再说” persists prompt-seen state and settings can reopen the flow.
- [ ] A valid name persists across app restart and synchronizes to pet/chat/settings without reopening windows.
- [ ] Empty, control-character, newline or >16-character names are rejected with an inline error.
- [ ] The three personalities show distinct preview copy.
- [ ] Adoption dialog is keyboard navigable; focus returns to its opener after manual close.

### Tests

- [ ] Pure tests for Unicode length, control-character stripping and fallback.
- [ ] Preference migration/default tests.
- [ ] Contract tests for the new fields across main/preload/renderer types.

---

## Task 5: Inject sanitized identity without weakening ButlerBuddy

**Files:**

- Modify: `electron/cli/ipc.ts`
- Modify: `assets/skills/butlerbuddy/SKILL.md`
- Modify: `tests/butlerbuddy.test.mjs`

### Work

- For `cli-butlerbuddy` only, prepend the one-line identity block after sanitization.
- Keep identity separate from the main-window presence summary.
- Document that personality affects tone only and cannot change action confirmation or tool policy.
- Add style guidance for gentle, cheerful and dry without forcing repetitive catchphrases.

### Acceptance

- [ ] Identity is injected only for `cli-butlerbuddy`, never other agents.
- [ ] Newlines, quotes and control characters cannot break the one-line block.
- [ ] The block contains only name and personality.
- [ ] All mutation confirmation and safety requirements remain present in the core skill.
- [ ] `dry` explicitly forbids insults, competence shaming and guilt language.

### Tests

- [ ] Exact prefix tests for all three personalities.
- [ ] Injection test with newline/quote/control-character name input.
- [ ] Negative test for a non-ButlerBuddy agent.

---

## Task 6: Add four quick conversation scenes

**Files:**

- Modify: `src/components/ButlerBuddy/ButlerBuddyChat.tsx`
- Modify: `styles.css`
- Modify: locales and tests

### Work

- Render a 2×2 scene grid when the real pet conversation has no user message.
- Add labels and localizable prompt templates for:
  `praise_me`, `summarize_current`, `diagnose_blocker`, `suggest_next_step`.
- Clicking a scene fills and focuses the composer; it never auto-submits.
- Hide the grid after the first user message without changing message history.
- Keep preview mode behavior deterministic for browser QA.

### Acceptance

- [ ] All four scenes fit at 360×420 without clipping the composer.
- [ ] Tab order follows visual order; Enter/Space selects a scene.
- [ ] Selecting a scene only fills the draft and leaves Send available.
- [ ] The user can edit, clear or cancel before sending.
- [ ] The grid disappears after a user message and does not reappear during streaming.
- [ ] “总结当前对话” and diagnostic prompts tell ButlerBuddy to inspect actual current context rather than invent content.

### Tests

- [ ] Prompt-template unit tests for both locales.
- [ ] Source contract tests for scene ids and non-auto-submit behavior.
- [ ] Browser screenshot at 360×420 for empty, selected and post-send states.

---

## Task 7: Add privacy-safe measurement and accessibility polish

**Files:**

- Modify: `electron/telemetry.ts`
- Modify: event call sites from Tasks 2–6
- Modify: styles/locales/tests

### Work

- Add the six P0 events defined in the product spec.
- Keep event properties enum/boolean only; never pass arbitrary strings from users.
- Verify focus rings, label associations, contrast and reduced motion.
- Make automatic state changes silent to assistive technology; expose current state on demand through the button label.

### Acceptance

- [ ] Telemetry off means no P0 event reaches PostHog.
- [ ] Event schemas cannot accept pet name, prompt, title, id, file/path or workspace properties.
- [ ] Scene and interaction properties are closed unions.
- [ ] Every new interactive element has a visible focus indicator.
- [ ] Text and controls meet WCAG AA contrast in light and dark themes.
- [ ] Screen reader output does not announce every animation loop or transient frame.

### Tests

- [ ] Type-level telemetry schema checks.
- [ ] Privacy regression test rejects unexpected properties.
- [ ] Manual VoiceOver/NVDA smoke test.

---

## Task 8: End-to-end verification and release gate

### Automated checks

```bash
node --test --test-force-exit tests/butlerbuddy-pet-state.test.mjs tests/butlerbuddy.test.mjs
npm run typecheck
npm run build
npm test
```

### Manual acceptance matrix

- [ ] Fresh install: adoption prompt → configure → restart → values persist.
- [ ] Existing profile: defaults migrate without prompt loop or preference loss.
- [ ] Conversation start/finish success/failure/killed drives expected state.
- [ ] Scheduled task and workflow finish drive expected transient state.
- [ ] Celebration/comfort expiry returns to the correct current state.
- [ ] Click, double click, drag, right click, shortcut and chat close all behave correctly.
- [ ] Pet and chat stay paired near every screen edge and on secondary displays.
- [ ] Light/dark/system theme and Chinese/English render without clipping.
- [ ] Reduced motion uses posters and no rebound/shake.
- [ ] Packaged macOS and Windows builds load every state asset.
- [ ] Idle pet causes no continuous JS timer and no material CPU regression versus baseline.

### Release gate

P0 is not ready when any of these are true:

- a required motion asset is missing or replaced by a placeholder;
- task completion can be lost in the foreground;
- click/drag regression opens or flickers chat unexpectedly;
- identity appears in another agent's prompt;
- telemetry can contain user-provided text;
- reduced-motion mode still plays animated WebP or transform motion.

## Suggested PR sequence

1. State reducer + tests.
2. Main/preload event bridge.
3. State assets + renderer interactions.
4. Profile preferences + adoption/settings.
5. Identity prompt + core skill guardrails.
6. Quick scenes.
7. Telemetry, accessibility and full release verification.
