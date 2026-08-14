# Changelog

记录面向用户的版本变更。每次执行 `npm run release` 时，系统会从上一个 tag 之后的提交生成初稿；如需使用人工或 Agent 润色的文案，可传入 `--notes-file <路径>`。

## [0.7.13] - 2026-08-14

### 新功能

- sync clean cordis config and match installHint

### 问题修复

- support standalone deepseek-harness-acp probe on Windows and macOS

## [0.7.12] - 2026-08-14

### 问题修复

- fix Windows test assertions for DeepSeek ACP runtime

## [0.7.11] - 2026-08-14

### 其他更新

- 常规维护与稳定性改进

## [0.7.10] - 2026-08-14

### 新功能

- support deepseek-harness-acp standalone binary and enhance runtime error handling
- fix
- overlay a thin DeepSeek Harness fork on the official ACP runtime
- add DeepSeek Harness ACP adapter

### 问题修复

- wait for electron build before app start
- drop native sandbox for DeepSeek ACP on Windows to stop koffi crash
- spawn global dsh-acp-demo through node so koffi --import sticks
- keep DeepSeek sandbox enabled and prefer managed dsh-acp-demo
- stub koffi on DeepSeek ACP spawn and export runtime diagnostics
- overlay every DeepSeek JSONL copy and disable Windows ACL sandbox
- patch DeepSeek JSONL off koffi MoveFileExW on Windows
- stop DeepSeek ACP Windows access violation on session/prompt
- hide Node SQLite ExperimentalWarning from DeepSeek ACP
- install DeepSeek ACP into a local runtime and detect a bare bin
- install DeepSeek ACP composition plugins with the demo
- pass bundled cordis.yml when starting DeepSeek ACP
- treat dsh-acp-demo as installed without --version
- force skip koffi rebuild during DeepSeek ACP install
- skip koffi source rebuild when installing DeepSeek ACP
- install DeepSeek ACP from the next dist-tag

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
