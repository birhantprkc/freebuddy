# Changelog

记录面向用户的版本变更。每次执行 `npm run release` 时，系统会从上一个 tag 之后的提交生成初稿；如需使用人工或 Agent 润色的文案，可传入 `--notes-file <路径>`。

## [0.7.9] - 2026-08-11

### 新功能

- add show main window shortcut to desktop pet and keep unfocused task completions unread
- reuse orb styling in full-screen arcade
- add level volleys and ignore bomb misses
- enrich screen ball feedback and sound toggle
- add screen ball difficulty levels and bomb target
- add screen ball swipes and burst effects
- add full-screen ButlerBuddy screen ball game

### 问题修复

- increase full-screen arcade ball size
- enlarge full-screen arcade balls
- enable hover swipes and add light trails
- tune screen ball launch and remove duplicate pet

### 体验优化

- keep ButlerBuddy arcade full-screen only

## [0.7.8] - 2026-08-09

### 问题修复

- keep ButlerBuddy visible over macOS fullscreen

## [0.7.7] - 2026-08-09

### 新功能

- upgrade ButlerBuddy pet experience

## [0.7.6] - 2026-08-08

### 问题修复

- stabilize concurrent agent streaming

## [0.7.5] - 2026-08-07

### 其他更新

- 常规维护与稳定性改进

## [0.7.4] - 2026-08-07

### 新功能

- add app tray, native macOS menu, and unread badge

## [0.7.3] - 2026-08-07

### 问题修复

- fall back to session/new when saved ACP sessions are gone
- group selected skills above available in SkillPicker
- allow Cli Agents list to scroll when overflowed

## [0.7.2] - 2026-08-07

### 新功能

- add conversation_messages read tool
- hide-chat menu item removed and stop button during reply
- sync lists, fuzzy open, and pet theme
- add conversation and workspace navigation tools
- inject main window presence into butler prompts
- expose mainWindow on status_get
- publish main window UI presence
- add main window presence store

### 问题修复

- confirm quit when closing main window on macOS
- harden main window presence publishing
- route pet chat UI tools to main window

## [0.7.1] - 2026-08-07

### 问题修复

- repair failing release CI tests

## [0.7.0] - 2026-08-07

### 新功能

- smaller pet, avatar menu toggle, and preference sync
- pet interactions, global shortcut, and config-options merge fix
- add ButlerBuddy floating companion
- ButlerBuddy 配置面板 + freebuddy-butler 工具系统
- add ButlerBuddy agent profile

### 问题修复

- honor agent launch overrides

## [0.6.27] - 2026-08-05

### 新功能

- add Agent self-check log workflow

## [0.6.26] - 2026-08-05

### 问题修复

- preserve role skills across restarts

## [0.6.25] - 2026-08-05

### 新功能

- redesign unread conversation list
- open new-task home on startup and surface unread chats

### 问题修复

- surface codex retryable gateway errors as structured error items

## [0.6.24] - 2026-08-05

### 新功能

- generate changelog notes
