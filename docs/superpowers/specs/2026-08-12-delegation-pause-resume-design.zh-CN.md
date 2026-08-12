# Delegation Run 暂停 / 继续设计

> 状态：已定稿（暂停立刻掐断；继续从被掐断角色恢复）。  
> 相关：[`2026-08-12-delegation-bus-design.zh-CN.md`](./2026-08-12-delegation-bus-design.zh-CN.md)

## 目标

为自组织委派 run 增加 **暂停 / 继续**：

- **暂停**：立刻掐断当前正在跑的 agent 回合；run 进入可恢复的 `paused`
- **继续**：从**被掐断的那一层角色**再开一轮（带「因用户暂停中断」说明）

与 **停止（killed）** 区分：停止不可恢复。

## 非目标

- 暂停时让当前回合自然跑完（已否决）
- 只暂停超时计时（已另做）
- 按单个队友粒度暂停
- 跨应用重启后的复杂现场恢复（见下方边界）

## 行为

### 暂停 `pauseRun(runId)`

1. 若 run 不存在或非 `running`/`blocked` → no-op / 返回 false  
2. 记录 `pausedRunIds`（与 `killedRunIds` 分离）  
3. 通知 orchestrator 停止 park/wake 循环（可复用/扩展现有 kill 打断，但 **status 写 `paused` 而非 `killed`**）  
4. **立刻取消**当前 ACP/agent 会话（与 `stopRun` 同等杀进程力度；若 stop 尚未真正 abort session，本任务一并补齐）  
5. DB：所有该 run 下 `pending`/`running` 的 `delegation_events` → `cancelled`，`result_summary` 含「用户暂停」  
6. 记下 resume 锚点：`resumeNodeId` = 被掐断时正在执行的 event id（depth≥1 的叶子，或入口 turning 节点）；持久化到 run 元数据或内存 map（见数据）  
7. `workflow_runs.status = 'paused'`（类型已有 `paused`）

### 继续 `resumeRun(runId)`

1. 若 status ≠ `paused` → false  
2. 清 `pausedRunIds`，status → `running`  
3. 用锚点 `resumeNodeId` 对应 roster 角色，spawn 新一轮 turn：  
   - prompt = roster 头 + 「上次因用户暂停中断，请从现场继续」+ 原 `taskText`（及可选最近 result 摘要）  
4. 若锚点丢失：退回 entry follow-up（同现有 `followUp`）

### 停止 `stopRun`

保持现有：`killed`，不可 `resume`。若已 `paused`，停止仍可变为 `killed`。

## 数据

| 项 | 方案 |
|----|------|
| run.status | 使用已有 `paused` |
| resume 锚点 | 优先：`delegation_meta` / run 行扩展 JSON 字段；若不想迁库：runtime 内存 `Map<runId, { nodeId, roleId }>` + 重启后锚点丢失走 entry 回退 |
| event 状态 | `cancelled` + 摘要 |

**推荐 v1**：锚点先放 runtime 内存；应用重启后 `paused` run 保留 status，但 resume 走 entry follow-up（并在 UI 提示「会话已重启，将从入口继续」）。避免本轮大迁移。

## UI

- 委派会话卡 / run 控件：`running` 时显示「暂停」；`paused` 时显示「继续」；始终保留「停止」
- 文案复用 `workflow.pause` / `workflow.resume` 或委派专用 key
- 状态展示：`paused` →「已暂停」

## 运行时接线

- IPC：`delegation:pauseRun` / `delegation:resumeRun`（对称现有 `stopRun`）
- preload + `delegationClient`
- `recoverInterruptedDelegationRuns`：**不要**把 `paused` 收成 failed；仅处理 `running`/`blocked`

## 测试

- unit：`pauseRun` 将 active events → cancelled，status=paused  
- unit：`resumeRun` 从锚点再 spawn（mock executor）  
- unit：paused 时不再 timeout/drain 新任务  
- UI：有 pause/resume 按钮绑定（轻量）

## 边界

| 场景 | 行为 |
|------|------|
| 暂停瞬间无活跃 agent（仅 park 等待） | 取消挂起子事件；锚点取 park 中的父节点 |
| 多层嵌套 | 掐断当前叶子；锚点=该叶子 event |
| 写审批 blocked | 可暂停；取消 pending 审批 resolve(false) 或保持 blocked→paused |
| 应用重启 | paused 保留；锚点丢失 → entry follow-up |

## 非目标再确认

- 不自动把 pause 当 needs_changes
- 不改 verdict 冒泡逻辑（已独立完成）
