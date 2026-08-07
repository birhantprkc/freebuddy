# 主端页面感知（Main Window Presence）设计

## 目标

让 ButlerBuddy（含桌宠浮窗与主端 ButlerBuddy 对话）能感知用户在主 FreeBuddy 窗口「在哪个页面、在看哪条对话、是否正在生成」，并用这些信息回答用户提问。

用户心智：

> 我在主端看定时任务时问桌宠「这页能干什么」，它知道我在定时任务页。我在某条会话里问「帮我总结当前对话」，它知道我指的是主端当前打开的那条。

## 非目标

- 不感知预览面板、命令面板、侧边栏折叠等瞬时 UI。
- 不把对话消息正文、附件内容塞进感知快照（只元数据）。
- 不在桌宠渲染进程单独维护一份主端状态副本作为权威源。
- 不做用户级「关闭感知」开关（首版默认开启；若后续有隐私诉求再加）。
- 不实现「打开某条对话 / 打开某视图」导航工具（可另开需求，复用同一主窗口 getter 模式）。

## 已确认决策

| 决策 | 选择 |
|------|------|
| 感知范围 | **B**：导航 + 当前对话（含是否 streaming） |
| 获取方式 | **C**：每轮自动一行摘要 + 需要时用工具查完整快照 |
| 权威存储 | 主进程持有最新 `MainWindowPresence` 快照 |
| 适用 Agent | 仅 `cli-butlerbuddy`（prompt 摘要与 skill 指引） |
| 工具入口 | 扩展现有 `freebuddy_status_get` / `status_get`，增加 `mainWindow` 字段 |

## 背景

主端与桌宠是独立 `BrowserWindow`，各自一份 React/Zustand，不共享内存。现有跨窗口模式是：

- 数据变更：主进程改库 → `*:changed` 广播到所有窗口
- UI 操控：butler 工具经主窗口 getter 发 IPC（主题 / 打开设置）

**缺口**：主端 UI 状态从未上报主进程，ButlerBuddy 无法知道用户当前在哪。

已有可复用缝隙：

- `status_get` 已是只读盘点工具（agents / skills / runtimes / counts）
- butler skill 已要求在给建议前先看 status
- `cli:run` 已有 context / language 类 prompt 前缀注入模式
- 主端 `App` 已集中持有 `workspaceView`、settings、active conversation、streaming

## 数据模型

```ts
type MainWorkspaceView = "chat" | "scheduledTasks" | "workflowTeams" | "usage";

type MainSettingsTab =
  | "general"
  | "cli"
  | "skills"
  | "plugins"
  | "feed"
  | "remote"
  | "about";

interface MainWindowPresence {
  workspaceView: MainWorkspaceView;
  settingsOpen: boolean;
  settingsTab: MainSettingsTab | null; // settingsOpen=false 时为 null
  activeConversation: {
    id: string;
    title: string;
    agentId: string;
    agentName: string;
  } | null; // 新任务 / 无选中时为 null
  streaming: boolean; // 当前 active 对话是否 starting|running
  updatedAt: string; // ISO-8601
}
```

主进程模块（建议新文件 `electron/uiPresence.ts`，或放在 `butlerToolService.ts` 旁的小模块）保存：

- `latestPresence: MainWindowPresence | null`
- `setMainWindowPresence(snapshot)`
- `getMainWindowPresence()`

主窗口关闭或不曾上报时为 `null`。

## 数据流

```
App (main renderer)
  │  watch workspaceView / settings / activeId / live status
  │  throttle ~200–300ms
  ▼
preload: window.freebuddy.window.setUiPresence(snapshot)
  │  ipcRenderer.send("freebuddy:uiPresence", snapshot)
  ▼
main process: setMainWindowPresence
  │
  ├─► cli:run (agentId=cli-butlerbuddy)
  │     prepend one-line summary to prompt (or dedicated context block)
  │
  └─► status_get → { ..., mainWindow: presence | null }
        freebuddy_status_get MCP 描述同步更新
```

### 主端发布

在 `src/App.tsx`（或抽一小 hook）对感知字段 `useEffect`：

1. 组装 `MainWindowPresence`
2. 节流后调用 preload API
3. 卸载 / 窗口关闭前可不主动清空（主进程在 mainWindow `closed` 时置 `null`）

### 自动摘要（每轮）

仅当 `cli:run` 的 `agentId === cli-butlerbuddy` 且存在快照时，在 prompt 前追加一行短摘要，例如：

```
[FreeBuddy main window] view=scheduledTasks; settings=closed; conversation="每周汇报" (cli-codex-acp); streaming=false
```

要求：

- 一行、机器可读、中英字段名稳定（便于模型解析）
- 不包含消息正文
- 无快照时不加前缀（不编造）

注入位置与现有 conversation context / language 前缀同一层（`electron/cli/ipc.ts` 的 `cli:run` 路径），保证宠物端与主端 ButlerBuddy 行为一致。

### 工具完整快照

`status_get` 返回增加：

```json
{
  "mainWindow": {
    "workspaceView": "chat",
    "settingsOpen": false,
    "settingsTab": null,
    "activeConversation": {
      "id": "...",
      "title": "...",
      "agentId": "...",
      "agentName": "..."
    },
    "streaming": false,
    "updatedAt": "2026-08-07T00:00:00.000Z"
  }
}
```

`mainWindow` 可为 `null`（主窗口未就绪或已关闭）。

更新 `assets/skills/butlerbuddy/SKILL.md`：

- 回答「我在哪 / 当前对话 / 这页能干什么」类问题时，先看自动摘要；需要字段级确认时再调 `freebuddy_status_get`
- 不要臆造主端状态；`mainWindow` 为 null 时如实说明

## 组件边界

| 单元 | 职责 | 依赖 |
|------|------|------|
| `App` 发布器 | 从 UI/store 采样并上报 | preload API |
| preload `setUiPresence` | 校验形状后 send | ipcMain |
| `uiPresence` 主进程模块 | 存取最新快照；窗口关闭清空 | mainWindow lifecycle |
| `cli:run` butler 分支 | 可选一行摘要前缀 | `getMainWindowPresence` |
| `status_get` | 附带 `mainWindow` | 同上 |
| butler skill | 教模型何时用摘要 / 工具 | 文档 only |

## 错误与边界

- 畸形 payload：主进程忽略并保留上一份合法快照（或首次则保持 null）
- 主窗口关闭：`latestPresence = null`
- 桌宠自己的 active 对话 ≠ 主端 active 对话；摘要明确标注 **main window**，避免模型混淆
- streaming 只反映主端当前 active 会话，不聚合其它后台任务

## 测试

1. **契约测试**：preload / App / `status_get` / skill / `cli:run` 前缀相关字符串或导出 API 存在
2. **单元 / 行为**：`setMainWindowPresence` → `getMainWindowPresence`；畸形输入不污染；`status_get` 含 `mainWindow`
3. **手动**：主端切到定时任务 → 桌宠问「我在哪」应答对；打开某会话 → 问「当前对话是哪个」应命中标题

## 实现顺序（供后续 plan）

1. `uiPresence` 主进程模块 + preload/IPC + 类型
2. `App` 上报（节流）
3. 扩展 `status_get` + MCP 描述
4. `cli:run` butler 一行摘要
5. 更新 butler skill
6. 测试

## 后续可选（不在本 spec）

- `freebuddy_conversation_open` / `freebuddy_view_open` 导航工具
- 感知开关（设置项）
- 更细操作态（方案 C 瞬时 UI）
