# 自组织委派团队（DelegationTeam）设计

> **Superseded（协议/运行时）**：同步阻塞 `delegate()` 与「入口 turn 卡在工具调用里」的模型已被
> [`2026-08-12-delegation-bus-design.zh-CN.md`](./2026-08-12-delegation-bus-design.zh-CN.md)
> 的完整异步编排总线（pending 收据 + park/wake + 跟进走总线）取代。下文产品模型（花名册、policy、与 WorkflowTeam 并存）仍有效；凡描述「MCP 同步 await 子 agent / 结果作为本次 tool result 返回」的段落以新文为准。

## 目标

为 FreeBuddy 增加一种新的团队模式：**DelegationTeam（自组织委派团队）**。用户只配置一个入口 agent 和一组花名册（各自带能力描述），不预定义工作流。Run 启动后由 agent 在运行时自主发现合适队友、递归委派子任务、汇总结果。

借鉴 CodexLoom 的核心哲学——"agent 自动发现合作 agent 来委派任务"——但落到 FreeBuddy 的多运行时、单 Run、任务交付导向的现实上：

- **发现**：agent 通过花名册（每个队友的 `capability` 能力描述）知道该找谁，`capability` 即路由契约（CodexLoom Profile 的 Domain/Scope 等价物）。
- **委派**：agent 调用 MCP 工具 `delegate(teammate_id, task)`，编排总线异步 enqueue 子 agent，立刻返回 pending 收据；结果经 park/wake 或 `check_delegate_result` 回到调用方（见 2026-08-12 bus 设计）。
- **智能在 Skill**：内置 Delegation Skill 教会每个 agent 何时/如何委派（CodexLoom `loom-communication` 的角色搬运）。

与现有 WorkflowTeam（静态预编译计划）**并存**，靠团队 `kind` 区分；旧团队保留，零破坏。

## 背景

当前 FreeBuddy 的 WorkflowTeam 是静态预编译模型：模板在 Run 前拍平成顺序 phase，step 间的上下文流（`consumes`）提前接好线；agent 之间只有单向 prompt 上下文拼接，无直接调用能力；agent 是临时 CLI 调用，跨 Run 无记忆。

CodexLoom 走的是另一极端：长生命周期 Domain Agent + 共享 CodexHost + `loom` CLI 消息总线 + Profile 治理组织。它的"自动发现+委派"不是魔法路由，而是三层组合——读 Team 投影找领域负责人 → 调 `loom msg` 发请求 → 内置 Skill 教协议。

本设计在两者之间取一个 FreeBuddy 原生的平衡点：保留单 Run、临时 agent、任务交付定位，但引入运行时 agent 自主委派能力。已与现有代码底座核对可行性（见"实现底座"节）。

## 非目标

- 不引入跨 Run 记忆 / 长生命周期 agent / agent Profile 持久化（单 Run 内临时，是明确的分野）。
- 不替换现有 WorkflowTeam；两种 kind 并存。
- 不做 CodexLoom 式 per-edge ACL / 信任域 / Interface Agent 信息边界 / 外部 IM 集成。
- 不做异步 `notify` 单向通知、并行 delegate、run 级成本预算、CodexLoom 式 Needs You、中途反馈注入。
- 不在第一版上可视化画布（Run 视图用缩进树，画布按既有 design doc 延后）。
- 不改变 ACP/legacy agent runtime 协议层；委派复用现有 `cliRun()` spawn。
- 不在第一版解决 app 重启后续跑正在运行的委派 run（中断即 failed，树保留为证据）。

## 产品模型

### DelegationTeam

用户保存的一支自组织团队。配置项：

- **入口 agent（entryRoleId）**：Run 的协调者/根。接收目标，自主分解并委派，最终汇总。
- **花名册（roster）**：一组可用队友（含入口本身）。每项含 `label`、绑定的 `agentId`、可选 model、**`capability` 能力描述（路由契约）**、`canWrite` 写能力标记。
- **策略（policy）**：写控制、深度/超时/并发上限、失败处理。

Run 启动时无全局 plan：spawn 入口 agent，注入"目标 + 花名册 + 委派方法 + Delegation Skill + delegation MCP"，agent 自行决定如何分解与委派。

### 与 WorkflowTeam 的关系

两者共存于 `workflow_teams` 表，`kind` 判别：

- `kind: "workflow"`：现有静态预编译团队（roles + template + policy）。
- `kind: "delegation"`：本设计的自组织团队（entryRoleId + roster + policy，无 template）。

## 架构

### 四个组件

| 组件 | 角色 | 复用 |
|---|---|---|
| `freebuddy-delegate` MCP server | 挂到该模式下每个 agent；暴露 `list_teammates()` / `delegate(teammate_id, task)` | 完全照抄 ButlerBuddy MCP 的 stdio 子进程 + HTTP loopback 回主进程模式（`butlerToolService.ts` / `butlerMcpServer.ts`） |
| Delegation Skill | `SKILL.md`，教会 agent 何时/如何委派、按能力匹配、别滥用、深度意识 | 走现有 skill 注入机制（per-session skillIds + `buildSkillAnnouncement`） |
| DelegationRuntime | 新编排器：启动入口 agent、响应 `delegate()`、spawn 子 agent、强制深度/超时/写锁、收集委派树 | 复用 `cliRun` spawn；结构对照 `WorkflowRuntime`（无 phase） |
| 花名册注入 | 入口/每个 delegate 的首条 prompt 嵌入可用队友 + 能力 + 委派方法 | 对照 `augmentPromptWithConsumedSummaries` 的 prompt 拼接 |

### 核心调用流

```
入口 agent (ACP session 开着)
  └─ 调 MCP 工具 delegate("claude-reviewer", "评审 auth 模块")
       └─ stdio MCP 子进程 → POST 主进程 HTTP bridge
            └─ DelegationRuntime: 校验深度/写锁 → cliRun 起 claude-reviewer
                 （子 agent 也带 roster + delegation skill + delegate MCP → 可再递归）
                 └─ 等 done → 收 output/summary
            └─ 结果回 MCP → 作为工具返回值交给入口 agent
  └─ 入口 agent 拿到结果，继续推理 / 再委派 / 汇总
```

入口 agent 的 Turn 全程开着、卡在工具调用里；子 agent 可递归委派（深度封顶）。Run 在入口 agent Turn 结束时完成，结果即其输出。

### 关键约束

委派方必须是 **ACP 适配器**（才能挂 MCP）；被委派方可以是**任何 agent**（含非 ACP/legacy，因为它由编排器直接 spawn）。即所有主流 agent（codex/claude/opencode/cursor/kimi/qoder/codebuddy/grok）都能当委派方，legacy 只能当叶子 delegate。

### 实现底座（已核对）

- **ACP 是现代路径**：所有主流 agent 的 ACP 适配器支持 MCP，注入点在 `acpRuntime.ts:1200-1244`（往 `mcpServers` 数组加项）。
- **ButlerBuddy MCP 已证明模式**：per-session stdio MCP 子进程，经 HTTP loopback 回主进程（`butlerToolService.ts`）。delegation MCP 照抄。
- **核心空白**：今天没有通用的"agent 同步调用另一个 agent"工具——ButlerBuddy 工具是异步的（建任务/建团队），普通 agent 只能靠回合结束的文本标记（`REVIEW_STATUS` 等）影响编排。本设计填补此空白。
- **spawn-and-await 模板**：`workflowRuntime.executeStep`（`workflowRuntime.ts:921-1126`）就是"起 CLI 任务→等 done→收产出"。
- **会话恢复**：`toolSessionId` 按 agent/scope 存在（`store.ts:773-872`）。

## 数据模型

### 类型策略

TS 层用判别联合 + `kind` 区分；DB 层共存于现有 `workflow_teams` / `workflow_runs`（加 `kind` 列，旧数据默认 `"workflow"`，零破坏）。类型按惯例在 renderer/main 双写（`src/services/workflowTeams/types.ts` + `electron/cli/workflowTeamTypes.ts`）。

### 核心类型

```ts
type AnyTeam = WorkflowTeam | DelegationTeam;   // 共存，kind 判别

interface DelegationTeam {
  id, name, description, icon, enabled, source;
  kind: "delegation";
  entryRoleId: string;                  // 入口 agent（coordinator）
  roster: DelegationRosterEntry[];      // 含入口；无 nodes/edges
  policy: DelegationPolicy;
  createdAt, updatedAt;
}

interface DelegationRosterEntry {
  id: string;
  label: string;                 // 展示名，如 "代码评审"
  agentId: string;               // 绑定的 CLI member
  model?: string;
  modelOptionId?: string;
  capability: string;            // ★路由契约：什么问题该委派给它（多行）
  canWrite: boolean;             // 写能力，治理用
  skillIds?: string[];           // Delegation Skill 由模式自动附加，无需用户配
}

interface DelegationPolicy {
  allowWrites: boolean;                     // 总开关
  requireApprovalBeforeDelegateWrite: boolean;  // 写型 delegate 执行前暂停审批
  maxDepth: number;                         // 递归上限，默认 3
  delegateTimeoutMs: number;                // 单次委派超时，默认 600000（10min）
  maxConcurrentDelegates: number;           // 并发上限，v1 固定 1
  stopOnDelegateFailure: boolean;           // 默认 false：交给入口 agent 自行决策
}
```

`capability` 是 CodexLoom Domain+Scope 在 FreeBuddy 里的等价物——给其他 agent 看的可发现契约，`list_teammates()` 返回、入口 agent 据此选人的依据。

### DB 落库（最小迁移）

- `workflow_teams` 加列 `kind TEXT NOT NULL DEFAULT 'workflow'`；delegation 团队的 `template_json` 存 `'{}'` 占位（该列 NOT NULL，避免重建表；delegation 读取器忽略它），roster 复用 `roles_json`，policy 进 `policy_json`，新增 `delegation_meta_json`（放 `{ entryRoleId }`，workflow 团队为 NULL）。
- `workflow_runs` 同样加 `kind`；delegation run 的 `plan_json` 存 `'{}'` 占位（同上 NOT NULL 原因），目标文本复用既有的 `goal` 列（已 NOT NULL，不再单独加 run 级 `delegation_meta_json`），`team_snapshot_json` 照旧存团队快照。

### 委派事件表（新增）

```sql
CREATE TABLE delegation_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  parent_event_id TEXT,                  -- NULL = 根（入口 agent 本身）
  agent_id TEXT, agent_name TEXT, role_label TEXT,
  task_text TEXT,                        -- 这次被委派的任务
  depth INTEGER NOT NULL,
  status TEXT NOT NULL,                  -- pending|running|done|failed|timeout|cancelled
  result_summary TEXT,                   -- 收获的产出摘要
  can_write INTEGER NOT NULL DEFAULT 0,
  started_at TEXT, ended_at TEXT
);
CREATE INDEX idx_delegation_events_run ON delegation_events(run_id);
```

**委派树语义**：Run 启动 → 插根事件（入口 agent, depth 0）。每次 `delegate()` → 插子事件（parent=调用方事件, depth=parent+1），校验深度/策略后 spawn，done 后回填 status + result_summary。这张表本身就是"谁委派了谁、状态如何"的活动/树视图——同步模式不需要独立消息表。

## 委派协议

### MCP 工具

```ts
list_teammates()
  → { teammates: [{ id, label, capability, canWrite }] }
  // 返回除自己外的全部花名册（自己排除，避免自委派）

delegate(teammate_id: string, task: string)
  → { status: "done"|"failed"|"timeout", result: string, event_id: string }
  // 同步阻塞：调用方 Turn 卡住，直到子 agent 跑完或超时
```

### 返回契约

成功时 `result` = 子 agent 产出的 bounded 摘要（复用 `boundedWorkflowContext` 头尾截断，~12k 上限，避免撑爆调用方上下文）；失败/超时时 `status` 标明，`result` 是错误说明——**决策权交回调用方**（重试 / 换人 / 自己干），契合 `stopOnDelegateFailure=false` 的自治哲学。

### 三道护栏（spawn 子 agent 之前校验）

| 轨 | 规则 | 触发时行为 |
|---|---|---|
| 深度 | 子事件 depth = 调用方 depth + 1；若 > `maxDepth` | 不 spawn，直接返回 `{status:"failed", result:"已达最大委派深度(N)，请自行处理或简化该子任务"}`——逼 agent 收敛 |
| 超时 | 子 agent 在 `delegateTimeoutMs` 内未结束 | kill 子进程，事件标 `timeout`，返回超时错误 |
| 并发 | v1 `maxConcurrentDelegates=1`，运行内全局串行 | 并行的 `delegate()` 调用排队；写型 delegate 另守"同一时刻一个写者"原则 |

### 循环免疫

A→B→A 的乒乓不需要专门检测——**深度上限天然兜底**（每弹一次深度+1，到顶即强制收敛）。所以 `list_teammates` 只排除 self，其余全可见（等同 CodexLoom：可委派给任何人）。Delegation Skill 引导"别无意义地反弹回调用方"。

### 子 agent session 注入

1. `task` 作为 prompt；
2. 花名册 + 委派方法说明（prompt 头部注入）；
3. Delegation Skill（自动附加）；
4. `freebuddy-delegate` MCP（自动挂载）；
5. 其 `delegate()` 调用自然落在 depth+1。

### 花名册注入文本格式

```
## 协作团队（可委派）
某子任务更适合某队友时，调 MCP 工具 delegate(teammate_id, task)；list_teammates() 查队友。
优先自己能完成的；别滥用委派。当前深度 N / 上限 M。
队友：
- [codex-impl] 代码实现 (可写)："实现功能、改代码、跑构建与测试。明确需写代码的子任务委派给我。"
- [claude-rev] 代码评审 (只读)："审 diff、找 bug/风险、给改进。需独立审查时委派给我。"
```

### Delegation Skill（`SKILL.md` 要点）

何时该委派（能力匹配、自己不擅长的子领域）；如何选人（读 capability）；何时不该（自己能做的小事别委派、别反弹回调用方）；拿到失败结果怎么办（重试/换人/自己做）；深度意识。

## 运行时状态机（DelegationRuntime）

### 与 WorkflowRuntime 的本质区别

WorkflowRuntime 是 phase 循环驱动；DelegationRuntime **没有循环**——只 spawn 入口 agent 然后等其 Turn 结束。所有复杂度都发生在 `delegate()` 的同步回调里。

### Run 生命周期（复用 `WorkflowRunStatus` 语义）

```
running ─┬─→ completed（入口 Turn 正常结束，结果=其输出）
         ├─→ failed（入口 crash / 不可恢复）
         ├─→ blocked（等写审批）→ 审批后回 running
         ├─→ killed（用户停）
         └─→ partial
```

复用 `WorkflowRunStatus`（`pending_approval | running | paused | blocked | completed | failed | killed | partial`）；delegation run 无预审批门，创建即 `running`，仅在 `requireApprovalBeforeDelegateWrite` 触发时短暂进入 `blocked`。

### `delegate()` 同步流（token → 事件绑定 = 自动建树）

delegation MCP 注册时按 task-session 绑定到当前 agent 的事件节点。每次 `delegate()` 进来，runtime 自动知道调用者是谁：

```
启动入口 agent (session S0) → 注册 MCP token 绑定 {runId, E0(根)}
入口调 delegate("claude-rev", task)
  → MCP 经 HTTP bridge 带 token 进来 → 解析出 {runId, E0}
  → 建子事件 E1(parent=E0, depth=1), 校验深度/并发/写锁
  → cliRun 起 claude-rev (session S1) → 注册其 MCP token 绑定 {runId, E1}
  → 等 S1 done → 收 output/summary → 回填 E1
  → 返回 {status:"done", result} 给 MCP → 入口 agent 收到，继续推理
claude-rev 若再 delegate() → 解析出 {runId, E1} → 建孙事件 E2(depth=2)...
```

HTTP handler 是 async 函数：校验→插事件→cliRun→await done→回填→return。"阻塞"本质是 await 一个 Promise。token→事件绑定让委派树自然成型。

### 三把锁（per-run）

- `delegateMutex`：并发=1，acquire 后才 spawn 子 agent，done 后释放。同 agent 的并行 tool call 自动排队。
- 写锁：v1 被 delegateMutex 覆盖（同一时刻只跑一个 delegate）。
- 审批门：`requireApprovalBeforeDelegateWrite` 时，写型 delegate spawn 前把 run 置 `blocked`、推 UI 等批准；拒批则返回 `{status:"failed",result:"write denied"}` 给调用方。

### 主循环

spawn 入口 agent → `await` 其 done → 回填根事件 → run completed。无 phase、无调度迭代。

### 重启恢复

`recoverInterruptedDelegationRuns()` 启动时把中断 run 标 `failed`。委派中持开的 session 重启即丢失，无法真正续跑——但 `delegation_events` 树完整保留为证据。这是同步模式的固有局限。

### 取消

kill 入口 + 所有在跑 delegate 子进程，事件标 `cancelled`，run `killed`。

### ⚠️ 必须处理的真实风险

入口 agent 卡在 `delegate()` 里时自身无活动，而 ACP 层有闲置看门狗（`acpRuntime.ts:102-117`）可能把它误杀。方案：**某 session 有 delegate() 在飞期间，挂起该 session 的闲置看门狗**。此为实现强制项。

另需确保：`delegate()` 可能耗时数分钟，HTTP 连接、MCP 子进程、agent 三者都需容忍长 tool call。

## 治理与安全

最大不同：workflow 模式有静态"写节点"可预声明；委派模式里写谁是由 agent 运行时动态决定的。治理需不依赖预先知道谁会写。

### 写控制

- `allowWrites=false` → 任何 `canWrite` 的 delegate 都不 spawn（或强制以只读/沙箱跑）。总开关。
- `requireApprovalBeforeDelegateWrite=true` → 每次写型 delegate 即将 spawn 时把 run 置 `blocked`、推 UI 审批；批了才跑，拒了就 `{status:"failed",result:"write denied"}` 回调用方。动态模式下的 HITL 主闸。
- 写锁"同一时刻一个写者"→ v1 被"并发=1"自然覆盖。

### 资源边界

`maxDepth`（递归封顶，也即循环免疫）、`delegateTimeoutMs`（单次超时）、`maxConcurrentDelegates=1`。三者合起来防"无限委派 / 成本爆炸"。v2 可加 run 级 token 预算。

### 信息边界

delegate **只收到调用方写的 `task` 文本 + 花名册 + skill，看不到调用方的完整会话/上下文**。共享什么由调用方决定。等同 CodexLoom 边界理念，但实现更朴素——靠"只传 task"自然成立。

### 信任模型

花名册即信任边界，v1 任何 agent 可委派给任意队友（除自己）。不做 CodexLoom 式 per-edge ACL / 信任域 / Interface Agent 信息边界（明确列为 v1 不做）。

### 可审计性

`delegation_events` 树本身就是审计证据（谁委派了谁、任务、结果、状态、耗时），呼应 CodexLoom"证据而非绩效"的克制理念。叠加 FreeBuddy 既有的 per-step `result_json` 捕获。

### 失败模式

| 情况 | 处理 | 谁决策 |
|---|---|---|
| delegate 超时 | kill 子进程，返回 `timeout` | 调用方 |
| delegate 失败 | 返回 `failed` + 错误 | 调用方（`stopOnDelegateFailure=false`） |
| 写被用户拒 | 返回 `failed:"write denied"` | 调用方 |
| 触及 maxDepth | 不 spawn，返回 `failed:"深度封顶"` | 调用方 |
| 入口 agent crash | run=failed | 系统 |
| 重启中断 | run=failed，树保留为证据 | 系统 |

### v1 明确不做

per-edge ACL/信任域；异步 `notify` 单向通知；并行 delegate；run 级成本预算；CodexLoom 式 Needs You；中途给入口 agent 注入反馈（仅支持停/杀/审批）。

## UI

策略：复用现有 Settings/ChatView/RunPanel 外壳，按 `kind` 判别渲染委派专属内容。比 workflow 编辑器更简单（无画布）。

### 团队编辑器（`WorkflowTeamEditor.tsx` 加 `kind` 分支）

- Overview（名/描述/图标）——复用。
- Roster 编辑区（取代 Roles+Workflow 两段）：一列 roster 卡片，每张含 label、agent 选择器、model 选择器、`capability` 多行文本（路由契约，编辑重点）、`canWrite` 开关。
- 入口 agent 选择：单选其中一个 roster 项作为 `entryRoleId`。
- Policy：`maxDepth`、`delegateTimeoutMs`、`requireApprovalBeforeDelegateWrite`、`allowWrites`、`stopOnDelegateFailure`。
- 无节点/边/画布/contract 清单。

### 发起 Run（`ChatView.tsx` + `WorkflowTeamPreviewCard.tsx` 加委派变体）

团队选择器同时列两种 kind；选中 delegation 团队时预览卡显示：目标输入框、入口 agent、roster（agent→capability 摘要）、策略概览（深度/超时/写审批）。发送即以目标启动 delegation run。

### Run 视图（创新点：实时委派树）

取代线性 `WorkflowPhaseList`：

- 用**缩进树**（antd Tree 或按 depth 缩进的自定义行，v1 不上画布）渲染 `delegation_events`：根=入口 agent，子=被委派 agent。每节点：agent 头像、role label、状态徽章（running/done/failed/timeout）、task 文本（可展开）、result 摘要（可展开）、耗时。
- 实时刷新：复用 IPC 事件模式，新增 `delegation://event/<runId>` 推送事件增删改。
- 控件：Stop；写审批阻塞时出现 Approve/Reject（复用 `WorkflowRunPanel` 的 gate 按钮模式）。
- 心智模型等同调用栈/调用树视图。

### 聊天窗集成

主区显示入口 agent 的主 Turn；每次 `delegate()` 发生时插一张轻量"委派卡片"（对照 workflow step 占位消息），点开联动右侧树节点。深树时避免把每个 delegate 都铺成独立会话消息——细节进树面板。

### i18n

新增字符串走现有语言偏好（`applyWorkflowLanguagePreference` 同套）。

## 内置示例

内置一个"实现+评审"自组织团队（对照现有 3 个内置 workflow 团队），便于发现：

- 入口：codex（实现，可写）
- 花名册：claude（评审，只读，capability："审查 diff、找 bug/风险、给改进建议。需独立审查时委派"）
- 策略：maxDepth=3、timeout=10min、requireApprovalBeforeDelegateWrite=true

随 `seedBuiltinWorkflowTeams()` 一同幂等播种；用户自定义的 agent/model 绑定在 re-seed 时保留（复用 `mergeBuiltinRoles` 模式）。

## 边界与开放问题

### 固有局限（A 同步模式带来的）

- **重启不可续跑**：委派中持开的 session 重启即丢，run 直接 failed（树保留为证据）。
- **深链 token 成本**：委派链越深，上层 agent session 占着累积上下文/成本；深度上限能封顶但不能消除。
- **成败系于入口 agent**：无全局 plan 兜底，入口 agent 分解/委派得差，整个 run 就差——"自治"的代价。
- **无跨 Run 记忆**：agent 单 Run 内临时，每次冷启动；与 CodexLoom 最明确的分野。
- **并发=1**：delegate 串行，可并行的活也串着跑（v2 可放开）。
- **委派方需 ACP 适配器**；非 ACP/legacy 只能当叶子 delegate。

### 实践风险

- **agent 自治能力差异大**：分解+委派质量取决于模型，Codex/Claude 强，较弱 agent 可能乱委派或死循环（靠深度上限兜底，但体验会差）。
- **看门狗误杀**：delegate 在飞时必须挂起调用方闲置看门狗（实现强制项）。
- **MCP 长工具调用**：需确保 HTTP 连接 + MCP 子进程 + agent 都容忍长 tool call。

### 默认值（可在 plan 阶段微调）

`maxDepth=3`、`delegateTimeoutMs=600000`（10min）、`maxConcurrentDelegates=1`、`stopOnDelegateFailure=false`。

### Delegation Skill 交付

作为内置 skill 由模式自动附加（用户无需配置），随 `builtin-skills` 机制分发（对照 CodexLoom 内置 skill 打包方式，走 FreeBuddy 现有 skill 注册）。

## 演进路径（向 CodexLoom 生长）

本设计的 DelegationTeam + delegation MCP + events 树是地基。未来 v2 可逐步加：

- 并行只读 delegate（写型仍串行）。
- 异步 `notify` 单向通知。
- run 级成本/token 预算。

更远可加跨 Run 记忆 + agent Profile（走向完整 CodexLoom 模型）。每步独立增值，不必一步到位。

## 测试策略

- **单元**：深度/超时/并发护栏校验、写锁与审批门、花名册注入文本生成、token→事件绑定建树、结果 bounded 截断。
- **集成**：mock 一个会发 `delegate()` 的入口 agent → 验证子 agent spawn、结果冒泡、深度封顶、超时 kill。
- **失败模式**：delegate 失败/超时/写被拒 各路径返回契约。
- **重启恢复**：中断 run 标 failed、树完整。
- 沿用现有 `tests/` 的 `node:test` 框架与既有 workflow 测试组织方式。
