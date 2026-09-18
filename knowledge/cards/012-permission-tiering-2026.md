---
topic: 权限分级与人类介入（HITL）：2026 年主流 Agent 框架的做法
date: 2026-09-18
phase: W5 前置研究
sources: 见文末（均为 2026-09-18 联网核实）
---

# 012 · 权限分级：为什么「处处都问」等于没问

## 一、核实到的业界现状（2026-09）

### 1) 四种权限模式已成事实标准

Claude Agent SDK 官方文档给出的模式集合（本项目 W5 采用同一套语义）：

| 模式 | 行为 | 适用场景 |
|------|------|----------|
| `default` | 无自动批准；未匹配规则的调用交给回调 | 交互式本地使用（本项目默认） |
| `acceptEdits` | 自动批准**文件编辑类**操作 | 信任度建立后提效 |
| `plan` | **只读**：只能读/搜索，不能写与执行 | 审计、分析类任务 |
| `dontAsk` | **拒绝而不询问** | 锁定环境（与「不静默自动拒绝」取向相反，必须由用户显式选择） |
| `bypassPermissions` | 基本不询问 | 仅在可信沙箱内 |

另有一个值得注意的细节：**被自动批准的工具永远不会到达审批回调**。
若某检查必须对**每次调用**都生效，应放在 `PreToolUse` 钩子里（钩子的拒绝即使在高放行模式下也生效）。
—— 这直接支持了本项目 PLAN 里「PreToolUse hook」的设计，并解释了为什么它不能只放在权限回调里。

### 2) 核心设计原则：按**参数**分级，而不是按工具名

多份资料一致强调：

- **Allowlist 自动放行**：只读、可逆的调用（读取、检索、列目录）**不该打扰用户**；
- **Always-ask**：破坏性/不可逆/高成本（删除、发邮件、部署、扣款）**每次都问**；
- **按参数分级（推荐默认）**：同一个工具，参数不同风险不同——
  「5 元的退款自动放行，5000 元的必须问」「沙箱路径内的写入放行，沙箱外的必须问」；
- **反模式**：一刀切「always ask」会训练出橡皮图章式审批（**审批疲劳**），
  一刀切「auto approve」则是事故的来源。

### 3) 决策类型已从三态扩展到四态

2026 年各框架的审批决策普遍为 **approve / edit / reject / respond**：
- `edit`（**允许并修改参数后执行**）是一等公民 —— 例如把路径收窄到沙箱内再放行。
  本项目 W3 只有 allow/deny/timeout，**缺 edit**，W5 补齐。

### 4) 暂停状态放在哪里：两种架构

| 架构 | 例子 | 适用 |
|------|------|------|
| 进程内暂停 | LangGraph `interrupt()`、Claude `canUseTool` | 审批在数秒内完成且进程不掉线 |
| 序列化-恢复 | OpenAI `RunState`、Pydantic AI `DeferredToolRequests` | 人工可能几十分钟后才批，且服务会重新部署 |

本项目 W3 的 `PermissionBridge` 属**进程内暂停**（120s 超时后按超时收尾）。
若将来审批可能长时间挂起，需要改为可持久化——已记为待办。

### 5) 2026 年发生过的 API 迁移（别再照抄旧教程）

- Vercel AI SDK 7：`needsApproval` 弃用 → `toolApproval`（配置在调用/agent 层，不再塞进工具定义）
- LangChain v1：`HumanInterruptConfig` → `InMemoryLoopMiddleware` / `interrupt_on` 映射
- Pydantic AI：`DeferredToolCalls` → `DeferredToolRequests`

## 二、本项目落地（W5 已实现部分）

`packages/agent-core/src/permissions/policy.ts` —— **纯函数**权限策略层：

- 五种模式（`default` / `acceptEdits` / `plan` / `dontAsk` / `bypassPermissions`）
- **按参数分级**：`acceptEdits` 下写普通文件放行，但命中敏感路径
  （`.env`、`.git/`、私钥、`.npmrc`、锁文件、`.github/workflows/`）**仍必须询问**
- 高危工具清单优先于任何模式（含 `bypassPermissions`）
- 覆盖写入风险等级高于新建
- `fatigueHint()`：连续批准同一工具 ≥3 次时，引导用户改用规则而非继续逐个点允许

## 三、仍待做

- `edit` 决策在弹窗与执行器中的贯通（允许并修改参数）
- 审批队列状态机持久化（跨重启不丢待批请求）——需评估是否必要
- `PreToolUse` 钩子（W6+），用于「每次调用都必须执行」的审计/脱敏/红线检查

## 来源（2026-09-18 检索）

- Claude Agent SDK 权限模式与规则（官方文档）：https://code.claude.com/docs/en/agent-sdk/permissions
- 生产级工具门控与 canUseTool / 生命周期钩子：https://alicelabs.ai/en/insights/claude-agent-sdk-guide-2026
- HITL 审批闸的设计与框架对照（含「按参数分级」「审批疲劳」）：
  https://dreaming.press/posts/human-in-the-loop-approval-gate-agent-tool-calls.html
- 2026 年工具审批 API 迁移与「暂停状态放哪里」：https://dreaming.press/posts/tool-approval-api-migration-2026
- 环内/环外架构与审批节点：https://dev.to/sahil_kat/inside-the-loop-vs-outside-the-loop-evaluating-agent-architectures-5e58
