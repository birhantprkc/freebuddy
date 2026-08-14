# Delegation 完整异步编排总线（方案 B）设计

> 状态：现行设计。旧文 [`2026-08-09-delegation-team-design.zh-CN.md`](./2026-08-09-delegation-team-design.zh-CN.md) 中「同步阻塞 delegate」段落已 superseded。

## 目标

将自组织委派团队从「半异步 + `cli:run` 旁路」收束为**唯一异步编排总线**：

- Tools 只 enqueue，立刻返回 `{pending, request_id}`
- Orchestrator 是唯一 spawn / park / wake / 完结所有者
- 对话跟进与首轮入口共用同一状态机
- 协议文案单源；bounce / 整任务外派硬拒绝

## 模块

```
electron/cli/delegation/
  protocol/text.ts      # 唯一协议文案（Skill/MCP/roster/wake）
  protocol/guards.ts    # bounce / 整任务相似度
  protocol/tools.ts     # list/delegate/check 决策
  bus/types.ts
  bus/stateMachine.ts   # 纯函数 reduce
  bus/concurrency.ts    # active-leaf 队列
  bus/orchestrator.ts   # 执行 effects + park/wake 循环
  adapter/ipcFollowUp.ts
```

薄门面：`delegationRuntime.ts`、`delegationDispatch.ts`、`delegationPrompt.ts`。

## 状态机

**Run**：`running | blocked | completed | failed | killed`  
**Node**：`idle | turning | parked | done | failed | timeout | cancelled`

关键规则：

1. `TurnEnded` + 有未完成子 → `parked`（run 保持 `running`）
2. `ChildSettled` + parent `parked` → `SpawnWake`
3. `TurnEnded(entry)` + 无未完成子 → run `completed`
4. `UserFollowUp`：completed/failed → reopen `running`，再跑 entry turn
5. 并发按 **active leaf**（有未完成子的 running 父不占槽）

## 跟进路径

禁止在 `cli:run` 上注入 delegation MCP。  
Renderer 对绑定了 delegation run 的会话调用 `delegation:followUp` → bus `UserFollowUp`。

## 硬治理

- 不可委派给 self
- 不可委派给调用链祖先（no ping-pong）
- 不可把父任务近乎原样外派（token Jaccard ≥ 0.92）
- depth / allowWrites / 写审批保持原语义

## 非目标

- 真并行多 leaf 产品化（默认 `maxConcurrentDelegates=1`）
- app 重启后续跑 ACP 会话
- `stopRun` 杀全量子进程
