# 项目交接文档（HANDOVER）

- **交接对象**：QoderCN（项目后续开发与维护方）
- **交接日期**：2026-09-23
- **代码基线**：`e7adfe0`（标签 `v0.27.0-扩容1`）
- **阅读顺序建议**：先读本文档 → 再读 `docs/PRODUCT-GOAL.md`（定位）→ `docs/TRACK-ROADMAP.md`（排期与编号）→ `docs/PROGRESS.md`（状态权威）。
- **一句话提醒**：**`docs/PROGRESS.md` 是完成状态的唯一权威**；本文档写于 `v0.27.0`，若与 PROGRESS 冲突，**以 PROGRESS 为准**。

---

## 1. 项目概述

### 1.1 项目是什么

**俱佳Agent（JujiaAgent）**：跑在用户自己 Windows 机器上的个人 Agent ——
**能读文件 / 改代码 / 跑命令，但每个有副作用的动作都必须用户点头，数据默认不出本机**。

三条不可妥协的定位（详见 `docs/PRODUCT-GOAL.md`）：

- **本地单机优先**：不做云端账号体系、不做商业化；本地单机、无服务器中转。
- **权限判定用确定性规则**，不交给模型判断（`deny/ask` 规则绝对生效，连"全部放行"模式也让路）。
- **密钥不进渲染层、也不进模型上下文**（Key 只在主进程用于认证头）。

工程底线（对外开源项目）：LICENSE / SECURITY.md / CONTRIBUTING.md 齐备、
**不得依赖本机特殊状态**（环境变量/代理/中文路径才能跑）、**未验证的平台如实标注**（当前仅验证 Windows）。

### 1.2 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 桌面壳 | **Electron**（main / preload / renderer 三进程） | 安全基线：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false` |
| UI | **React 19 + Vite**（自研组件，**未用** Fluent UI / zustand / xyflow —— PLAN 选型表里曾写过，实际未引入，见注意事项 §5.7） | 工具卡 L0–L2（一行 → 卡片 → 抽屉）、rAF 合批、气泡窗口化（常驻 ≤120） |
| 引擎 | **`@jujia/agent-core`**（纯 TS，不依赖 Electron） | provider/SSE、工具执行、权限门、钩子、技能、插件、记忆装配、MCP 客户端 |
| 契约 | **`@jujia/shared-ipc`**（zod schema + 通道常量） | 33 个 IPC 通道，入参/出参全部过 zod；**刻意不依赖 agent-core**（分包边界） |
| 存储 | **`@jujia/shared` 的 `json-store`** | 原子写（tmp + fsync + rename + `.bak` + version 信封 + 损坏自愈） |
| 终端 | **node-pty + xterm** | N-API 模块，**不需要 electron-rebuild**（打包配置 `build.npmRebuild: false`） |
| 测试 | **vitest**（单元/集成）+ **Playwright 驱动真 Electron**（e2e） | `maxWorkers: 4`（本机满并发会出现"加载超时假红灯"） |
| 打包 | **electron-builder** | `npm run dist`（内含 build）；产物在 `apps/desktop/release/` |
| 脚本 | Python 3.13（`scripts/cleanup.py`、`gen_matrix.py` 等） | 收尾清理、知识库统计 |

### 1.3 目录结构（只列需要知道的）

```
俱佳agent/
├─ apps/desktop/                 Electron 桌面端
│  ├─ src/main/                  主进程：index.ts（窗口+安全基线）、ipc.ts（33 通道统一入口）、
│  │                             chat-service.ts、terminal-service.ts、mcp/、permission-bridge.ts、
│  │                             security.ts（发送方校验）、config-write.ts（配置白名单纯函数）、
│  │                             session-lru.ts（会话淘汰）、secret.ts、paths.ts、connections-store.ts
│  ├─ src/preload/               contextBridge 白名单暴露
│  ├─ src/renderer/              React 界面（features/{chat,permissions,hooks,plugins,mcp,appearance,...}）
│  ├─ scripts/e2e-ui.mjs         界面级端到端（真 Electron，14 步，数据隔离到临时目录）
│  └─ scripts/run-electron.mjs   Electron 启动器（必须经它启动，见 §5.2）
├─ packages/
│  ├─ shared/                    json-store 原子存储（基础设施）
│  ├─ agent-core/                引擎：providers/ loop/ tools/（含 path-guard） permissions/ hooks/
│  │                             skills/ plugins/ memory/ git/ mcp/ terminal/ browser/（新，见 §3.3）
│  ├─ shared-ipc/                zod 契约 + IPC 通道常量（contracts.ts / channels.ts）
│  └─ ui-tokens/                 外观系统：主题包（受控字段白名单，拒绝任意 CSS/JS）
├─ scripts/                      check-docs.mjs（13 项文档检查）、verify-docs-check.mjs（检查器自检）、
│                                mutation-check.mjs（变异测试）、cleanup.py、license 相关、gen_matrix.py
├─ docs/                         PRODUCT-GOAL / PLAN / PROGRESS / TRACK-PLANS / TRACK-ROADMAP /
│                                COVERAGE-MATRIX / HOOKS / SKILLS / PLUGINS / TEST-POLICY /
│                                PERF-BUDGET / SETUP-TERMINAL / ARCH-CLOUD-IDE / LEARNING-MAP /
│                                UX-AUDIT / DEPENDENCY-LICENSES / CHANGELOG-ARCHIVE / HANDOVER(本文)
├─ review/                       REVIEW-LOG.md（复核台账）、TRACK-SWEEP-1.md（全项目排查报告）、
│                                REVIEW-LOG-ARCHIVE.md、mutations.json（变异定义）、EVALUATION 已删
├─ knowledge/                    统一知识库（README.md 是四层体系导航：地图→来源→矩阵→发现→报告→卡片）
├─ assets/                       应用图标（DESIGN-NOTES.md）
└─ .workbuddy/                   工作数据（记忆/凭据已迁至此，**不属于交付物**）
```

### 1.4 核心模块与数据流（必须先懂的三条链路）

1. **对话链路**：renderer `ChatPanel` → `window.jujia.chatSend`（preload 白名单）→ `ipc.ts` 统一入口
   （**先做发送方 URL 校验**）→ `chat-service.ts` → `agent-core` Agent Loop → provider SSE 流 →
   `StreamEvent` 经 `emitStream` 推回渲染层（rAF 合批渲染）。
2. **工具链路**：Loop 产出 tool_calls → `runTool`（agent-core）→ **权限门**（模式 + 规则表 + 敏感路径 +
   高危清单 → 硬/软 ask 两级）→ 需要时经 `PermissionBridge` 弹窗问用户 → 执行 → 结果回模型。
3. **MCP 链路**：用户在 MCP 页添加服务端 → 连接需**同意** → 工具进入**同一个注册表** →
   逐工具批准后可用 → 断开即摘除工具；退出时 `disposeAll()` 杀全部子进程。

---

## 2. 已完成部分（逐项：功能 / 代码位置 / 思路 / 测试）

> 状态口径：**`docs/PROGRESS.md` 为唯一权威**。下表"测试"列指当前可复跑的验证。

### 2.1 桌面壳与安全基线（M1）✅

| 项 | 位置 | 思路 |
|----|------|------|
| 窗口与生命周期 | `apps/desktop/src/main/index.ts` | `closed` 时调用 `permissionBridge.cancelAll('窗口已关闭')`（兑现"挂起审批立即收尾"承诺）；`before-quit` 清理 MCP/终端子进程 |
| **IPC 发送方校验** | `apps/desktop/src/main/security.ts`（`isTrustedSenderUrl`）+ `ipc.ts` 统一入口 | **33 个通道共用一个入口**，入口先校验发送方是应用自己的渲染层（fail-closed）。**新通道默认受保护** |
| 渲染层隔离 | preload 白名单暴露 `window.jujia.*` | 渲染层**零** `node:` 依赖（有检查）；能力全部走 IPC |

测试：`security.test.ts`（URL 判定）、`ipc-wiring.test.ts`（接线锁：统一入口、白名单调用、cancelAll 位置）、e2e 步骤 4/5。

### 2.2 连接与模型适配（M2）✅

- 位置：`apps/desktop/src/main/connections-store.ts` + `packages/agent-core/src/providers/`。
- 思路：多 Connection（OpenAI 兼容端点 + 自定义 baseUrl）；「测试连接」真调 `listModels`（20s 超时）；
  **API Key 走 `secret.ts`（Electron safeStorage 优先，不可用退化为明文并如实标注）**，不进渲染层、不进模型上下文。
- 测试：连接 CRUD 与测试链路的单元测试；e2e 步骤 2。

### 2.3 聊天与流式 UI（M3）✅

- 位置：`apps/desktop/src/renderer/src/features/chat/ChatPanel.tsx` 等。
- 思路：流式 delta **先入缓冲、`requestAnimationFrame` 每帧刷一次**；气泡常驻 ≤120（超出给「显示更早的」按钮）；
  重页签（对话/终端/外观/连接）`React.lazy` 懒加载。
- 测试：`docs/PERF-BUDGET.md`（**采样铁律：空闲状态连续 ≥3 次，单次不可比**）；`npm run perf` 预算判定（首帧 <1000ms）。

### 2.4 工具执行与权限门（M4）✅ —— 本项目的心脏，改动需最谨慎

| 项 | 位置 | 思路 |
|----|------|------|
| 路径沙箱 | `packages/agent-core/src/tools/path-guard.ts` | **不做字符串前缀匹配**（Windows 短名/大小写/符号链接都会绕）；按真实路径解析判定 |
| 权限门 | `packages/agent-core/src/permissions/policy.ts` | 5 种模式（default/acceptEdits/plan/dontAsk/bypassPermissions）；**硬 ask vs 软 ask 两级**：执行类命令/敏感路径/用户自写 ask 规则/高危清单 = **硬 ask**（「总是允许」压不掉），普通写文件 = 软 ask（可被会话白名单压掉） |
| 高危清单 | 配置 `alwaysAskTools`（引擎级兜底） | 来自配置文件，**不经渲染层写入** |
| 规则表 | `apps/desktop/src/main/permission-rules-store.ts` + 渲染层权限页 | allow/deny/ask，**按工具名 glob**；**按参数 glob 刻意未做**（理由在 CHANGELOG v0.14.0，勿"顺手补上"） |
| 审批桥 | `apps/desktop/src/main/permission-bridge.ts` | 挂起请求有界（120s 超时）；窗口关闭 `cancelAll` 立即收尾 |
| 审批决策 | `edit`（允许但先改参数再执行） | 渲染层可编辑参数后放行 |

测试：`executor-hard-ask.test.ts`（11 例）、`policy.test.ts`、`policy-consistency.test.ts`（**跨包一致性锁**：`agent-core` 的 `PERMISSION_MODES` 与 `shared-ipc` 的 zod 枚举必须完全一致）、变异 10/10 被拦（见 `review/REVIEW-LOG.md` 复核 019）。

### 2.5 Agent Loop 与钩子（M5）✅

- Loop：`packages/agent-core/src/loop/agent-loop.ts` —— 三分支（最终答复 / 继续调工具 / 移交）+ `maxTurns` 熔断 + 工具错误回模型可恢复。
- 钩子：`packages/agent-core/src/hooks/`（**七类事件**：SessionStart / UserPromptSubmit / PreToolUse / PermissionRequest / PostToolUse / PostToolUseFailure / Stop）。
  进程型 runner；**默认关闭**、可拒绝、有超时与输出上限；`PermissionRequest` 钩子在硬 ask 时照常运行。
- 测试：`runner.test.ts`（21 例）、e2e 步骤 12（七类齐全且默认关闭）。

### 2.6 记忆与上下文（M6）🔶 部分

- 已做：工作区 `AGENTS.md` 项目指令 + `.jujia/NOTES.md` 长期记忆的**读取与装配**（`packages/agent-core/src/memory/memory.ts`）。
- **未接线**：`appendNote` / `projectContextHints`（见 §3.4 R-04 相关说明）。
- 会话历史**仅内存**（重启即丢，**这是刻意的、README 已如实标注**）；`chat-service.ts` 有 **LRU 上限 20**（`session-lru.ts` 纯函数 + 7 例测试）。

### 2.7 扩展生态（M7）🔶 大部分完成

| 项 | 位置 | 思路 |
|----|------|------|
| MCP Host | `apps/desktop/src/main/mcp/mcp-service.ts` + `real-transport.ts` | stdio 传输；连接需同意；**逐工具批准**；断开摘工具；插件声明的服务端同样走审批（插件不能自带权限） |
| 技能 | `apps/desktop/src/main/skills.ts` + `agent-core/src/skills/` | `SKILL.md` 渐进披露 + **前缀稳定** + 有界；来源优先级：用户级 → 用户插件 → 工作区 → 工作区插件；每次对话前重扫（新技能即时生效）；`load_skill` 是只读工具，过权限门 |
| 插件 | `apps/desktop/src/main/plugins.ts` | 一个清单打包 技能/命令/MCP 服务端/选项；贡献物经同一套批准流程 |
| 定时任务 | **未开始**（RRULE + 补跑，见 §3.4） | |

测试：MCP 真子进程端到端（`mcp-e2e.test.ts`）、e2e 步骤 7/8/13。

### 2.8 终端与 Git（M8）🔶 部分

- 终端：`apps/desktop/src/main/terminal-service.ts`（node-pty + xterm；**每次启动需审批**；只能开在当前工作区内；子进程环境**剔除敏感变量**（`API_KEY`/`*_TOKEN` 等）并对代理变量脱掉内嵌凭据）。
- Git：`packages/agent-core/src/git/git.ts` —— status/diff/commit 队列**读侧已接线**；**stage/unstage 写操作未接线**（见 §3.4）。

### 2.9 外观系统（M23）✅

- 位置：`packages/ui-tokens/src/theme-pack.ts` + 渲染层 AppearancePanel。
- 思路：样式包**只允许受控字段**（枚举白名单 + 数值范围 + 图片路径白名单），**拒绝任意 CSS/JS 与 `data:`/`javascript:`/`file:`** —— 防把注入面写进配置。
- 测试：theme-pack 校验测试；e2e 步骤 3。

### 2.10 基础设施（M12）🔶 部分

- `packages/shared/src/json-store.ts`：原子写 + `.bak` + version 信封 + **损坏自愈**（有并发写测试，放宽了超时）。
- 配置：`config-store.ts` + **白名单写入**（`config-write.ts` 纯函数：白名单外字段**显式报错**，绝不静默丢弃；`permissionMode` 可写、`workspace` 只能由主进程目录选择器写）。
- **日志与自动更新未做**。

### 2.11 质量基建（这是本项目最值钱的部分之一，请务必沿用）

| 工具 | 命令 | 说明 |
|------|------|------|
| 类型/静态检查 | `npm run typecheck` / `npm run lint` | 严格模式（strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes） |
| 单元/集成测试 | `npm test` | **665 通过 / 1 跳过**（40 个文件）；`maxWorkers: 4`（防满并发假红灯） |
| 界面级 e2e | `npm run e2e` | **14 步**，真 Electron + 真点击，数据隔离到唯一临时目录；收尾清理失败只提示不静默 |
| 启动性能 | `npm run perf` | 预算判定，超预算非零退出；**采样铁律见 PERF-BUDGET** |
| 冒烟 | `npm run smoke` | 真实启动 Electron 断言 IPC 全链路 |
| **变异测试** | `npm run mut` | 按 `review/mutations.json` 逐项改坏代码验证测试真拦得住；**"无法运行"单独成类，不算被拦住** |
| **文档一致性** | `npm run check:docs`（13 项）+ `npm run check:docs:selftest`（4/4） | 见 §5.4 |
| 许可证 | `npm run license:check` | 强 copyleft 硬拒绝；清单自动生成于 `docs/DEPENDENCY-LICENSES.md` |
| 清理 | `python scripts/cleanup.py --apply` | 移入项目内 `.trash/<时间戳>/`，30 天可反悔，**绝不直接删** |
| CI | `.github/workflows/ci.yml` | lint / typecheck / test / **check:docs** / build；**CI 不跑 smoke/perf/e2e**（需真实图形环境，本地跑） |

当前门禁（清单权威在 `docs/PROGRESS.md`）：typecheck / lint / test / smoke / perf / e2e / check:docs。

---

## 3. 未完成部分（剩余任务 / 当前进度 / 中断位置）

### 3.1 全部剩余里程碑（编号规范见 `docs/TRACK-ROADMAP.md` §一）

| 里程碑 | 内容 | 状态 |
|--------|------|------|
| **M10 内置浏览器** | WebContentsView + 三档打开方式 + 读正文给模型 | **🔶 第 1 步已完成（策略层），第 2 步起未做 ← 中断位置** |
| M9 无限画布 | 节点/连线/DAG 校验/执行/持久化 | ⏳ 未开始 |
| M11 多模态 | capability registry、视频生成任务 | ⏳ 未开始 |
| M14 / M17 | 多子 agent 编排 / 长任务断点续跑 | ⏳ 未开始 |
| M19–M22 | 轻量 IDE / 远程接入 / 云 worker / 调度 | ⏳ 未开始（**先解决与"数据不出本机"定位的冲突**，见 §5.8） |
| M6 写入侧 | `memory.ts appendNote` 接线（会话结束时写长期记忆） | ⏳ 未接线 |
| M7 定时任务 | RRULE + 补跑 | ⏳ 未开始 |
| M8 git 写操作 | stage/unstage/commit 的 UI 与权限门接线 | ⏳ 未接线 |
| M12 日志/自动更新 | 结构化日志、更新通道 | ⏳ 未做 |

### 3.2 中断位置与原因（接手方从这里继续）

**轨道扩容计划 1 第 2 步（M10 内置浏览器）**，具体待办：

1. **服务层**：`apps/desktop/src/main/browser-service.ts`（建议名）—— 挂 `WebContentsView` 到主窗口；
   **导航一律先过 `decideNavigation`**（`packages/agent-core/src/browser/policy.ts`，已就绪）；
   `setWindowOpenHandler` 用 `decideWindowOpen`（一律 deny，合法链接标记可交系统浏览器）；
   复用安全基线（无 node 集成、contextIsolation）；**读正文**用 `executeJavaScript('document.body.innerText')` 之类，注意只读。
2. **IPC 通道**：`BROWSER_OPEN / NAVIGATE / BACK / FORWARD / CLOSE / GET_TEXT / STATE` + `BROWSER_STATE_CHANGED` 推送
   （加进 `packages/shared-ipc/src/channels.ts` 与 `contracts.ts`，**入参出参过 zod**）。
3. **界面**：渲染层新增浏览器页签（地址栏 + 后退/前进/关闭 + 「读正文」按钮）；表单里展示策略拒绝理由。
4. **e2e**：**起本地 HTTP 服务**（Node `http`，127.0.0.1 随机端口）验证真实加载与正文提取 —— **不依赖外网**；
   另加一条"输入 `file://` 被拒绝并显示理由"的界面级断言。
5. **文档与记录**：PROGRESS 行、CHANGELOG（`[vX.Y.Z-扩容1]`）、REVIEW-LOG 复核。

**中断原因**：按路线图分步交付 —— 策略层（安全核心）先行并充分测试后，再做服务与界面；
上一轮完成策略层并验证（20/20）后到达此处。

### 3.3 已就绪、可直接使用的半成品

- `packages/agent-core/src/browser/policy.ts`：`decideNavigation / decideWindowOpen / normalizeInputUrl / isLoopbackHost`，
  **20 例测试**（含 9 种危险协议、大小写/空白绕过、畸形输入 fail-closed、本机前缀陷阱）。**接手方请直接复用，不要重写。**

### 3.4 已"降级处理"的能力（不要当成 bug，也不要悄悄恢复）

- `MODE_LABEL`（agent-core 版）与 `fatigueHint` **已删除**（零调用方死代码）。
  **审批疲劳提示**若要做：做在审批弹窗里（main 侧记录连续批准次数），并补测试 —— **不要只把函数加回来**。
- git 写操作、记忆写入：**未接线是已知状态**（README/PROGRESS 如实标注），接线时必须过权限门。

---

## 4. 后续计划（优先级 / 步骤 / 预期目标）

> 完整队列见 `docs/TRACK-ROADMAP.md` §二/§三（修复队列 R-01…R-12 + 开发队列）。此处按优先级摘录。

| 优先级 | 任务 | 步骤摘要 | 预期目标（DoD） |
|--------|------|----------|-----------------|
| **P0** | **M10 第 2 步**（服务/IPC/界面/e2e） | 见 §3.2 的 5 步 | 浏览器能开网页、能读正文；危险导航被拒且理由可读；e2e 含本地 HTTP 真加载 |
| **P1** | **R-12：`ipc.ts` 拆分**（596 行 → ≤300） | 按块抽成 `ipc/handlers/{terminal,connections,chat,mcp,hooks,permission-rules}.ts`，共享上下文对象传 `handle`；**同步改 `ipc-wiring.test.ts` 扫描全部 ipc 文件** | 每文件 ≤300 行；全部接线锁保持绿色；e2e 14/14 |
| **P1** | **M6 写入侧 + M8 git 写操作接线** | 过权限门（写=软 ask、执行=硬 ask）；接线后**补变异测试** | 用户能通过界面/对话真实使用；台账记录 |
| **P2** | **M9 无限画布** | 先写 `docs/LINKAGE-1.md`（画布↔编码引擎的对接契约）再动工 | 3 节点流程能跑、图可存可读 |
| **P2** | utilityProcess 迁移**评估**（只评估不实现） | 输出"做/不做/分几步 + 代价"结论 | PLAN 的 ADR 不再悬空 |
| **P3** | M7 定时任务 / M11 多模态 / M19+ | 按路线图 | 各自 DoD 见 PLAN 验收清单 |

**工作节奏约定**（重要）：每个阶段 = **先在 `CHANGELOG.md` 写条目 → 代码与 CHANGELOG 一起提交 → 打标签 → 汇报
（当前进度/本次范围/验证方式）**。提交说明一律中文。回退靠 `git checkout <tag>`。

---

## 5. 注意事项（已知问题 / 技术债 / 环境 / 踩坑 / 谨慎区）

### 5.1 已知 bug 与行为取舍（如实列出，不要"顺手修掉"语义）

- **会话历史仅内存**（重启即丢）——刻意设计，README 已标注；`sessions` Map 有 LRU 上限 20。
- **`plan`/`dontAsk` 模式语义**：plan=只读、dontAsk=拒绝而不询问（与"不静默自动拒绝"的默认取向相反，需用户显式选择）。
- **CI 与门禁的差异**：CI 只跑 lint/typecheck/test/check:docs/build；**smoke/perf/e2e 只在本地跑**（workflow 里有注释说明）。
- e2e 收尾清理**尽力而为**（失败只打印提示，旧目录交给 `cleanup.py`）—— 因为沙箱有"同轮删除次数"配额（见 §5.2）。

### 5.2 本机/沙箱环境坑（在这台开发机上实测过，换机器也可能遇到类似问题）

- **`spawnSync` 一律 `EBUSY`**（连 `node -e`、`cmd.exe` 都起不来），**异步 `spawn` 正常** →
  **所有脚本一律用异步 spawn**（`mutation-check.mjs` 已因此改造）。症状：`status === null` + error 带 EBUSY。
- **子进程"跑不起来"≠"测试失败"**：变异脚本已把"无法运行"单独成类、不计入被拦住（否则给假信心）。
- **沙箱删除配额**：同一轮删除次数超阈值（约 50）会拦构建/清理（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`）→
  一轮别反复跑全量测试+多次构建；**配额耗尽时绝不跑变异测试**（还原步骤可能失败，把变异留在源码里）。
- **`ELECTRON_RUN_AS_NODE=1`** 会让 Electron 退化成纯 Node → **必须用 `apps/desktop/scripts/run-electron.mjs` 启动**。
- **vitest 限并发**（`maxWorkers: 4`）：满并发会出现 `FAIL <file> [ <file> ]` 的**收集阶段失败**（单独跑全绿）——假红灯。
- **git push 走代理不稳定**（偶发 schannel/502）→ 失败就重试；**推送后必须 `git ls-remote` 核对远端 SHA**。
- **测试不写系统盘**：临时数据一律落项目内 `.tmp/`（跟随仓库所在盘）；e2e 用 `JUJIA_DATA_BASE_DIR` + 唯一运行目录。
- **C 盘只有 `%APPDATA%\JujiaAgent`、`%LOCALAPPDATA%\electron-builder` 等少量产物**；清理前备份并只删确切路径。

### 5.3 Shell 写文件的铁律（本项目踩了 7 次的坑，**最高优先级注意事项**）

**任何含反引号或 `${}` 的内容，一律用编辑工具写文件（Write/Edit），绝不用 `node -e "…"` 或 heredoc。**
最近一次事故：用 `node -e` 写复核记录，正文里 `` `http:///path` `` 被 shell 当命令替换，**内容在写入前就损坏**
（URL 片段被吞），事后逐句修复。宁可多敲几次工具调用，不要赌 shell 转义。

### 5.4 文档治理规则（机器在管，别硬扛）

- **状态唯一权威 = `docs/PROGRESS.md`**；`PRODUCT-GOAL`/`COVERAGE-MATRIX` 已指针化，不再写状态。
- **数字只写一处**（测试数/步数/门禁清单等），写在多处必被 `check:docs` 判漂移。
- `check:docs` **13 项**：npm 脚本存在性、README 链接、docs 导航、孤儿文档（docs/review/knowledge 三处）、
  **悬空引用**、钩子事件数、权限模式数、e2e 步数（README+PROGRESS）、测试文件数、门禁清单、
  "N件套"只许 PROGRESS 一处、**应用版本 = 最新变更记录版本**。
- 改了检查器规则必须跑 `npm run check:docs:selftest`（注入 4 处漂移证明它真的会咬）。
- **归档文件不受"N件套"规则约束**（历史记录不算漂移）；**绝不改写已推送的 git 历史与标签**。
- 记录命名：CHANGELOG 标题 `[vX.Y.Z-轨道简称N]`，正文首行写轨道归属；十条轨道定义见 `docs/TRACK-PLANS.md`。

### 5.5 变异测试的操作禁忌

- 只在**已提交的干净基线**上做；**禁止 `git checkout -- <file>` 还原变异**（会连带丢未提交修复）——脚本用内存备份写回。
- 变异定义里 `find` 锚点**必须恰好命中 1 次**，否则显式失败。
- 写测试防"假拦截"：**测试数据要让输入顺序与期望顺序相反**（排序类）；**被测差异必须在所选取值上真实存在**
  （变异 M4 逃逸的教训：用"可写键+undefined"测不出"undefined 不算写入"）。

### 5.6 需要谨慎修改的代码区域（改动前先读注释与对应测试）

1. **`ipc.ts` 统一入口的发送方校验**：`handle` 定义必须在任何 `handle(...)` 调用之前（`const` 暂时性死区，实测踩过）。
2. **`policy.ts` 权限门**：硬/软 ask 语义 + `PERMISSION_MODES` 与 `shared-ipc` 的一致性锁——**改一边必改另一边**。
3. **`config-write.ts` 白名单**：白名单外必须报错；`workspace` 永远不可由渲染层写；有接线锁盯着 `ipc.ts` 必须真调它。
4. **`path-guard.ts`**：不要"优化"成字符串前缀匹配。
5. **`browser/policy.ts`**：先原始输入结构校验再 URL 解析（顺序有实测依据，见测试注释）。
6. **`json-store.ts`**：原子写与自愈逻辑，改前跑并发写测试。
7. **`e2e-ui.mjs` / `run-electron.mjs` 的路径解析**：一律按**脚本自身位置**（`import.meta.url`）解析，不要用相对 cwd。

### 5.7 技术债清单（已登记、未还）

- `ipc.ts` 596 行（目标 ≤300）—— **R-12**。
- Agent runtime 在 main 进程而非 `utilityProcess`（PLAN 的 ADR 未兑现，已在 PLAN 就地标注"未实现"）—— 待评估。
- 首屏 chunk 652KB（目标 <400KB gzip）；长会话 fps 未实测（需 DevTools 录制）—— PERF-BUDGET 待办。
- `as never` / `as unknown as` 断言集中在工具入参与 provider 解析处（有注释说明，属类型边界妥协）。
- PLAN 选型表里的 React 18 / Fluent UI / zustand / xyflow **与实际不符**（实际 React 19 + 自研组件）——已按事实修正一部分，选型表仍待清理。

### 5.8 定位冲突（需要产品决策，不是 bug）

`docs/ARCH-CLOUD-IDE.md` 的 M20/M21（远程接入/云端 worker）与 PRODUCT-GOAL 的"数据不出本机"、
README 的"无服务器中转"存在**表述冲突**（SECURITY 的出站表也没有对应类别）。
**在解决这个冲突之前不要动工 M20/M21**；SECURITY.md 的出站清单必须先扩展并如实标注。

### 5.9 账号与密钥（**仓库里没有任何密钥**）

- 仓库：`https://github.com/Zhang-jx00/jujia-agent`（公开）。**交接不涉及任何账号转移**。
- ⚠️ **重要**：此前有一个 GitHub PAT 曾暴露过，**唯一有效的处置是账号持有人本人撤销并重签** —— 这一步只有仓库所有者能做，**接手方请在接手前向所有者确认已完成**。
- 模型 API Key 属用户本地数据（safeStorage 加密存储），不随仓库走；接手方开发用自己的 Key，别提交。

---

## 6. 其他信息

### 6.1 文档地图（按用途）

| 想知道什么 | 看 |
|------------|-----|
| 项目定位与取舍 | `docs/PRODUCT-GOAL.md` |
| 现在做完什么了 | `docs/PROGRESS.md`（**状态权威**） |
| 下一步做什么、编号规范 | `docs/TRACK-ROADMAP.md` |
| 工作怎么分类/记录（十条轨道） | `docs/TRACK-PLANS.md` |
| 架构与模块职责 | `docs/PLAN.md`（§4 模块表、§5 阶段表） |
| 全项目问题清单 | `review/TRACK-SWEEP-1.md`（轨道排查计划 1） |
| 每轮复核与变异记录 | `review/REVIEW-LOG.md`（更早的在 ARCHIVE） |
| 历史变更 | `CHANGELOG.md`（最近 12 条）+ `docs/CHANGELOG-ARCHIVE.md` |
| 安全承诺与边界 | `SECURITY.md` |
| 怎么装终端依赖、常见报错 | `docs/SETUP-TERMINAL.md` |
| 性能预算与采样铁律 | `docs/PERF-BUDGET.md` |
| 钩子/技能/插件用法 | `docs/HOOKS.md` / `docs/SKILLS.md` / `docs/PLUGINS.md` |
| 领域覆盖（60+ 领域落点） | `docs/COVERAGE-MATRIX.md`（只管落点映射） |
| 知识库（108 领域） | `knowledge/README.md`（四层体系导航） |

### 6.2 常用命令速查

```bash
npm install                # 安装（workspace monorepo）
npm run dev                # 开发模式（经 run-electron 启动器）
npm run typecheck          # 类型检查
npm run lint               # 静态检查
npm test                   # 单元 + 集成测试
npm run smoke              # 真实启动 Electron 冒烟
npm run e2e                # 界面级端到端（14 步）
npm run perf               # 启动性能预算判定
npm run mut                # 变异测试（按 review/mutations.json）
npm run check:docs         # 文档一致性（13 项）
npm run check:docs:selftest# 检查器自检（证明它会咬）
npm run license:check      # 依赖许可证合规
python scripts/cleanup.py  # 收尾清理（预览→--apply）
npm run dist               # 打 Windows 安装包（内含 build）
```

### 6.3 部署 / 发布流程

1. 确认**门禁全绿**（清单见 `docs/PROGRESS.md`；本地跑）。
2. `npm run dist` → 产物在 `apps/desktop/release/`（安装包 + portable）。
3. **打包后的 exe 也要跑 `--smoke`**（`env -u ELECTRON_RUN_AS_NODE ./JujiaAgent.exe --smoke`，退出码 0 才算过）。
4. 在 GitHub 发 Release、传产物、打标签（`vX.Y.Z-轨道N`）。
5. **版本号规则**：`apps/desktop/package.json` 的版本必须等于最新 CHANGELOG 条目版本（有机器检查）。
6. 收尾：`python scripts/cleanup.py --apply`。

### 6.4 给接手方的最后叮嘱

- 这个项目的可信度建立在**"说了没做就是没做"**上：测试没过就写没过，跑不成就写跑不成，**绝不假称完成**。
- 改任何安全相关代码前，先读对应测试与 `review/REVIEW-LOG.md` 里相关的复核记录 —— 大部分坑已经踩过并写下来了。
- 有疑问先查文档与台账；**文档与代码冲突时，以代码为准并修文档**（然后用 `check:docs` 钉住）。
