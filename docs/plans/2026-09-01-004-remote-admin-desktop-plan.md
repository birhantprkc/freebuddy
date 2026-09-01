---
title: FreeBuddy Desktop Remote Admin Host - Implementation Plan
type: feat
date: 2026-09-01
topic: remote-admin-desktop-host
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
repository: freebuddy-monorepo
component: electron
depends_on:
  - remote-admin-protocol-v1
  - remote-admin-relay-server-poc
---

# FreeBuddy 桌面端远程管理员 Host——实施方案

## Goal Capsule

- **目标：** 让 Electron 主进程主动连接 Go Relay，把经过认证的唯一管理员请求转换为安全、可审计的 FreeBuddy 领域操作，并持续发布事件。
- **核心要求：** 远程发送消息和 Agent 运行不能依赖可见 renderer、活动窗口或现有 WebUI 连接。
- **身份语义：** Relay 管理员始终映射为本机 owner/admin，使用原有工作区；不得使用 Relay 传入的 userId，也不得创建 managed clone。
- **安全边界：** 只开放显式的移动端领域方法注册表，不开放原始 Electron IPC、任意 cwd/binary/env 或通用 shell。
- **依赖：** 消费 [协议方案](./2026-09-01-002-remote-admin-protocol-plan.md)，并用 Relay POC 验证连接状态机。

## Existing-Code Constraints

实现前必须理解并保留以下现有行为：

- `electron/webUIServer.ts` 已提供本地 WebUI HTTP/WS bridge。
- `electron/eventBus.ts` 当前只有一个 `activeBroadcaster`；WebUI 已占用它，Relay 不能再覆盖同一个 broadcaster。
- `electron/cli/ipcSend.ts` 同时向 renderer 和 event bus 发事件，是可复用的事件出口。
- `electron/invokeRegistry.ts` / `localInvoke` 接受 `LocalInvokeContext` 并应用现有 remote policy，但它是单次 IPC 调度器，不足以表达完整远程会话运行。
- `electron/cli/callerContext.ts` 提供 `runAsCaller(userId, fn, isAdmin)`，应作为固定 owner/admin 上下文入口。
- `electron/cli/runtime.ts` 的 `cliRun` 当前要求 `WebContents`；`electron/cli/ipc.ts` 还要求 sender window。
- renderer 的 `src/store/conversationStore.ts` 和 `src/store/conversationHandlers.ts` 当前负责创建消息、解析流、累积 assistant 内容和最终持久化。只调用 `cli:run` 会遗漏这些关键生命周期。
- `electron/cli/store.ts` 已使用 Electron `safeStorage` 保存秘密；主机私钥应遵循同类模式。

因此，本功能不是“再接一个 WebSocket 后把 channel 转发给 `localInvoke`”。必须先解决事件多订阅和 headless turn orchestration。

## Ownership Boundary

Desktop Agent 主要负责：

```text
electron/remote/**
electron/eventBus.ts
electron/cli/ipcSend.ts
electron/cli/runtime.ts                 # 仅为 host-neutral event sink 重构
electron/cli/ipc.ts                     # 复用新 coordinator 时修改
electron/shared/remoteAdminMethodPolicy.ts
electron/main.ts
electron/preload.ts                     # 仅设置页所需最小 API
src/components/Settings/RemoteTab.tsx   # 或现有 Settings 等价入口
src/types/freebuddy.d.ts
src/locales/**                           # 对应设置文案
packages/cli-stream/**                   # 提取纯流解析/累积逻辑
```

谨慎修改：

```text
src/store/conversationStore.ts
src/store/conversationHandlers.ts
```

修改目的只能是复用新的共享 coordinator/stream accumulator，不能在同一 PR 顺带重写 UI 状态架构。协议文件由协议 Agent 所有。

## Architecture

```text
Relay WSS
   │ protocol v1
   ▼
RelayClient ── connection/auth/backoff
   │
   ├── SnapshotService ── host/projects/conversations/runs/decisions
   ├── AdminDispatcher ── explicit method registry + validation
   │        │
   │        └── runAsCaller(ownerId, ..., true)
   │
   └── RemoteTurnCoordinator ── message lifecycle + CLI runtime + persistence
                                  │
EventHub(multi-subscriber) ◄───────┘
   ├── existing WebUI broadcaster
   └── Relay event publisher + replay ring buffer
```

## Non-Negotiable Refactor 1: Multi-Subscriber Event Hub

### Problem

`electron/eventBus.ts` 的单个 `activeBroadcaster` 会导致后注册的 Relay 或 WebUI 覆盖前者。直接调用 `setEventBroadcaster` 会造成现有远程 WebUI 回归或 Relay 静默丢事件。

### Required Change

将 API 改为多订阅模型，示意：

```ts
type EventBroadcaster = (channel: string, payload: unknown) => void

export function subscribeEventBroadcaster(
  broadcaster: EventBroadcaster,
): () => void

export function broadcastEvent(channel: string, payload: unknown): void
```

要求：

- 返回幂等 unsubscribe，调用后不再接收。
- 一个 listener 抛错不能阻止其他 listener。
- 注册/注销期间广播行为确定、无重复。
- 保留兼容层或同一 PR 迁移现有 `webUIServer.ts`。
- listener 数量和清理可测试，应用退出/服务关闭不泄漏。
- 不在 EventHub 内做管理员授权；它只分发内部事件，Relay publisher 再做领域映射和过滤。

### Exit Gate

现有 WebUI 测试通过；同时注册 WebUI 和 Relay 测试 listener 时两者收到同一事件，移除任一方不影响另一方。

## Non-Negotiable Refactor 2: Headless RemoteTurnCoordinator

### Problem

完整的一次会话发送并不等同于 `cliRun`：renderer 目前还负责用户消息/assistant placeholder 创建、Agent 与配置解析、session resume/history、流解析、权限/认证等待、最终内容和状态持久化。远程请求到达时 renderer 可能未加载、窗口可能隐藏、小程序也可能中途掉线。

### Required Behavior

在 main process 建立可复用的 `RemoteTurnCoordinator`（或更通用的 `ConversationTurnService`），完整拥有一次 turn 的服务端生命周期：

1. 校验 conversation/project/agent 归属和当前运行状态。
2. 在本地 owner/admin 上下文中创建并持久化 user message。
3. 创建 assistant placeholder / run record，并分配稳定 run ID。
4. 在主进程解析 Agent adapter、配置、history 和 resume session。
5. 以 host-neutral event sink 启动 CLI runtime，不要求活动 `BrowserWindow`/`WebContents`。
6. 使用从 renderer 提取的纯 `CliStreamItem` parser/accumulator 处理文本、thinking、tool、command、file edit、usage、error、done。
7. 通过 EventHub 发布领域事件；renderer 存在时仍可同步展示。
8. 维护 pending permission/authentication decision 并允许远程响应。
9. 无论小程序是否在线，都在 desktop host 上完成最终消息、run status、session ID 和错误状态持久化。
10. 支持 stop、应用退出清理、崩溃后的 interrupted 状态恢复。

### Shared Logic Strategy

- 把纯解析/累积逻辑移到 `packages/cli-stream`，禁止 renderer 和 main 各复制一套 switch。
- 将需要 Electron/数据库/Agent registry 的 orchestration 留在 main process。
- 逐步让本地 renderer 发送也调用同一个 service，避免本地和远程出现两个并行 coordinator 争夺同一会话。
- 若一次迁移风险过高，第一 PR 可只添加共享 parser 和 headless coordinator，但必须用会话级 mutex/active-run registry 防止两条路径同时运行同一会话，并记录后续统一任务。

### Runtime Event Sink

将 `cliRun(webContents, args, onEvent?)` 重构为核心 runtime 接受明确的 event sink，例如：

```ts
type CliEventSink = (channel: string, payload: unknown) => void
```

renderer adapter 可继续调用 `safeSendToWebContents`；headless adapter 只广播/持久化。不要伪造 WebContents，不要因为无 sender window 而绕过现有验证。

### Exit Gate

自动化测试必须证明：没有任何 BrowserWindow、窗口隐藏、远程 client 断线三种情况下，turn 均正确完成并持久化；恢复后 snapshot 能看到最终消息和 run 状态。

## RelayClient

### State Machine

显式状态：

```text
disabled
disconnected
pairing
connecting
authenticating
online
backoff
stopped
```

转换要求：

- 默认 disabled，用户主动启用后才连接云中转。
- 网络错误使用指数退避 + jitter，并设置最大间隔。
- 成功在线一段稳定时间后重置 backoff。
- 认证失败、host revoked、协议版本不兼容不应无限快速重试；进入可见错误状态等待用户处理。
- 睡眠/唤醒、网络恢复、应用退出均有明确转换和资源清理。
- 收到 `server.draining` 后关闭并使用退避重连。

### Transport Rules

- 只允许 `wss://` 生产 endpoint；localhost/dev 可通过显式开发配置允许 `ws://`。
- 限制 frame 大小、解析时间、send queue、pending requests 和事件 ring buffer。
- 响应 ping/pong，验证 server time，拒绝明显过期请求。
- WSS 证书错误默认 fail closed，不加入“忽略证书”生产开关。
- RelayClient 只负责 transport；不得直接调用业务 store。

## Host Credentials and Pairing

建议文件：

```text
electron/remote/credentials.ts
electron/remote/pairing.ts
```

要求：

- 第一次启用时生成随机 `hostId` 和 Ed25519 keypair。
- private key 用 Electron `safeStorage` 加密后保存；不可用时停止启用并提示，不以明文降级。
- public key、hostId、display name 可作为非秘密元数据保存。
- challenge 按协议 canonical bytes 签名，使用 golden fixtures 测试。
- 设置页生成一次性 QR/短码，显示到期倒计时和取消入口。
- 完成配对后立即清理本地临时 pairing secret。
- revoke/disable 清理 Relay session、关闭终端和当前连接；是否保留主机密钥应有明确行为。推荐“停用”保留密钥，“解除配对”删除密钥并要求重新配对。

## AdminDispatcher

### Explicit Registry

建立移动管理员专用注册表：

```ts
type RemoteAdminHandler<M extends RemoteMethod> = (
  context: TrustedRemoteAdminContext,
  params: RemoteMethodParams[M],
) => Promise<RemoteMethodResult[M]>
```

`TrustedRemoteAdminContext` 只由本机生成，至少含 owner user ID、`isAdmin: true`、host ID、request ID、deadline 和 idempotency key。Relay payload 无法覆盖这些字段。

每个 method descriptor 声明：

- read/write 分类。
- 参数 schema/运行时验证。
- 默认 timeout。
- 是否需要 active host/project/conversation。
- 幂等结果存储策略。
- 审计 action 名称（只记元数据）。

### Identity Mapping

- 从本地用户 store 找到 owner/admin；找不到时 fail closed 并在设置页显示修复提示。
- 使用 `runAsCaller(owner.id, () => ..., true)` 包住领域操作。
- 忽略/拒绝 payload 中的 `userId`、`isAdmin`、managed workspace 等越权字段。
- owner/admin 使用原项目与原工作区；不调用 remote user workspace clone 逻辑。

### Validation

- 对 projectId/conversationId/runId 做本地查找和关系校验。
- 远程方法只接收稳定资源 ID，不接收任意 cwd 路径。
- 写请求检查 `expiresAt` 和 idempotency key，再进入副作用。
- 用会话/运行锁防止重复 send、冲突 rename/delete 和重复 decision。
- 已完成 idempotency 请求返回稳定原结果；in-flight 重复请求加入同一结果或返回明确 conflict，不再次执行。
- 内部错误映射协议错误码，不把 stack、路径中的敏感信息或 secret 发给 Relay。

### Existing localInvoke Reuse

简单、已正确受策略保护的领域调用可以在 handler 内复用 `localInvoke`，但必须：

- handler 仍是显式方法映射，而不是把远端 `method` 当 channel。
- 本地构造 admin context。
- 对参数和资源关系做额外校验。
- 复杂 `conversation.send`、run/decision/terminal 必须走专用 service，不能只调用单个 raw IPC。

## Snapshot and Event Mapping

### Snapshot

`sync.snapshot` 应返回有界、可分页/可裁剪的数据：

- host status、app/protocol version、server time。
- project/agent 摘要。
- 最近会话及其游标，不默认发送全部历史。
- active runs、pending permission/auth decisions。
- active workflow/delegation/task 摘要。
- active terminal session 元数据（不默认返回无限输出）。
- `baseSeq`。

消息历史由 `message.list` cursor 分页读取。snapshot 不能把所有工作区和日志一次塞入单 frame。

### Event Mapping

- EventHub 内部 channel 经过显式 mapper 变为 protocol domain event。
- 复用现有 audience/ownership 分类；没有安全分类的内部事件默认不发布。
- 事件映射时只发送小程序需要的字段，避免把内部配置、系统路径、环境变量和凭证对象透传。
- 生成单调 seq，放入有界 ring buffer：建议 2048 条或 10 分钟，以先达到者为准。
- chunk 超过 32 KiB 时分片，并确保重放顺序一致。
- ring buffer 只在本机内存中；必要时可把最新 base state 从数据库重建，不持久化完整终端/聊天事件副本。

## Remote Terminal

终端是高风险能力，必须晚于会话控制和恢复机制实施。

### API Boundary

- `terminal.create` 必须接收 `projectId`，由本地解析项目根目录。
- 客户端不能传任意启动 binary、cwd 或完整 env。
- shell 使用 FreeBuddy 当前可信终端配置/平台默认，环境变量使用既有净化策略。
- `terminal.input` 只对当前管理员拥有且仍 active 的 session 有效。
- `terminal.resize` 限制合理 rows/cols。
- `terminal.snapshot` 返回有界最近输出和当前 seq。
- `terminal.close` 幂等。

### Lifecycle and Limits

- 使用仓库已有 `node-pty` 能力，不另起系统服务。
- 每主机/项目设并发上限；空闲 TTL 和最大生命周期可配置。
- 输出采用 bounded ring buffer，持续慢消费触发截断标记而不是无限内存。
- 远程总开关关闭、解除配对、应用退出时关闭所有远程 terminal。
- 桌面设置页显示 active terminal 数和一键全部关闭。
- 一期明确展示这是命令行控制；不声称是桌面屏幕远控。

## Settings UI

保留现有 LAN WebUI 配置，在 Remote/远程设置中新增独立“云中转”区域：

- 启用开关，默认关闭。
- Relay endpoint（生产构建可由受信配置预设；自定义时提示安全风险）。
- 状态：未配对、配对中、连接中、在线、退避、认证失败、已撤销、版本不兼容。
- 主机名称、host ID 缩略显示、最后在线时间。
- 生成/刷新/取消配对二维码。
- 已绑定管理员设备/会话摘要和撤销入口。
- 当前 active runs/terminal 指示。
- “立即断开”“全部关闭远程终端”“解除配对”。

preload 只暴露这些设置所需的狭窄 API，不把 RelayClient 或 credentials 对象暴露给 renderer。

## Suggested Files

```text
electron/remote/
├── index.ts
├── relayClient.ts
├── relayClient.test.ts
├── credentials.ts
├── pairing.ts
├── adminDispatcher.ts
├── adminDispatcher.test.ts
├── methodRegistry.ts
├── eventPublisher.ts
├── eventRingBuffer.ts
├── snapshotService.ts
├── turnCoordinator.ts
├── turnCoordinator.test.ts
├── idempotencyStore.ts
└── terminalService.ts
```

实际命名服从仓库约定，但职责必须保持分离，避免一个 `remote.ts` 同时承担 transport、auth、dispatch 和 orchestration。

## Implementation Units

### D1：事件总线多订阅

- 重构 `eventBus`，迁移 WebUI，补 listener 隔离/清理测试。
- 不接 Relay 业务，先单独合并以降低回归风险。

### D2：共享 CLI stream 处理

- 盘点 renderer handlers 的纯逻辑和 UI-only 逻辑。
- 把纯 parser/accumulator 移到 `packages/cli-stream`。
- 用现有流 fixtures/测试证明迁移前后最终消息一致。

### D3：Host credentials + RelayClient POC

- 实现 safeStorage、host ID/key、challenge signing。
- 实现状态机、心跳、backoff、frame 限制。
- 连接 Relay dev-token POC；此阶段只发布 host status。

### D4：只读 Dispatcher + Snapshot

- 建立 explicit registry、owner/admin mapping、资源验证。
- 实现 host/project/agent/conversation/message/task/workflow/delegation 读取。
- 实现 event mapper、seq、ring buffer、resume/snapshot fallback。

### D5：Headless Turn Coordinator

- 提取 host-neutral CLI runtime/event sink。
- 完整实现 message/run/persistence/stop/error 生命周期。
- 接入 pending permission/authentication decision。
- 在无窗口/断开 client 测试中验证。

### D6：写操作和幂等

- 会话 create/rename/archive/delete、send、run.stop。
- 权限/认证响应、工作流/委托动作。
- 请求 TTL、idempotency store、冲突锁和稳定错误映射。

### D7：设置、配对和撤销

- 实现设置 UI、二维码、状态、断开/撤销/紧急关闭。
- 保证默认关闭和升级后不自动暴露远程能力。

### D8：受约束终端

- 独立 terminal service、limits、events、snapshot 和设置指示。
- 完成项目范围/环境净化/生命周期测试后才默认展示入口。

## Test Plan

### Unit

- EventHub 多 listener、异常隔离、unsubscribe。
- RelayClient 所有状态转换、退避 jitter、认证失败、draining。
- safeStorage 不可用时 fail closed；签名 golden fixtures。
- method registry 未知方法/非法参数/伪造 userId/cwd/binary 拒绝。
- idempotency：完成、in-flight、过期、不同管理员/host 隔离。
- event seq/ring buffer 边界、过旧 resume 触发 snapshot。
- terminal 项目约束、resize 限制、TTL、输出截断和总开关。

### Integration

- 与本地 Relay POC 建连、challenge auth、断线重连。
- 现有 WebUI 与 Relay 同时订阅，二者均接收且互不覆盖。
- 无 BrowserWindow 完成 conversation.send 和最终持久化。
- 小程序/模拟 admin 在运行中断连，desktop 继续完成，重连恢复。
- 权限 request → remote respond → run continue；重复 respond 不重复执行。
- host sleep/wake 后状态恢复，无重复 active run。
- 解除配对即时关闭 WSS 和终端，旧 host/session 无法继续。

### Regression

- 现有 `remoteChannelPolicy`、`wsChannelPolicy`、WebUI auth 和 remote workspace 测试保持通过。
- 本地 renderer 发送、CLI streaming、conversation persistence 行为不变。
- 本地 owner/admin 以外的现有远程用户隔离不被放宽。
- 应用启动、关闭和没有配置 Relay 时无额外报错/网络连接。

## Acceptance Criteria

- 默认安装不连接云服务；用户启用并配对后才建立 WSS。
- Relay 传入任意 userId/admin/channel/cwd/binary 均无法改变本机身份或执行边界。
- 只读数据、实时事件、resume 和 snapshot 在窗口隐藏时工作。
- 远程发送消息在没有 renderer 时完整创建、运行、流式发布和持久化。
- client 断线不终止 host run，也不导致自动重复执行写请求。
- 现有 WebUI 不被新 Relay broadcaster 覆盖。
- 终端只能从 projectId 推导 cwd，有限流、TTL、截断、可见状态和紧急关闭。
- 日志不包含 token、private key、pairing secret、消息正文或终端内容。

## Handoff Prompt

> 你负责 FreeBuddy Electron 远程管理员 Host。请先阅读总控、协议和本方案。第一步单独把 `electron/eventBus.ts` 改为可取消的多订阅并保证 WebUI 回归；第二步提取可在 main/renderer 共享的 CLI stream 累积逻辑。不要把 Relay 请求简单转成原始 IPC。必须实现不依赖 BrowserWindow/WebContents 的 turn coordinator，由桌面端完成消息、运行、授权和最终持久化。所有请求固定映射为本机 owner/admin、操作原工作区，拒绝远端 userId/cwd/binary/env。交付时附无窗口、断线恢复、幂等、WebUI 共存和终端约束测试结果。
