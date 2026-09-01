---
title: FreeBuddy Remote Admin Protocol v1 - Implementation Plan
type: feat
date: 2026-09-01
topic: remote-admin-protocol-v1
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
repository: freebuddy-monorepo
component: protocol
depends_on: []
---

# FreeBuddy 远程管理员协议 v1——实施方案

## Goal Capsule

- **目标：** 定义 Relay、Electron 和微信小程序共同遵循的版本化 JSON 协议、schema、fixtures 和语言绑定。
- **权威来源：** `protocol/remote/v1/` 是跨语言 wire contract 的唯一权威；TypeScript/Go 类型不得各自演化。
- **主要产物：** JSON Schema、有效/无效 fixtures、签名 canonicalization 规范、错误码、TS 类型和导出。
- **不包含：** WebSocket 服务、微信登录、桌面领域实现和小程序 UI。

## Ownership Boundary

协议 Agent 可修改：

```text
protocol/remote/v1/**
packages/protocol/src/remote.ts
packages/protocol/src/remote.test.ts
packages/protocol/package.json
packages/protocol/README.md            # 如存在且需要补充
```

协议 Agent 不应实现 `services/remote-relay`、`electron/remote` 或 `apps/wechat-miniprogram` 的业务逻辑。需要在消费端验证类型时，可新增最小编译测试，但避免跨组件重构。

## Protocol Design

### 编码和兼容性

- 传输编码为 UTF-8 JSON，一条 WebSocket text frame 对应一个完整 envelope。
- `v` 为整数，v1 固定为 `1`。未知主版本返回 `unsupported_version` 并关闭连接。
- 字段使用 `camelCase`；时间使用 UTC RFC3339，推荐毫秒精度。
- ID 使用不透明字符串；新生成 ID 推荐 UUID v4 或等价的高熵 ID。
- schema 默认拒绝未知关键字段；明确标记为 extensible 的 `meta`/`details` 对象除外。
- 不把 TypeScript union 或 Go struct 当协议权威，所有实现以 schema + fixtures 为准。

### 通用 Envelope

基础字段：

```json
{
  "v": 1,
  "type": "rpc.request",
  "id": "msg_...",
  "hostId": "host_...",
  "sentAt": "2026-09-01T10:00:00.000Z",
  "expiresAt": "2026-09-01T10:00:30.000Z",
  "idempotencyKey": "idem_...",
  "seq": 42,
  "payload": {}
}
```

字段适用规则：

- `v`、`type`、`id`、`sentAt`、`payload` 始终必填。
- `hostId` 在完成身份认证后的主机定向消息中必填。
- `expiresAt` 在会改变状态的请求中必填，只读请求推荐填写。
- `idempotencyKey` 在所有写 RPC 中必填，只读 RPC 可省略。
- `seq` 只用于有序事件和恢复流，不用于客户端自行排序 RPC 响应。

### Frame 类型

v1 必须定义以下判别联合：

| `type` | 方向 | 用途 |
| --- | --- | --- |
| `challenge` | Relay → Host | 主机认证随机挑战 |
| `host.auth` | Host → Relay | 主机 ID、公钥标识、签名和客户端版本 |
| `admin.auth` | Admin → Relay | 管理员 access token 和客户端版本 |
| `auth.ok` | Relay → Client | 认证成功、连接 ID、服务端时间和限制 |
| `error` | 双向 | 协议/认证/连接级错误 |
| `rpc.request` | Admin → Host | 领域方法请求，经 Relay 转发 |
| `rpc.response` | Host → Admin | 成功结果或结构化 RPC 错误 |
| `event` | Host → Admin | 有序领域事件 |
| `resume` | Admin → Relay/Host | 请求从最后确认 seq 恢复 |
| `snapshot` | Host → Admin | 完整同步快照和新的基准 seq |
| `ping` / `pong` | 双向 | 应用层心跳和时钟观测 |
| `server.draining` | Relay → Client | 服务准备关闭，客户端应退避重连 |

### RPC Payload

`rpc.request.payload`：

```json
{
  "method": "conversation.send",
  "params": {
    "conversationId": "conv_...",
    "content": "继续实现"
  }
}
```

`rpc.response.payload`：

```json
{
  "requestId": "msg_...",
  "ok": true,
  "result": {}
}
```

失败响应使用 `ok: false` 和 `{ code, message, retryable, details? }`。`message` 面向开发/界面提示但不得包含秘密、堆栈或原始内部异常。

### v1 方法注册表

方法必须是领域级的，禁止加入 `ipc.invoke`、`shell.exec`、`fs.*` 或可传任意 channel/binary 的等价方法。

**读取**

- `host.status`
- `sync.snapshot`
- `project.list`
- `agent.list`
- `conversation.list`
- `conversation.get`
- `message.list`
- `task.list`
- `task.readLog`
- `workflow.list`
- `workflow.get`
- `delegation.list`
- `delegation.get`

**写入**

- `conversation.create`
- `conversation.rename`
- `conversation.archive`
- `conversation.delete`
- `conversation.send`
- `run.stop`
- `permission.respond`
- `authentication.respond`
- `workflow.start`
- `workflow.stop`
- `delegation.start`
- `delegation.stop`
- `terminal.create`
- `terminal.input`
- `terminal.resize`
- `terminal.snapshot`
- `terminal.close`

每个方法必须在 schema 中定义 params/result，声明 read/write、默认超时、是否可自动重试、是否需要 idempotency key 和所产生的事件。未注册方法返回 `method_not_allowed`。

### 领域事件

事件建议采用 `{ name, data }`，至少覆盖：

- `host.status.changed`
- `conversation.created|updated|deleted`
- `message.created|updated`
- `run.started|stream|finished|failed|stopped`
- `permission.requested|resolved`
- `authentication.requested|resolved`
- `task.updated|log.appended`
- `workflow.updated`
- `delegation.updated`
- `terminal.opened|output|closed`

`run.stream` 的 `data.item` 采用 `packages/cli-stream` 可表达的公共 `CliStreamItem` 子集，并在 schema 中逐项枚举；不得直接透传未经约束的内部对象。

### 恢复语义

- 主机为每个管理员事件流分配严格递增 `seq`。
- 管理员持久记录已完整处理的 `lastSeq`，重连发送 `resumeFrom`。
- 若主机 ring buffer 仍包含下一条事件，则按序重放并继续实时流。
- 若游标太旧、主机重启或序列不连续，返回 `snapshot`；snapshot 包含 `baseSeq`，后续事件必须大于它。
- Relay 只路由 resume，不持久化业务事件。
- RPC response 用 `requestId` 关联，不依赖事件 seq。

### 幂等和时效

- 所有写请求必须含不少于 128 bit 熵的 `idempotencyKey`。
- 桌面端按管理员/主机/方法/idempotency key 记忆有限时间内的执行结果，重复请求返回原结果或 `duplicate_request`，不得再次执行。
- `expiresAt <= serverTime` 的请求返回 `request_expired`，不得执行。
- 传输断开不代表写请求失败；客户端先恢复/查询状态，不能直接生成新幂等键重试。
- 推荐默认读请求超时 15 秒，写请求 30 秒，长运行通过事件跟踪而不是长期占用 RPC。

### 限制

- 单 frame 最大 256 KiB。
- 文本/终端流单 chunk 最大 32 KiB；更大内容必须分片。
- 列表使用 cursor 分页，不能依赖无限数组。
- ID、method、event name、错误 message 均设置明确长度上限。
- 二进制内容不进 v1 JSON；文件预览/上传留给后续独立设计。

### 错误码

至少定义：

- `invalid_request`
- `unsupported_version`
- `unauthorized`
- `forbidden`
- `host_offline`
- `method_not_allowed`
- `request_expired`
- `duplicate_request`
- `rpc_timeout`
- `backpressure`
- `conflict`
- `not_found`
- `internal_error`

每个错误码必须声明 HTTP/WS 场景、`retryable` 默认值和客户端建议动作。内部异常一律映射为稳定错误，不传堆栈。

## Host Authentication Signature

主机使用 Ed25519。Relay 发送随机 challenge 后，主机对 canonical payload 签名：

```text
freebuddy-remote-host-auth-v1\n
hostId:<hostId>\n
challenge:<base64url challenge>\n
connectionId:<connectionId>\n
issuedAt:<RFC3339 UTC>\n
```

规范必须明确：

- 固定字段顺序、固定 `\n`、UTF-8、禁止额外空白。
- challenge 至少 32 个随机字节、base64url 无 padding。
- challenge 一次性且短时有效，默认 60 秒。
- Relay 校验 issuedAt 偏差、connectionId、challenge 未使用和签名。
- fixtures 包含固定测试私钥/公钥、canonical bytes、签名、篡改失败用例；测试密钥只能用于 fixtures。

## Files to Add

建议结构：

```text
protocol/remote/v1/
├── README.md
├── envelope.schema.json
├── auth.schema.json
├── rpc.schema.json
├── events.schema.json
├── methods/
│   ├── conversation.schema.json
│   ├── run.schema.json
│   ├── decision.schema.json
│   ├── workflow.schema.json
│   └── terminal.schema.json
└── fixtures/
    ├── valid/
    ├── invalid/
    └── signing/
```

若仓库没有统一 JSON Schema 校验库，协议 Agent 应选择轻量、维护活跃、支持当前 Node 版本的校验方式；新增依赖前说明原因。第一期允许手写 TS/Go binding，以 fixtures 保证一致性；自动代码生成留待协议稳定后决定。

## Implementation Units

### P1：Schema 骨架和基础 envelope

- 添加目录、README、versioning 规则和 envelope 判别。
- 添加 frame 大小、字符串长度和时间格式约束。
- 添加基础 valid/invalid fixtures。

### P2：RPC 方法和事件

- 为每个 v1 方法定义 params/result。
- 定义共享分页、ID、项目引用、会话引用和结构化错误。
- 定义流式 item 和 snapshot。

### P3：认证和签名

- 定义 challenge、host.auth、admin.auth、auth.ok。
- 定义 canonical signing 文档和 golden fixtures。

### P4：TypeScript 绑定

- 在 `packages/protocol/src/remote.ts` 添加判别联合、method map、类型守卫/解析入口。
- 在 `packages/protocol/package.json` 添加 `./remote` export。
- 保证小程序构建不依赖 Node-only API；纯类型和纯函数可直接消费。

### P5：兼容性测试

- TS 测试遍历所有 valid/invalid fixtures。
- 为 Go Agent 写清如何从相同路径加载 fixtures。
- 加入 schema 与方法注册表的一致性测试，防止方法只存在于类型中。

## Verification

- 每个 frame 类型至少一个 valid fixture。
- 每个重要约束至少一个 invalid fixture：未知版本、缺少幂等键、过期、过大 chunk、非法方法、未知字段。
- 签名 fixture 在 Node 和 Go 中得到相同 canonical bytes 和校验结果。
- `@freebuddy/protocol/remote` 能被 Electron 和小程序 TypeScript 配置编译。
- 不引入 Node-only 全局到小程序消费路径。
- 根项目 lint/typecheck/test 通过。

## Definition of Done

- Relay、Desktop、小程序 Agent 无需猜测即可实现每种 frame、方法、错误和恢复流程。
- schema、fixtures、TS 类型和 README 对同一字段的必填性/语义一致。
- 没有通用 IPC、通用 shell、任意 cwd/env 或未界定的透传载荷。
- Go 与 TypeScript 都能运行共享 fixtures 的合同测试。
- 协议变更政策明确：v1 兼容新增和 v2 breaking change 的边界有文档。

## Handoff Prompt

> 你负责远程控制协议 v1，只修改本方案 Ownership Boundary 中的文件。先完成 schema、fixtures 和签名规范，再添加 TypeScript 导出。协议必须是领域级 JSON RPC，禁止通用 IPC/shell。交付时列出已冻结的方法表、fixture 测试命令、所有仍未解决的协议问题；不要实现 Relay、Electron 连接器或小程序 UI。
