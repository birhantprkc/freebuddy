# OpenCode 多挂载目录权限放行设计

## 目标

当 FreeBuddy 多文件夹项目挂载了多个本地目录时，启动 **OpenCode ACP** 后，OpenCode 原生工具（`read` / `edit` / `glob` / `grep` / `bash` 等）访问这些挂载目录 **不再触发** `external_directory` 的 `ask`，从而避免子 agent 在内部等待审批、ACP 又不透出请求导致的会话永久卡住。

用户心智：

> 项目里挂上的目录，对 OpenCode 就是工作区的一部分（可读可写），不该再弹「外部目录」审批，更不该静默挂死。

## 非目标

- 不改 Qoder / Cursor / CodeBuddy / Codex 等其它 adapter（它们 ACP `session/request_permission` 链路已可用）。
- 不写入用户仓库的 `opencode.json` / `.opencode/`（避免污染 git）。
- 不做「卡住看门狗 / 假权限弹窗」止血方案（可另开 B 方案）。
- 不放行 **项目 folders 以外** 的路径（例如未挂载的 `ex-mfe` 仍按 OpenCode 默认 `ask`）。
- 不把多根变成 ACP 协议级多 `cwd`（协议仍只传 Primary）。

## 背景与根因

多文件夹项目（见 `2026-07-27-multi-folder-projects-design.zh-CN.md`）已实现：

- SQLite `projects.folders` + `primaryPath`
- 运行时 `CliRunArgs.workspaceRoots`
- 多根时注册 `freebuddy-workspace-fs` MCP

但 ACP `session/new|resume|load` 只能传 **单个** `cwd`（Primary）。OpenCode 以该 cwd 为工作区边界；访问其它绝对路径会走 `external_directory`（默认 `ask`）。

实测（2026-07-27 过夜卡住会话 `FUL4VeoBTh7AKEZeyngkB`）：

1. 主 agent 并行派 5 个 explore 子任务；2 个在 Primary 内完成，3 个访问挂载仓后进入内部 `asking`。
2. OpenCode 进程日志有 `external_directory` ask，但 **ACP stdout 从未出现** `session/request_permission`。
3. FreeBuddy 对 stdout **先 `appendLog` 再解析**；同机其它 OpenCode 会话若发出 `request_permission` 可正常 auto-approve。故结论是 **OpenCode 子 agent 路径未桥接 ACP**，不是 FreeBuddy 漏识别。
4. 第一版「仅靠 MCP 文件桥」无法约束 OpenCode 原生工具，因此需要 **Adapter 特例**：启动时向 OpenCode 注入挂载目录放行规则。

这修正了多文件夹设计中「不按 CLI Adapter 做原生 multi-root 特例」的决策，**仅针对 OpenCode**。

## 产品决策（已确认）

| 决策点 | 选择 |
|--------|------|
| 修法 | 根因：挂载目录对 OpenCode 不再算外部 |
| 注入方式 | 启动时 `OPENCODE_CONFIG_CONTENT`（会话级，不写盘） |
| 权限强度 | **完全放行**（读 + 写 + bash，与 Primary 同权） |
| 作用范围 | 仅 `opencode-acp` |
| 单根项目 | 不注入 `permission`（行为与今日一致） |
| 未挂载路径 | 仍走 OpenCode 默认（通常 `ask`） |

## 架构

### 配置注入

OpenCode 配置优先级中，`OPENCODE_CONFIG_CONTENT` 为运行时覆盖层（见 [OpenCode Config](https://opencode.ai/docs/config/)）。FreeBuddy 已用该 env 注入 `model`；本设计在同一 JSON 上合并 `permission`。

```
Project.folders
  → resolveWorkspaceRootsForConversation
  → CliRunArgs.workspaceRoots
  → buildCommand({ adapter: "opencode-acp", cwd, workspaceRoots, … })
  → env.OPENCODE_CONFIG_CONTENT = {
      ...(model ? { model } : {}),
      ...(multiRoot ? {
        permission: {
          external_directory: {
            "<absRoot1>/**": "allow",
            "<absRoot2>/**": "allow",
            …
          }
        }
      } : {})
    }
```

OpenCode 文档约定：`permission.external_directory` 可用路径 glob；允许后该目录继承工作区默认工具策略（读默认可、编辑默认可，除非另有 deny）。本设计 **不** 额外加 `edit: deny`。

### 路径规则

1. 对 `workspaceRoots` 中每个非空字符串：`path.resolve` 后规范化。
2. 生成 pattern：`"${resolvedRoot}/**"`（去掉尾部多余 `/` 再拼 `/**`）。
3. Primary / 非 Primary **全部**写入（含 Primary 幂等，简化逻辑）。
4. `workspaceRoots.length <= 1`：**不**写入 `permission` 键。
5. 与已有 `model` 字段浅合并：同一 `OPENCODE_CONFIG_CONTENT` 对象内同时可有 `model` 与 `permission`。

### 调用链改动

| 位置 | 改动 |
|------|------|
| `BuildCommandInput` | 增加可选 `workspaceRoots?: string[]` |
| `adapters.ts` → `opencode-acp` | 按上表构建 / 合并 `OPENCODE_CONFIG_CONTENT` |
| `runtime.ts`（及凡调用 `buildCommand` 且已有 `CliRunArgs.workspaceRoots` 处） | 传入 `workspaceRoots` |
| `sessionConfigProbe.ts` 等探测路径 | 若探测也 spawn OpenCode，同样传入，避免探测与真跑不一致 |

不改 UI；不改 `projects` 表结构；不改 MCP 注册策略（多根仍注册 `freebuddy-workspace-fs`，作为补充而非本修复依赖）。

## 错误处理与边界

- `workspaceRoots` 缺省或空：等同单 cwd 行为。
- 非法 / 无法 resolve 的条目：跳过该条，不让整个 spawn 失败。
- 用户全局 `~/.config/opencode/opencode.json` 若已有更严的 `external_directory`：按 OpenCode 合并规则，后加载的 `OPENCODE_CONFIG_CONTENT` 应能覆盖冲突键；实现后用实测确认「Content 层 allow」优先生效。若实测相反，改为 `OPENCODE_CONFIG` 临时文件或调整合并策略（实现计划里验证）。
- 子 agent 继承同一 OpenCode 进程配置：一次注入覆盖主会话与 task 子会话。

## 测试

- 单元：`buildCommand("opencode-acp")`
  - 单根 / 无 roots → env 无 `permission`
  - 多根 → `external_directory` 含每个 `root/**` 且为 `"allow"`
  - 同时有 model → JSON 同时含 `model` 与 `permission`
  - 路径带尾斜杠 → 规范化后 pattern 正确
- 回归：现有 opencode-acp model 注入测试仍通过。
- 手工：`51caiji` 项目（folders 含 `exadmin` + 微信小程序目录）再跑跨仓探索；OpenCode 日志对挂载路径应为 `action=allow`，会话不应因 `external_directory` 永久 `等待中`。

## 验收标准

1. 多文件夹项目启动 OpenCode 时，进程环境含合并后的 `OPENCODE_CONFIG_CONTENT.permission.external_directory`。
2. 访问任一项目 folder 下路径不再因 `external_directory` 进入无 ACP 透出的内部 ask。
3. 单文件夹项目行为与改前一致。
4. 未挂载目录仍可被 OpenCode 按默认策略拦截（不扩大到整个家目录）。

## 与既有设计的关系

- **补充** `2026-07-27-multi-folder-projects-design.zh-CN.md`：MCP 文件桥保留；OpenCode 额外需要原生权限注入才能让「项目内多根可读写」在 OpenCode 上成立。
- **不替代** 未来若 OpenCode / ACP 支持真正多 root workspace 的上游修复；届时可删除或收窄本特例。
