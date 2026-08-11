# ButlerBuddy P0 宠物体验升级设计

## 目标

把 ButlerBuddy 从“常驻桌面的 AI 快捷入口”升级为一只：

- 能对 FreeBuddy 的真实工作状态产生可见反应；
- 有用户赋予的名字与稳定人格；
- 可以被轻量逗弄，但不会打断工作；
- 能用四个明确场景快速开始一次有宠物感的对话。

Figma 审计板：<https://www.figma.com/design/m50WRgu6X6n5FLIWJ4dl3R>

## P0 范围

1. 五种工作状态：`idle`、`working`、`celebrating`、`comforting`、`sleeping`。
2. 取名与三种人格：`gentle`、`cheerful`、`dry`。
3. 三类轻互动：单击摸头并打开聊天、双击戳一戳、拖拽落地回弹。
4. 四个快捷场景：夸夸我、总结当前对话、看看我卡在哪、给我一个下一步。
5. 设置、国际化、无障碍、匿名事件指标和跨窗口同步。

## 非目标

- 不做分享卡、GIF 导出、好友串门或双宠互动；这些属于 P2。
- 不做装扮商店、货币、抽卡或公开排行榜。
- 不做饥饿、清洁、掉心情等惩罚式养成。
- 不做真正的后台番茄钟；没有计时能力前，不展示“陪我专注 25 分钟”入口。
- 不让 LLM 决定每一个动画，也不为状态切换发起模型请求。
- 不采集提示词、对话正文、宠物名字、文件名或工作区路径作为指标。

## 体验原则

### 奖励工作，不制造待办

宠物只对用户已经发生的行为给出反馈，不要求用户回来喂食或维持数值。错过一天不会掉等级、掉心情或触发负罪文案。

### 有生命，但不打扰

- 默认没有主动弹窗、语音或新增提示音。
- 循环动作幅度小；成功和失败反应为短暂一次性动作。
- 同一状态不会重复广播或重启动画。
- 遵守系统 `prefers-reduced-motion`。

### 人格不能改变安全边界

人格只影响措辞、节奏和幽默程度，不改变确认、权限、隐私、工具白名单或破坏性操作规则。

## 状态模型

### 状态定义

| 状态 | 触发 | 视觉行为 | 退出 |
|---|---|---|---|
| `idle` | 默认；没有更高优先级状态 | 轻呼吸、偶尔眨眼 | 新状态到达 |
| `working` | 主窗口当前会话 `streaming=true` | 专注查看、轻微敲击或加载动作 | streaming 结束或被瞬时状态覆盖 |
| `celebrating` | 任一任务成功完成 | 一次跳跃/挥手，持续约 4 秒 | 回到 `working` / `sleeping` / `idle` |
| `comforting` | 任一任务失败完成 | 一次关心/递茶式动作，持续约 4 秒 | 回到 `working` / `sleeping` / `idle` |
| `sleeping` | 本地 00:00–07:00 且没有运行任务或瞬时状态 | 安静睡眠循环 | 工作开始、瞬时状态或离开时段 |

`killed` / 用户主动停止不算失败，不触发 `comforting`。

### 优先级

```text
celebrating / comforting > working > sleeping > idle
```

成功或失败状态结束时必须重新依据当前上下文求值，不能无条件回到 `idle`。例如庆祝期间又开始任务，庆祝结束后应进入 `working`。

### 事件来源

- `freebuddy:uiPresence`：复用现有 `streaming` 字段判断主窗口当前会话是否工作中。
- `notifyTaskFinished(...)`：在前台/后台判断之前，统一向 ButlerBuddy 主进程状态协调器报告成功或失败；因此普通会话、定时任务和工作流都可触发反馈。
- 主进程时钟：仅用于睡眠时段边界和瞬时状态到期，不运行常驻 60fps JS 动画循环。

## 状态权威与跨窗口同步

主进程是 ButlerBuddy 运行状态的唯一权威源。桌宠窗口与聊天窗口都是订阅者。

建议增加：

```ts
type ButlerBuddyVisualState =
  | "idle"
  | "working"
  | "celebrating"
  | "comforting"
  | "sleeping";

interface ButlerBuddyRuntimeState {
  visualState: ButlerBuddyVisualState;
  since: string;
  transientUntil?: string;
}
```

IPC：

- `butlerBuddy:getRuntimeState`
- `butlerBuddy:runtimeStateChanged`
- `butlerBuddy:reportTaskResult`

IPC payload 只允许状态枚举、时间戳和成功/失败类型；不传标题、提示词、正文或路径。

## 视觉资产契约

生产验收需要五个透明背景状态资产，不能用 emoji、文字字符或临时占位图代替。

建议路径：

```text
public/butlerbuddy/states/idle.webp
public/butlerbuddy/states/working.webp
public/butlerbuddy/states/celebrating.webp
public/butlerbuddy/states/comforting.webp
public/butlerbuddy/states/sleeping.webp
public/butlerbuddy/states/posters/*.png
```

约束：

- 统一 512×512 画布、身体锚点、视觉尺寸和透明边距。
- 循环资产无明显首尾跳变。
- 单个动画建议不超过 500 KB；五个动画合计不超过 3 MB。
- 每个动画配一张静态 poster，供减少动态模式使用。
- 状态切换不能改变 108×108 原生宠物窗口尺寸。

## 领养与人格

### 首次体验

主窗口在宠物功能首次启用、且 `profilePromptSeen=false` 时展示一次非阻塞领养对话框：

1. 输入名字，默认 `ButlerBuddy`；
2. 选择人格；
3. 即时预览一句示例文案；
4. “完成领养”或“以后再说”。

“以后再说”只标记已展示，不关闭宠物；用户可随时从通用设置重新打开。

### 人格

| 值 | 显示名 | 行为 |
|---|---|---|
| `gentle` | 治愈 | 温柔、简短、先共情再建议 |
| `cheerful` | 嘴甜 | 明亮、有活力、擅长具体夸奖 |
| `dry` | 轻吐槽 | 克制幽默，但不讽刺能力、不羞辱、不制造焦虑 |

名字规范：去除控制字符和换行，trim 后长度 1–16 个 Unicode 字符；非法值回退到 `ButlerBuddy`。

持久化设置建议：

```text
butlerbuddy.name
butlerbuddy.personality
butlerbuddy.profileConfigured
butlerbuddy.profilePromptSeen
```

### Agent 上下文

仅在 `agentId === "cli-butlerbuddy"` 时注入一行稳定上下文：

```text
[ButlerBuddy identity] name="小布"; personality=gentle
```

名字必须转义换行、引号和控制字符。该上下文只描述身份，不授予工具或权限。

## 轻互动

- 单击：保留打开/收起聊天的现有行为，同时播放一次短摸头反馈。
- 双击：播放“戳一戳”反馈；第二次点击不能造成聊天窗口反复闪烁。
- 拖拽：继续沿用主进程拖拽；超过现有阈值后不触发点击，结束时播放一次落地回弹。
- 互动反馈是本地视觉 overlay，不改变功能状态机；例如 `working` 时被戳，短反馈结束后仍是 `working`。
- 相同互动有 400ms 冷却，避免连点造成动画和 IPC 风暴。

## 四个快捷场景

真实聊天中，在没有用户消息时显示 2×2 场景入口：

1. `夸夸我`
2. `总结当前对话`
3. `看看我卡在哪`
4. `给我一个下一步`

点击后只把本地化 prompt 填入输入框并聚焦，不自动发送。用户仍可编辑或取消。

有用户消息后隐藏场景区，避免长期占用 360px 浮窗空间。后续可以从更多菜单重新进入，但不属于 P0。

## 设置

在通用设置的宠物浮窗卡中增加：

- 宠物名字；
- 人格选择；
- “重新打开领养设置”；
- 当前状态动画预览；
- 减少动态说明（跟随系统，不新增独立开关）。

原有显示开关、全局快捷键、右键菜单和拖拽行为保持不变。

## 无障碍

- 宠物按钮的 accessible name 为“打开 {name} 对话，当前状态：{state}”。
- 状态不能只靠绿色圆点或颜色表达。
- 快捷场景使用真实 `button`，支持 Tab、Enter、Space 和明显焦点。
- 领养表单字段有 label、错误说明和可恢复焦点。
- `prefers-reduced-motion: reduce` 时使用静态 poster，取消跳跃、摇晃和回弹。
- 自动状态变化不抢焦点、不触发屏幕阅读器高频播报。

## 匿名指标

仅在现有匿名使用数据开关开启时记录：

- `butler_profile_prompt_viewed`
- `butler_profile_completed`（仅 personality，不含名字）
- `butler_pet_interacted`（interaction_type）
- `butler_quick_scene_selected`（scene_id）
- `butler_chat_opened`（source=pet/shortcut/menu）
- `butler_visibility_changed`（visible）

不记录用户输入文本、宠物名字、对话标题、会话 id、文件路径或工作区。

## 成功信号

上线前先记录基线，上线后关注：

- 完成领养的用户比例；
- 每活跃用户每天的宠物互动次数；
- 从宠物打开聊天后产生首条用户消息的比例；
- 快捷场景选择后实际发送的比例；
- 开启后 7 天内隐藏宠物的比例；
- 桌宠 renderer 崩溃、CPU 与内存回归。

## P0 完成定义

- 五种状态在真实任务生命周期中按优先级稳定切换。
- 取名、人格、领养状态重启后保持，并同步到宠物、聊天和设置。
- 三类互动不破坏点击开聊、拖拽和窗口配对位置。
- 四个快捷场景可键盘操作、只填充不自动发送。
- 减少动态模式、中文和英文、浅色和深色均完成检查。
- 不新增提示词或文件信息外发；状态动画不依赖 LLM。
- macOS 与 Windows 至少完成一轮透明窗口、拖拽、双击和全局快捷键实机回归。
