# Delegation Verdict 与「修复后再次委派」设计

> 状态：已定稿（方案 A）。基于实测 run `delrun_mspfu68b_4prsjn`：实现修完评审问题后未再委派复审即结束；依赖用户追问才进入第二轮评审。  
> 相关：[`2026-08-12-delegation-bus-design.zh-CN.md`](./2026-08-12-delegation-bus-design.zh-CN.md)

## 目标

让父节点在子委派结算唤醒时，拿到**结构化 verdict**，并按分支给出明确后续指令：

- 评审未通过 / 有待改 → **先改代码，再 `delegate` 给同一评审角色复审**；复审 `pass` 前不要宣布收尾
- 评审通过 → 可以收尾
- 未提交 verdict → 保守按「有待改」处理（软约束）

约束级别：**文案 + 轻量运行时提示**（写入 event、丰富 wake / `check_delegate_result`）。**不**拦截 `TurnEnded`，**不**自动代发复审。

## 非目标

- 硬拦收尾或自动 `delegate` 复审
- 从自由文本启发式解析「可收尾 / LGTM」作为主路径
- `list_teammates` 过滤祖先（另开）
- Cursor ACP transcript 里 MCP `rawOutput` 仅 `{success:true}` 的可观测性修复（另开）

## 数据模型

在 `delegation_events` 上新增：

| 列 | 类型 | 含义 |
|----|------|------|
| `verdict` | `TEXT NULL` | `pass` \| `needs_changes` \| `fail`；未提交为 `NULL` |
| `verdict_summary` | `TEXT NULL` | 可选一两句摘要 |

与现有 `result_summary` 分离：后者仍是整段输出摘录；前者是显式结构化结论。

类型层（`DelegationEvent` 等）同步增加 `verdict` / `verdictSummary`。

`ChildSettled` / `SpawnWake` 携带 `verdict`（及可选 `verdictSummary`），供 orchestrator 组 wake prompt。

## MCP：`submit_verdict`

挂在 `freebuddy-delegate`：

```ts
submit_verdict({
  verdict: "pass" | "needs_changes" | "fail",
  summary?: string
})
```

行为：

1. Bridge `action: "submit_verdict"` → `submitVerdictAction`
2. 写入**当前 binding 对应的本节点 event**（不是父节点）
3. 非法 enum → `{ ok: false, error }`
4. 允许覆盖（最后一次为准）
5. 成功返回 `{ ok: true, verdict, event_id }`

`check_delegate_result` 响应在现有字段外增加 `verdict` / `verdictSummary`（若有）。

实现类子任务**不强制**调用；缺省不影响子节点进入 `done`。

## 协议文案（单源 `protocol/text.ts`）

Skill / MCP description / roster / wake 全部从 `protocol/text.ts` 派生。Skill 版本升到 `1.2.0`。

新增约定（审查类任务）：

- 结束前必须调用 `submit_verdict`
- `pass`：明确可收尾；`needs_changes`：列出待改点；`fail`：阻塞性不通过

### Wake 分支（替换「或按需再次委派」）

| 子任务 `verdict` | 唤醒指令要点 |
|------------------|--------------|
| `pass` | 评审已通过。若无新待办可收尾；不要无故再开一轮。 |
| `needs_changes` / `fail` | 先按结果修改；改完后必须再 `delegate` 给同一评审角色做复审。在复审返回 `pass` 之前不要宣布收尾。 |
| `null` | 与 `needs_changes` 同等约束，并注明对方未提交 verdict、系统保守处理。 |

唤醒正文仍附带：子任务原文、`verdict`、`verdictSummary`（或完整 `resultSummary`）。

## 运行时接线

1. `delegateMcpServer.ts` — 注册 `submit_verdict`
2. `delegationDispatch.ts` / `protocol/tools.ts` — `submitVerdictAction`
3. `delegationRuns.ts` — schema 迁移 + `updateDelegationEvent` 支持新字段
4. `bus/types.ts` / `stateMachine.ts` / `orchestrator.ts`（及 `delegationRuntime` 若仍组 wake）— 传入 `verdict` 并调用更新后的 `buildDelegateWakePrompt`
5. `assets/skills/delegation/SKILL.md` — 与 `buildDelegationSkillMarkdown()` 同步

## 缺省与边界

- 未 `submit_verdict`：子 event 仍可 `done`；父 wake 按 `needs_changes` 文案
- 不拦截 `TurnEnded`；模型仍可能违抗，但提示比现状明确
- bounce / 整任务外派 / depth 硬治理不变

## 测试

- unit：`submit_verdict` 写入、覆盖、非法 enum
- unit：`buildDelegateWakePrompt` 对 `pass` / `needs_changes` / `fail` / `null` 的文案快照
- 协议短语 snapshot 含 `submit_verdict`、`needs_changes`、复审约束关键句

## 成功标准

同一类「实现 → 评审找出问题 → 实现修复」路径下：修复轮唤醒文案明确要求再次委派复审；复审侧若调用 `submit_verdict("pass")`，下一唤醒允许收尾。不再依赖用户手动追问「修复完需要干啥」才能进入复审闭环（在模型遵循提示的前提下）。
