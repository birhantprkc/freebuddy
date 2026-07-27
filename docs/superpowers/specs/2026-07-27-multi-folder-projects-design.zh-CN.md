# 多文件夹项目设计

## 目标

为 FreeBuddy 侧栏「项目」增加可创建、可编辑的项目实体，使 **一个项目可挂载多个本地文件夹**，并让 Agent 通过 FreeBuddy 提供的 MCP 文件桥在这些文件夹内 **可读可写**。

用户心智从「一个 cwd = 一个侧栏项目」升级为：

> 先配置一个项目（名称 + 多个 Source folders + Primary），再在该项目下开任务。Agent 默认落在 Primary，但可通过 MCP 访问项目内全部文件夹。

## 非目标

- 不实现业务空间跨仓认领、契约草案、多 Agent 分仓（见既有 `2026-06-28-business-workspace-multi-repo-agents` 设计；本功能为其轻量前置，不合并模型）。
- 不写磁盘 `.workspace` / `.code-workspace` 文件驱动配置。
- 不与 `remote.workspaceRoots` 双向同步（远程沙箱白名单与侧栏项目隔离）。
- 不向 prompt / 系统上下文注入文件夹列表来「告知」Agent。
- 不按 CLI Adapter 做原生 multi-root 特例配置。
- 不在第一版改 Draft / Browser 等现有单 cwd MCP 的多根语义。

## 背景与现状

- 侧栏「项目」由 `groupConversationsByProject` 按会话 `cwd` **派生**，无独立 Project 表。
- 「项目」标题旁无区块级「添加项目」入口；项目行 `+` 仅在同 cwd 下新建任务。
- Agent 启动经 ACP `session/new|resume|load`，协议只支持 **单个** `cwd`。
- FreeBuddy 侧路径相关能力（文件搜索、Draft、附件等）目前也以单 `cwd` 为主。

## 产品决策（已确认）

| 决策点 | 选择 |
|--------|------|
| 多文件夹语义 | Agent 多根可读写（非仅侧栏分组） |
| 访问强度 | 项目内全部 folders 可读可写；默认 cwd = Primary |
| 与旧分组关系 | **统一升级**为项目实体；旧 cwd 分组可迁移并可编辑追加文件夹 |
| Agent 获知多根方式 | **仅 MCP 文件桥**（不做 prompt 注入、不做 Adapter 原生多根） |
| 删项目 | 删除 Project 记录；**保留会话**，清除 `projectId` |

## 架构

### 数据模型

SQLite（与会话同库）新增：

```ts
Project {
  id: string
  name: string
  folders: string[]       // 绝对路径，至少 1 个；SQLite 存 JSON TEXT
  primaryPath: string     // 必须 ∈ folders
  createdAt: string
  updatedAt: string
}
```

`Conversation` 变更：

- 新增可选 `projectId`
- 保留 `cwd`：默认 = 所属项目的 `primaryPath`（兼容现有 ACP / Draft / 终端默认目录）
- 侧栏归属以 `projectId` 为准

置顶：`pinnedProjectsStore` 的 key 从 cwd-key 改为 `projectId`（迁移时映射）。

### 运行时传递

```
Project.folders
  → 解析为 CliRunArgs.workspaceRoots
  → registerWorkspaceFsMcp({ roots, primary })
  → 并入 ACP session/new|resume|load 的 mcpServers
  → CliRunArgs.cwd = primaryPath（仅单 cwd 给 ACP）
```

无 `projectId` 时：若有 `cwd`，则 `workspaceRoots = [cwd]`；否则为空。  
FS MCP 注册策略：**仅当 `workspaceRoots.length > 1` 时注册**（单根仍靠 Agent 原生 cwd 工具，避免多余 MCP）；多根时必须注册。

### MCP 文件桥（第一版）

名称建议：`freebuddy-workspace-fs`（最终以实现时注册名为准）。

能力：

- `list` / `read` / `write`（若现有工具链需要可含 `mkdir`）
- 相对路径相对 **Primary** 解析
- 绝对路径必须落在任一 `workspaceRoots` 内，否则拒绝
- 不依赖各 Adapter 沙箱放行 cwd 外路径

FreeBuddy 本地能力同步使用同一 `workspaceRoots`：

- 工作区文件搜索 / `@` 提及
- 附件路径校验（本地场景）

**不改**：Draft、Browser、Skills 等现有 MCP 的单 cwd 绑定（第一版）。

### UI

#### 侧栏

- 「项目」标题右侧增加 **`+`**：打开「新建项目」表单。
- 列表按 `Project` 展示；其下挂该 `projectId` 的会话。
- 项目行菜单：编辑项目、置顶、在 Finder 打开 Primary、删除项目。
- 项目行会话 `+`：新建任务，`cwd` = Primary，运行时带上该项目全部 `workspaceRoots`。

#### 新建 / 编辑项目弹窗

对齐参考 UI（Cursor 式 Edit Project）：

- 标题：新建项目 / 编辑项目
- 名称输入（文件夹图标 + 文本）
- Source folders 列表：路径、Primary 徽章、移除 `x`
- 「添加文件夹」：系统目录选择器；重复路径忽略；第一项自动 Primary
- 移除 Primary 时：列表第一项升为 Primary
- 页脚：删除项目（仅编辑）、取消、保存
- 保存校验：名称非空、≥1 文件夹、`primaryPath ∈ folders`

## 迁移

启动时一次性：

1. 若无 `projects` 表 / 迁移版本标记 → 建表并执行迁移。
2. 按现有 `projectKeyFromCwd` 聚合同 cwd 会话。
3. 每组创建 `Project { name: 末级目录名, folders: [cwd], primaryPath: cwd }`。
4. 回填会话 `projectId`。
5. 置顶 key：cwd-key → `projectId`。
6. 写入迁移版本标记，避免重复执行。

## 错误处理

| 场景 | 行为 |
|------|------|
| 名称为空 / 无文件夹 | 禁用保存或 toast |
| 添加重复路径 | 忽略或轻提示 |
| Primary 被移除 | 自动指定列表第一项 |
| 文件夹路径失效 | 侧栏可告警；运行时跳过该 root 并提示 |
| MCP 路径越界 | 工具返回错误，不执行读写 |
| 删项目 | 删 Project；会话保留并清 `projectId` |
| 文件夹从项目移除 | 已在跑会话本轮不强制踢出；下次启动/新消息按最新 folders |

## 测试范围

- 新建（单/多文件夹）、设 Primary、编辑、删除项目（会话仍在）
- 迁移：旧 cwd 分组 → 项目实体；置顶不丢
- 同项目多会话侧栏归组正确
- MCP：非 Primary 路径可读写；项目外路径拒绝
- 文件搜索 / `@` 覆盖多 root
- 无项目的「最近」会话行为不变

## 与业务空间设计的关系

本功能是侧栏 **本地多文件夹项目** 的最小可用形态。  
`Business Workspace` 设计面向跨端认领与多 Agent 协同，模型更重。第一版 **不** 引入 Surface / Team 绑定；若未来升级，可将 `Project.folders` 演进为 Surface 列表，而不推翻侧栏项目 UX。

## 实现触点（指引，非排期）

| 区域 | 预期改动 |
|------|----------|
| `electron/cli/db.ts` | `projects` 表、会话 `projectId`、迁移 |
| IPC / client | Project CRUD |
| `conversationProjectGrouping.ts` / `ConversationList.tsx` | 按 Project 列表；标题旁 `+` |
| 新组件 | `ProjectFormModal`（新建/编辑） |
| `pinnedProjectsStore.ts` | key = projectId |
| `CliRunArgs` / `acpRuntime.ts` | `workspaceRoots` + 注册 FS MCP |
| 文件搜索等 | 多 root 查询 |

## 成功标准

1. 用户可从侧栏「项目」旁 `+` 创建含多个文件夹的项目，并指定 Primary。
2. 旧单文件夹会话组迁移为可编辑项目，可追加文件夹。
3. 该项目下任务运行时，Agent 仅通过 FreeBuddy FS MCP 读写全部挂载文件夹；越界失败。
4. 删除项目不删除历史会话。
