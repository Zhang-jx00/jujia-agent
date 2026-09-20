# 俱佳Agent · 开发计划（可执行版 v3）

> 2026-09-18 · 依据：`knowledge/SOURCE-MATRIX.md`（108 领域 × 5 类来源）+ `review/EVALUATION.md` + 本地 Yan-Agent（v1.5.0）源码分析
> 本文档是**唯一开发执行依据**：范围、选型、架构、模块、阶段、任务、验收、风险、设计稿全部在此，改需求先改这里。
> 形态：Windows 桌面 · 技术栈：TypeScript + Electron · 定位：**学习与技术练手，可逐步产品化**

---

## 1. 项目目标与范围

### 1.1 定位

> 面向 Windows 工作区的**个人桌面 Agent**：能对话、能读写文件、能跑命令、能用**无限画布搭建工作流**、有**内置浏览器**、能按模型能力调用**视频生成等多模态功能**；全程可审计、可学习。

| 项 | 决定 |
|----|------|
| 名称 | 俱佳Agent（Jujia Agent） |
| 用户 | 你自己（第一用户）→ 可展示的开源作品 |
| 形态 | Electron 桌面应用（Windows 优先） |

### 1.2 成功标准（全部可验收，见 §5/§6）

1. 能连接模型流式对话；断流/错误可重试
2. 能在**指定工作区**内读写文件、跑命令，写操作有权限确认，权限面板**永不静默自动拒绝**
3. 能在**无限画布**上拖拽建节点、连线定义执行顺序/数据流，节点可对齐，支持右键菜单与快捷连线
4. 有**内置浏览器**（默认实现），也可切换「系统默认浏览器 / 自选本机浏览器」打开
5. **视频生成**等多模态功能依赖用户自配模型：能力满足时可用，不满足时 UI 禁用并说明原因
6. 配置/会话损坏可自愈（原子写 + 备份）；长对话可压缩不丢关键事实

### 1.3 范围（In）

Agent 运行时（loop/工具/权限）、多子代理编排、记忆与长期记忆、MCP/Skills/Hooks/定时任务、
Electron 工程、性能与流畅、UI/UX/动效/组件卡片、模型适配（含国产厂商）、
无限画布工作流、内置浏览器与文档查看、多模态能力门控与媒体资产。

### 1.4 非目标（Out，防止范围膨胀）

- 不做云端账号体系、不做商业化
- 不承诺全应用 Computer Use（只做工作区内的受控操作）
- 不自研画布底层引擎（基于 React Flow/xyflow）
- 不绑定单一模型厂商；MVP 不做移动端

### 1.5 工程原则（写进代码审查清单）

1. **证据优先**：Agent 完成 = 工具/测试证据，不是模型自称
2. **安全默认**：sandbox on、权限显式、路径白名单、IPC 校验 sender
3. **数据可恢复**：原子写 + `.bak` + schema version
4. **UI 不卡**：delta 渲染、虚拟列表、画布视口裁剪、主进程零阻塞
5. **先简单后智能**：workflow 能解决就不上复杂多代理
6. **宁缺勿滥**：文档、来源、能力声明都如实，不编造

---

## 2. 技术选型

### 2.1 总表

| 层 | 选型 | 版本基线 | 理由 | 替代方案 |
|----|------|----------|------|----------|
| 运行时 | Node.js | 22 LTS | Electron 内置 Node 对齐 | — |
| 桌面壳 | Electron | ≥31（装最新稳定） | 官方进程模型/安全清单完善（S4 §1–7） | Tauri（生态弱于 Agent 场景） |
| 语言 | TypeScript（strict） | 5.x | 全栈同语言 | — |
| 构建 | Vite + electron-vite | 最新稳定 | HMR 快；electron-vite 处理 main/preload 打包（S5 §3） | webpack |
| UI 框架 | React 18 | 18.x | 生态最大；xyflow/tldraw 均为 React 优先 | Vue |
| 组件库 | Fluent UI React v9（`@fluentui/react-components`） | v9 | Windows 气质，MessageBar/Toast/Dialog/Card/Skeleton 齐全（S6 §2/§7） | Ant Design |
| 状态 | zustand | v5 级 | 轻、无样板；画布与聊天各自 store | Redux Toolkit |
| 画布 | **React Flow（`@xyflow/react`）** | v12 | viewport/Handle/`isValidConnection` 与需求一一对应；性能指南官方（S9 §86–94） | tldraw（偏白板）、LiteGraph（偏原始） |
| 图执行 | 自研拓扑执行器（topo + 状态回写） | — | 需求特化（节点=Agent 步骤），无合适现成库（S9 §91） | LangGraph.js（过重） |
| 样式 | CSS Variables Design Tokens（自研 tokens.css） | — | ref→sys→comp 三层，M3/LobeHub 模式（S6 §1） | Tailwind（与 Fluent 混用易乱） |
| 终端 | xterm.js + node-pty | xterm 5 / node-pty 1.x | 事实标准；pty 仅 main 侧 spawn（S4 §9） | — |
| 模型通路 | fetch + SSE 自研薄客户端 | — | 学习优先；协议只有 openai/anthropic 两档（S7 §1–5） | Vercel AI SDK（黑盒） |
| MCP | `@modelcontextprotocol/sdk` | 最新 | 官方 SDK；Host 在 runtime（S2 §1–5） | — |
| PDF | PDF.js（`pdfjs-dist`） | 4.x | 纯前端渲染可控（S10 §98） | Chromium 内置 viewer（不可定制） |
| Markdown/高亮 | marked + highlight.js | 最新 | 轻量、可控（S10 §98） | shiki（重） |
| 校验 | zod | v3/v4 级 | 工具 schema、IPC 契约、图 schema 共用 | ajv |
| 打包 | electron-builder | 最新 | nsis + portable + asarUnpack（S4 §10） | forge |
| 测试 | vitest（单测）+ Playwright（e2e 冒烟） | 最新 | agent-core 可无 Electron 单测（S4 §12） | jest |
| Lint | eslint + prettier + `tsc --noEmit` + 文件行数上限 | — | 防 Yan 式巨石文件 | — |

### 2.2 关键决策记录（ADR 摘要）

| 决策 | 选择 | 依据 |
|------|------|------|
| Agent 执行位置 | utilityProcess（main 只路由） | Electron 官方性能/安全（S4 §7–8） |
| 控制流 | 三分支 loop + maxTurns | OpenAI/Claude Agent SDK（S1 §2/§10） |
| 工具路径 | **绝对路径** + 工作区校验 | Anthropic ACI 经验 + Yan 教训（S1 §5） |
| 写并发 | 写盘/Shell 串行，只读可并行 | Claude Agent SDK（S1 §4） |
| 画布底层 | 不自研，用 xyflow | S9 对标：需求与 API 一一对应，自研周期不可控 |
| 内嵌网页 | WebContentsView（不用 `<webview>`） | 官方推荐演进（S10 §95） |
| 能力门控 | 声明 → UI 禁用/降级 → 探测兜底 | S11 §101；禁止「点了才报错」 |
| 定时任务 | 磁盘 Schedule + 抖动 + 漏跑补一次 | Claude Desktop 模式（S2 §9–10） |

### 2.3 网络与依赖安装注意事项（2026-09-18 代理环境实测）

1. GitHub（web/api/raw/codeload）、git clone、PyPI：**已验证可用**。
2. npm：registry 元数据与 tarball 均可用（小规模安装 3 包 18s）；**但全量安装可能因代理偶发停滞卡住**（实测 electron-store 卡 20 分钟）。缓解：
   - 卡住超过 5 分钟 → `Ctrl+C` 重试；仍慢 → `npm config set registry https://registry.npmmirror.com`（已验证可达）
   - Electron 二进制：`set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
   - 提交 lockfile，团队安装用 `npm ci`
3. node-pty 等原生模块需本机编译工具链（VS Build Tools）；asarUnpack 必须包含 `.node`。

---

## 3. 整体架构设计

### 3.1 进程模型

```
┌────────────────────────────────────────────────────────────┐
│ Renderer（sandbox + contextIsolation，React + Fluent）      │
│  聊天 · 画布工作流 · 内置浏览器 UI · 设置 · 审阅 · 任务面板   │
│  window.jujia = contextBridge 白名单（一方法一通道）          │
└───────────────▲────────────────────────────────────────────┘
                │ typed IPC invoke/events（packages/shared-ipc 契约）
┌───────────────┴────────────────────────────────────────────┐
│ Main（薄路由，永不阻塞）                                     │
│  窗口/托盘 · 权限对话框 · ConfigStore（原子写）· 打开方式分发  │
│  WebContentsView 生命周期 · node-pty · shell.openExternal    │
└───────▲───────────────────────────────▲────────────────────┘
        │ utilityProcess(MessagePort)    │
┌───────┴───────────────┐   ┌────────────┴───────────────────┐
│ Agent Runtime          │   │ WebContentsView（内置浏览器）    │
│ (utilityProcess)       │   │  安全钩子：will-navigate /      │
│  agent-core: loop/工具 │   │  setWindowOpenHandler/权限请求  │
│  记忆装配 · Hooks 总线 │   └────────────────────────────────┘
│  MCP Clients(stdio)    │
│  画布执行器 · 媒体任务 │
└───────────────────────┘
```

### 3.2 通信契约

- 所有跨进程数据在 `packages/shared-ipc` 定义 zod schema；渲染层只见白名单方法。
- 流式渲染层唯一入流类型：

```ts
type StreamEvent =
  | { type: 'text_delta'; sessionId; messageId; delta: string; seq: number }
  | { type: 'thinking_delta'; sessionId; messageId; delta: string; seq: number }
  | { type: 'tool_start'; tool: string; args: unknown; toolId: string }
  | { type: 'tool_result'; toolId: string; ok: boolean; preview: string; fullRef?: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'canvas_node_state'; runId; nodeId; state: 'queued'|'running'|'ok'|'error'; message?: string }
  | { type: 'media_job'; jobId; phase: 'submitted'|'polling'|'downloading'|'done'|'failed'|'canceled'; progress?: number; assetPath?: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'done'; reason: 'final' | 'aborted' | 'max_turns' | 'error' };
```

### 3.3 数据与存储（userData/JuJiaData/）

```
JuJiaData/
  config.json            # 原子写 + .bak + version
  connections.json       # API 连接（apiKey 永不进 renderer）
  sessions/<id>/         # messages.jsonl（append-only）+ summary.md
  memory/                # core.json（pinned blocks）+ notes/*.md
  skills/                # SKILL.md 目录包
  schedules/             # 定时任务（RRULE + 抖动 + 补跑）
  workflows/             # 画布工作流图 JSON（schema v + 迁移函数）
  media/                 # 生成媒体（视频/图片）+ 缩略图 + assets.json
  browser/               # 内置浏览器 profile（会话/书签）
```

### 3.4 仓库结构（npm workspaces monorepo）

```
jujia/
  package.json                # workspaces
  packages/
    agent-core/               # loop/providers/tools/memory/hooks/events（无 Electron，可单测）
    canvas-core/              # graph/exec/serialize/history（无 Electron，可单测）
    media-cap/                # registry/jobs/assets（无 Electron，可单测）
    shared-ipc/               # IPC 与 StreamEvent 契约（zod）
    ui-tokens/                # design tokens → tokens.css
  apps/
    desktop/                  # Electron 壳
      main/  preload/  renderer/  runtime/  browser/
  scripts/  docs/  knowledge/  review/        # 现有知识库与文档随仓库走
```

### 3.5 三条关键数据流

**一次对话**：输入 → renderer invoke → main 校验 → runtime 装配上下文（system+memory blocks+窗口）→ SSE 流 → `text_delta` 逐条 IPC → renderer rAF 合批渲染 → 落盘 jsonl → `done`。

**一次工作流执行**：画布「运行」→ renderer 校验 DAG（无环/类型匹配）→ runtime 拓扑排序 → 逐节点构造子任务（多数为 agent-core 子运行）→ 每节点状态经 `canvas_node_state` 回写 → 失败节点可局部重跑 → 产物路径写回节点输出。

**一次视频生成**：UI 校验能力（registry 声明 + 探测）→ 提交任务（厂商 API）→ 任务状态机 submitted→polling→downloading→done/failed/canceled → 产物落 `media/` + 缩略图 → 面板通知。

### 3.6 安全红线（任何阶段不得违反）

- contextIsolation + sandbox 开；`nodeIntegration: false`；preload 只经 bundler
- IPC 校验 sender；渲染层零 Node 能力；apiKey 不进 renderer 全量
- 写工具一律绝对路径 + workspace resolve + 高危命令清单
- 外部链接经 `shell.openExternal` 前 scheme 白名单（http/https only）

---

## 4. 功能模块划分与说明

| # | 模块 | 职责 | 对外接口（核心） | 依赖 | 知识依据 | 验收要点 |
|---|------|------|------------------|------|----------|----------|
| M1 | 桌面壳与工程底座 | 窗口/主题/托盘/安全基线/monorepo | `createWindow`、`window.jujia` 白名单 | Electron | S4 §1–6, S5 §2–4 | 安全 checklist 全绿；冷启动 <3s |
| M2 | 连接与模型适配 | 多 Connection、preset、apiFormat 两档、模型目录 | `testConnection`、`listModels` | M12 | S7 §1–6 | DeepSeek/GLM/OpenAI/Anthropic 各连一次成功 |
| M3 | 聊天与流式 UI | 会话列表、消息、thinking 折叠、rAF 合批 | `sendMessage`、`stop` | M2/M12 | S6 §3, S5 §5/§7 | 流式时可输入；断流可重试 |
| M4 | 工具执行与权限 | 内置工具（read/write/ls/run_command/git）、权限队列 | `runTool`、permission request/resolve | M5/M12 | S1 §4–8, S6 §5 | 权限面板不闪退不自动拒；危险命令强制确认 |
| M5 | Agent Loop（agent-core） | 三分支循环、maxTurns、失败恢复、只读子代理 | `runAgentTurn` | M2/M4/M6 | S1 §1–10, S2 §11–18 | 循环有界；工具错误回模型可恢复 |
| M6 | 记忆与上下文 | core blocks、notes、压缩 handoff、评估脚本 | `assembleContext`、`compact` | M12 | S3 §1–10 | 重启后能回忆偏好；压缩后有 UI 提示 |
| M7 | 扩展生态 | MCP Host、Skills、Hooks、定时任务 | `mcp.list/call`、`skills.install`、`schedule.*` | M5 | S2 §1–12 | 挂 filesystem server；装 1 个 Skill；跑 1 个定时 |
| M8 | 终端与 Git | xterm 终端、git status/diff/commit 队列 | `pty.write/resize`、`git.*` | M1/M4 | S4 §9, F6 | 终端可交互；diff 懒加载 |
| M9 | **无限画布工作流** | 节点/连线/DAG 校验/对齐吸附/替代交互/执行/持久化 | `canvas.*`（graph/exec/serialize） | M5/M12 | S9 §86–94 | §6 P4 验收表全绿 |
| M10 | **内置浏览器与文档** | WebContentsView、安全钩子、打开方式三档、PDF/MD 查看 | `browser.open/nav`、`docs.open` | M1 | S10 §95–99 | §6 P4 验收表全绿 |
| M11 | **多模态与媒体** | capability registry、视频生成任务、媒体资产、任务面板 | `capabilities.check`、`media.submit/cancel` | M2/M12 | S11 §100–104 | §6 P5 验收表全绿 |
| M12 | 基础设施 | json-store 原子写、日志、崩溃恢复、自动更新、测试 | `json-store`、`logger` | — | S4 §10–12, S3 §10 | 半截写入模拟可自愈 |

---

## 5. 开发阶段划分与里程碑

| 阶段 | 周期 | 主题 | 里程碑 | 出口条件 |
|------|------|------|--------|----------|
| P0 | W0 | 环境与脚手架 | M0 | monorepo 起得来、CI 绿、依赖装得上 |
| P1 | W1–W5 | 可用内核 | M1（W2 末）· M2（W5 末） | 能连模型流式对话；能控改代码 |
| P2 | W6–W9 | 体验与性能 | M3（W8 末） | UI 不卡；记忆闭环 |
| P3 | W10–W12 | 扩展生态与发布 | M4（W11 末） | MCP/Skills/定时可用；portable 可发布 |
| P4 | W13–W15 | **画布与浏览器** | M5a（W15 末） | §6 P4 验收全绿 |
| P5 | W5c | **自定义权限规则表**（allow/deny/ask + 参数 glob + 即时生效） | 规则表 | 写一条 deny 后立刻被拦 |
| W5d | **钩子四类齐备**（PreToolUse/PostToolUse/Stop/SessionStart） | 钩子注册表 | 四类均可挂载且拒绝生效 |
| W17 | **主题与背景自定义**（背景图/纯色/毛玻璃/透明度 + 持久化） | ui-tokens + 设置页 | 立即生效且重启保留 |
| W19 | **轻量 IDE MVP**：文件树 + CodeMirror 6 编辑器 + diff 视图（与 Agent 共用工作区句柄） | `features/ide` | 能开文件/编辑/看 diff/保存 |
| W20 | **远程主机接入**：SSH 或出站隧道 + **首次指纹确认** + 凭据保管（密钥不出本机） | `packages/remote` | 连上真实主机并列目录；匿名连接一律拒绝 |
| W21 | **云端 agent worker**：远端运行时 + 完整工具链 harness + 证据回传（diff/日志/截图） | `packages/remote-worker` | 远端跑通「读→改→测试」并回传证据 |
| W22 | **调度与切换**：确定性路由规则 + 迁移（显式确认）+ 断点续跑 + 任务面板 | `packages/orchestrator` | 长任务本地发起→迁云端→迁回并汇总 |
| W23 | **外观系统**：对话框样式包 + 背景（纯色/图/毛玻璃/透明度）+ 对比度守护 + 导入导出 | `packages/ui-tokens` + 设置页 | 切换即时生效、重启保留、可导出 |
| W18 | **多子 agent 编排与长任务续跑**（并发派发/分工/汇总/各自权限 + 断点续跑） | agent-core/orchestrator | 并发派 3 个子代理并汇总；中断可续 |
| W16 | **多模态能力门控** | M5b（W16 末） | §6 P5 验收全绿 |

### 里程碑验收清单

**M1 冷启动通路（W2 末）**：Connection 测试成功；流式回复；杀进程重启配置完好。

**M2 可控改代码（W5 末）**：让 Agent 创建 `hello.md`；权限面板正确出现且不闪退；工具卡可展开。

**M3 学习闭环（W8 末）**：重启能回忆偏好；长对话触发压缩且有提示；流式无可感卡顿（自测记录）。

**M4 可扩展（W11 末）**：挂 MCP filesystem（限定目录）；装 1 个本地 Skill 按需加载；1 个每日定时执行过。

**M5a 画布与浏览器（W15 末）**：

- [ ] 侧边栏拖出 3 类节点连成工作流并成功执行，节点状态回写正确
- [ ] 连成环被阻止且提示明确；类型不匹配的连线被拒绝
- [ ] 右键空白可建节点；从端口拖线到目标端口即连线；双击空白快捷建节点
- [ ] 多选节点可对齐/等距分布；网格吸附可开关
- [ ] 工作流保存→重启→加载无误；手改 schema version 触发迁移
- [ ] 内置浏览器可浏览；「用系统默认浏览器打开」与「自选浏览器打开」均生效并记住选择
- [ ] PDF 与 Markdown 文档可在应用内打开且长文档不卡

**M5b 多模态（W16 末）**：

- [ ] 未配置视频模型时，视频入口呈禁用态并悬停说明原因
- [ ] 配置可灵/即梦/万相等任一后，提交→进度→产物播放→历史回看全链路可走
- [ ] 任务可取消；失败可重试；产物落 `media/` 且有缩略图
- [ ] Sora preset 因官方弃用被动态下线（模拟：能力声明返回 false）

---

## 6. 各阶段任务清单与验收标准

> 通用 DoD：`tsc --noEmit` 过；新增逻辑有单测；e2e 冒烟不回归；知识卡片 ≥3 张写进 `knowledge/cards/`；当周计划勾选回写本文档。

### P0 · W0 环境与脚手架

| 任务 | 产出 | 验收标准 |
|------|------|----------|
| 安装工具链（Node 22、VS Build Tools、Git） | 环境清单笔记 | `node -v`/`npm -v`/`git --version` 正常 |
| 初始化 monorepo（workspaces + tsconfig 严格模式 + eslint） | 仓库骨架 | `npm i` 一次通过；`npm run lint` 绿 |
| Electron 空壳 + electron-vite + 安全基线窗口 | `apps/desktop` 可跑 | `npm run dev` 出白窗口；DevTools 无安全警告 |
| CI（GitHub Actions：lint+typecheck+test） | workflow 文件 | push 后 CI 全绿 |
| 引入 xyflow/media 依赖做安装演练 | 依赖记录 | 全量安装卡住时的重试/镜像流程验证过 |

### P1 · W1–W5 可用内核

> 进度（**以 CHANGELOG 与 git 标签为准，本行为摘要**）：
> P0 ✅ `v0.1.0-p0` · W1 ✅ `v0.1.1-w1` · W2 ✅ `v0.2.0-w2`（复核 002 → `v0.2.2-review`）·
> W3 ✅ `v0.3.0-w3`（路径沙箱 + 文件工具 + 写门禁）· W4 ✅ `v0.4.0-w4`（三分支 Agent Loop）·
> W5a ✅ `v0.5.0-w5a`（权限分级）· W5b ✅ `v0.5.3-w5b`（**M2 打通**：对话页走 Loop + 审批 edit）·
> W6 ✅ `v0.6.1-w6`（令牌 + 动效 + 工具卡 L0–L2 + 四态）· W7 ✅ `v0.7.0-w7`（**启动性能实测 589ms**）·
> W8 ✅ `v0.8.0-w8`（记忆 MVP：AGENTS.md + NOTES.md）· W23a ✅ `v0.8.2-w23a`（外观样式包）·
> W9a ✅ `v0.9.0-w9a`（git 队列与 diff 审阅）· **W12 部分 ✅ `v0.9.1-pack`（安装包已产出并发布 Release）**
> 复核：001–007 全部通过（变异测试合计 21/21 被拦住）· 测试规模 **229 例全绿**
> 下一步：W9b（PTY 终端，需装 node-pty）或 W23 第二部分（外观设置页）

| 周 | 任务 | 产出 | 验收标准 |
|----|------|------|----------|
| W1 | json-store（tmp+rename+.bak+version）+ 单测；typed preload 桥 | `packages/shared`、`shared-ipc` | 半截写入模拟可自愈；IPC 契约 zod 校验 |
| W2 | Connection UI + OpenAI-compatible SSE 流式（main 侧解析） | 聊天空壳能对话 | M1 全绿；DeepSeek 实测流式 |
| W3 | 工作区选择 + 文件工具（绝对路径 + sandbox 校验 + 写门禁） | `agent-core/tools` | 工作区外写入被拒且有提示 |
| W4 | 三分支 Agent Loop + maxTurns + 工具串行执行 | `agent-core/loop` | 单测覆盖 final/handoff/tool 三分支与熔断 |
| W5 | 权限队列（idle→pending→allow once/always/deny/timeout）+ PreToolUse hook | 权限面板 | **永不自动 reject**；timeout 文案区分用户拒绝 vs 超时；M2 全绿 |

### P2 · W6–W9 体验与性能

| 周 | 任务 | 产出 | 验收标准 |
|----|------|------|----------|
| W6 | Fluent 组件接入、tokens.css、工具卡 L0–L2、四态 | UI 规范落地 | 颜色零硬编码；每表面四态齐全 |
| W7 | 虚拟列表（react-window）、delta 合批、懒加载、tracing 报告 | 性能笔记 | 长会话滚动 60fps（DevTools 录制佐证） |
| W8 | 记忆 MVP：blocks + NOTES.md + 压缩 handoff | `agent-core/memory` | M3 全绿；压缩前后关键事实对照清单 |
| W9 | xterm 终端（**官方 node-pty + @electron/rebuild**，见卡片 016；预编译自带，通常无需 Build Tools；失败则退 @lydell/node-pty）；git 队列与审阅 diff 懒加载 | 终端/审阅面板 | 终端可交互；diff 打开才加载 |

### P3 · W10–W12 扩展生态与发布

| 周 | 任务 | 产出 | 验收标准 |
|----|------|------|----------|
| W10 | MCP Host（stdio 优先，`cmd /c npx` 适配 Windows）+ 同意 UI | M7 一部分 | 挂 filesystem server 限定目录 |
| W11 | Skills（SKILL.md 渐进披露）+ 定时任务（RRULE+抖动+补跑） | M7 完成 | M4 全绿 |
| W12 | electron-builder nsis+portable；崩溃可见错误态；版本/README 一致 | 可发布产物 | 他机安装可跑；「永远工作中」Bug=0 |

### P4 · W13–W15 画布与浏览器（对应 M9/M10）

| 周 | 任务 | 产出 | 验收标准 |
|----|------|------|----------|
| W13 | xyflow 集成：viewport/缩放/平移；节点模型（步骤=提示词/工具/子代理）；侧边栏拖拽建节点；Handle 连线 + `isValidConnection`（类型匹配 + **环检测**） | `packages/canvas-core` | 千节点平移不卡（官方 performance 指南落地）；环被拒绝 |
| W14 | 对齐辅助线 + 网格吸附 + 等距分布；右键上下文菜单；双击快捷建节点；拖线即连；命令面板；拓扑执行器 + 状态回写 + 局部重跑 | 画布交互完整版 | §5 M5a 前 4 条全绿 |
| W15 | 图 JSON schema + version + 迁移；导入/导出；WebContentsView 内置浏览器 + 安全钩子；打开方式三档（内置/系统默认/自选 exe，设置页记住）；PDF.js/Markdown 查看器 | M9/M10 完成 | §5 M5a 全绿 |

### P5 · W16 多模态与能力门控（对应 M11）

| 任务 | 产出 | 验收标准 |
|------|------|----------|
| capability registry：连接/模型级声明 + 运行时探测 + 失败兜底 | `packages/media-cap` | 不满足能力 → 入口禁用 + 原因；探测异常有兜底 |
| 视频生成任务状态机（提交→轮询→下载→done/failed/canceled）+ 可灵/即梦/万相适配 | 厂商 preset ×3 | M5b 全绿；Sora preset 动态下线演练通过 |
| 媒体资产（落盘/缩略图/播放器/配额清理）+ 后台任务面板 | 任务面板 | 产物可播放；历史可回看 |
| 收尾：对照知识地图自测、清理、打包、v0.6 tag | 发布 | 里程碑全部勾完 |

---

## 7. 潜在风险及应对方案

| # | 风险 | 等级 | 应对 |
|---|------|------|------|
| 1 | 代理网络不稳：npm 全量安装卡死、Electron 二进制下载失败 | 高 | lockfile + `npm ci`；卡 5 分钟即重试；npmmirror + `ELECTRON_MIRROR` 兜底（§2.3 已验证可达）；CI 里预拉缓存 |
| 2 | 范围膨胀（想抄全 Yan / 画布自研底层） | 高 | 严格按 §6 周表交付；画布明确不自研（§2.2）；砍功能优先于砍质量 |
| 3 | 模型 API 变更（实例：OpenAI Sora API 2026-09-24 弃用） | 高 | Connection/preset 抽象；能力声明与代码解耦（JSON 可热改）；弃用 preset 动态下线并引导替代厂商 |
| 4 | 权限/路径事故（写错盘、删错文件） | 高 | 绝对路径 + workspace resolve + 高危命令清单 + 权限队列永不自动拒 + PreToolUse deny |
| 5 | 画布大规模节点卡顿 | 中 | xyflow 官方性能指南（视口裁剪、节点 memo、避免每帧 setState）；>1k 节点压测脚本；超出再议 Canvas 渲染层 |
| 6 | Electron 渲染卡顿（Yan 的老问题） | 中 | 性能预算写进 DoD（流式可输入/60fps 录制佐证）；rAF 合批；虚拟列表；main 零同步 IO |
| 7 | 内置浏览器引入安全面（恶意网页） | 中 | `setWindowOpenHandler` 一律拒绝或转系统浏览器；will-navigate 白名单；权限请求默认拒绝；scheme 白名单（S10 §96） |
| 8 | 能力门控误判（声明说有、实际没有） | 中 | 声明 + 探测双保险；探测失败走兜底提示而非崩溃；厂商 preset JSON 化便于热修 |
| 9 | 配置/会话损坏 | 中 | json-store 单测模拟半截写入；.bak 自愈 |
| 10 | 单文件巨石回潮 | 中 | ESLint 行数上限（main ≤300 行、单文件 ≤800 行）+ CI |
| 11 | 学习时间与课业冲突 | 中 | 周表允许 ±1 周滑动；里程碑验收不减配 |
| 12 | 厂商 SDK/文档链接失效 | 低 | 知识库已有 URL 校验脚本；每阶段开工前跑一遍当簇来源链接 |

---

## 8. 设计稿与界面说明

### 8.1 Design Tokens（`packages/ui-tokens`，语义命名，禁止组件内写 hex）

| 类别 | Token（语义名） | 亮色建议值 | 暗色建议值 |
|------|-----------------|-----------|-----------|
| 表面 | `--bg-layout / --bg-container / --bg-elevated` | #f8f8f8 / #ffffff / #ffffff | #141414 / #1f1f1f / #262626 |
| 文本 | `--text / --text-secondary / --text-tertiary` | #080808 / #595959 / #8c8c8c | #f5f5f5 / #a6a6a6 / #6e6e6e |
| 品牌/状态 | `--primary / --success / --warning / --danger` | #222 / #379d4a / #d48806 / #cf222e | 同左（亮一档） |
| 描边/填充 | `--border / --fill-tertiary` | rgba(0,0,0,.12) / rgba(0,0,0,.06) | rgba(255,255,255,.14) / rgba(255,255,255,.08) |
| 画布 | `--canvas-dot / --align-guide` | rgba(0,0,0,.18) / #7c5cff | rgba(255,255,255,.22) / #a58cff |
| 动效 | `--motion-fast / --motion-panel` | 120ms / 240ms（缓动 cubic-bezier(0.2,0,0,1)） | 同左 |

规则：动效 100–200ms 微交互、200–300ms 面板；全局尊重 `prefers-reduced-motion`（S6 §8）。

### 8.2 主窗口（聊天）

```
┌───────────────────────────────────────────────────────────────┐
│ 俱佳Agent          [会话▾]                    ⚙ 设置  ─ □ ✕   │
├───────────┬───────────────────────────────────────────────────┤
│ 会话列表   │  消息流（虚拟列表）                                 │
│ (可折叠)   │  ┌─────────────────────────────────────────────┐  │
│ + 新会话   │  │ 用户：帮我看看这个报错 …                      │  │
│ 工作区:    │  └─────────────────────────────────────────────┘  │
│  D:\proj   │  ┌ Agent ─────────────────────────────────────┐   │
├───────────┤  │ ▸ 思考（thinking，折叠）                      │   │
│ 工具栏     │  │ ▸ 工具 read_file D:\proj\main.py ✓ 0.8s     │   │
│ 📎 文件    │  │   L0 一行摘要 → 点击展开 L2 抽屉（参数/结果） │   │
│ 🖼 画布    │  │ 结论：这是 xxx 问题，建议 …（流式文本）        │   │
│ 🌐 浏览器  │  └─────────────────────────────────────────────┘  │
│ ⏱ 任务(1)  │───────────────────────────────────────────────────│
├───────────┤  [输入框 ……………………………………] [发送] [停止]     │
│ 状态: 就绪 │  模型: deepseek-chat ▾   ⚠ 高危命令需确认          │
└───────────┴───────────────────────────────────────────────────┘
```

交互约定：流式时输入框**始终可输入**；错误 MessageBar 带重试 CTA；工具卡 L0 永远一行。

### 8.3 无限画布工作流编辑器

```
┌──────────────────────────────────────────────────────────────────┐
│ ← 返回  工作流: 周报生成           ▶ 运行   💾 保存   ↺ ↪   🔍75% │
├────────┬─────────────────────────────────────────────────────────┤
│ 节点库  │              无限画布（点阵背景 · 可无限平移缩放）          │
│ ┌────┐ │        ┌──────────────┐         ┌──────────────┐        │
│ │输入 │ │  ┌───▶│ ② LLM: 总结   │────────▶│ ③ 工具: 写文件│───┐    │
│ └────┘ │  │    │ ● running     │         │ ○ queued     │   │    │
│ ┌────┐ │  │    └──────────────┘         └──────────────┘   ▼    │
│ │LLM │ │ ┌──────────────┐         ┌──────────────┐  ┌────────┐  │
│ └────┘ │ │ ① 输入: 文件  │         │ 对齐辅助线    │  │ ④ 输出 │  │
│ ┌────┐ │ │ ● ok  0.2s   │◀─ 吸附 ─│  — — — —     │  └────────┘  │
│ │工具 │ │ └──────────────┘         └──────────────┘              │
│ └────┘ │                                                          │
├────────┴──────────────────────────────────────────────────────────┤
│ 状态栏: 12 节点 · 11 边 · 上次运行 8.3s ✓    [网格吸附 ●] [对齐 ●] │
└──────────────────────────────────────────────────────────────────┘
```

**节点**：头（图标+名称+状态点）+ 正文（参数摘要）+ 底部输出端口；输入端口在左、输出在右（Handle）。
**右键菜单（空白处）**：在此创建 ▸（输入/LLM/工具/子代理/输出）、粘贴、全选、运行到此处。
**右键菜单（节点上）**：运行此节点、复制、重命名、删除、断开所有连线。
**连线**：从输出端口拖到输入端口即连（`isValidConnection` 校验类型 + 环）；点击连线可删除；重连拖端点。
**快捷键**：`双击空白`=快捷建节点 · `Ctrl+Z/Y`=撤销重做 · `Ctrl+A` 全选 · `Del` 删除 · `Space+拖`=平移 · `Ctrl+滚轮`=缩放 · `Shift+多选` · `Ctrl+L`=对齐 · `Ctrl+D`=等距分布 · `Ctrl+Enter`=运行。
**执行可视化**：节点状态点 队列○ / 运行●(脉冲动画) / 成功✓ / 失败✗(点击看错误)；边在数据到达时流动画一次。

### 8.4 内置浏览器面板与「打开方式」

```
┌───────────────────────────────────────────────────────────┐
│ [←][→][⟳] [ https://example.com/docs ………… ] [⇪ 系统浏览器▾] │
├───────────────────────────────────────────────────────────┤
│                                                           │
│              WebContentsView 网页内容                      │
│                                                           │
├───────────────────────────────────────────────────────────┤
│ 🔒 example.com   ⊕ 新标签   ⤢ 在新窗口打开   [在 Agent 中引用]│
└───────────────────────────────────────────────────────────┘
```

**打开方式三档**（地址栏右侧下拉，选择后记住为默认）：
1. 内置打开（默认）：WebContentsView，安全钩子全开
2. 系统默认浏览器：`shell.openExternal`（仅 http/https）
3. 自选本机浏览器：设置页指定 exe 路径（如 Chrome/Edge），以 URL 参数启动

**决策流**：页面内点击外部链接 → 白名单内域名内置打开；新窗口请求 → `setWindowOpenHandler` 拒绝并提示「已转系统浏览器」；非 http(s) scheme → 一律拒绝 + MessageBar 说明。

### 8.5 权限审批弹窗（状态机见 §3.6/旧 PLAN，禁止自动拒绝）

```
        ┌─────────────────────────────────────────────┐
        │ ⚠ 需要你的确认                                │
        │                                             │
        │ 工具: run_command                            │
        │ 命令: npm install --save-dev vitest          │
        │ 工作区: D:\proj\jujia                        │
        │                                             │
        │ [ 允许本次 ]  [ 总是允许此类 ]  [ 拒绝 ]      │
        │ 10:00 内未响应将按「超时」处理（可在设置改）   │
        └─────────────────────────────────────────────┘
```

文案必须区分：`user_allow_once / user_allow_always / user_deny / timeout` 四种结果，事件流可见（S6 §5）。

### 8.6 设置页

| 分区 | 内容 |
|------|------|
| 连接 | Connection 列表（名称/baseURL/apiKey/preset/测试按钮）；preset=auto/deepseek/glm/openai/anthropic… |
| 浏览器 | 打开方式默认档；自选浏览器 exe 路径（文件选择器）；「始终用系统浏览器打开外部链接」开关 |
| 多模态 | 各厂商视频/图像 API key 与能力开关；**每行显示探测状态徽标（可用/不可用/未配置）** |
| 权限 | 高危命令清单；超时默认行为；总是允许记录管理 |
| 性能 | 网格吸附/动画开关；`prefers-reduced-motion` 显示当前系统值 |

### 8.7 后台任务面板（视频生成等）

```
┌ 任务面板 ───────────────────────────────────────────────┐
│ ▶ 视频生成 #18  可灵 kling-v2  [██████░░░░ 60%] 轮询中   │
│    prompt: "城市夜景延时…"  时长5s 1080p   [取消]        │
│ ✓ 视频 #17  即梦      00:12  → media/2026-09/xxx.mp4    │
│    [播放] [打开所在文件夹] [删除]                         │
│ ✗ 视频 #16  超时(上游 504)  [重试] [查看日志]            │
└──────────────────────────────────────────────────────────┘
```

状态机：`submitted → polling → downloading → done | failed | canceled`；失败可重试（新 jobId）；产物必落盘 + 缩略图。

### 8.8 能力门控判定流（M11 核心）

```
用户点击「视频生成」
   → capabilities.check(connection, 'video-gen')
      ├─ 声明=无           → 按钮禁用态 + tooltip「当前模型未声明视频能力，请在设置添加厂商」
      ├─ 声明=有 → 探测     → 成功 → 打开生成面板
      │                     → 失败 → MessageBar「探测失败(原因)，可强制尝试」→ 用户确认后继续
      └─ 运行中厂商公告下线  → 动态下线 preset + 面板提示替代厂商
```

### 8.9 组件规范（沿用调研结论）

- **工具卡 L0/L1/L2**：一行摘要 → 卡片（工具名+耗时+关键参数）→ Drawer（完整 args/日志/diff）
- **四态**：每个表面 empty/loading/error/success 必须齐备（空态带 CTA）
- **反馈三分工**：MessageBar=本表面状态（带 CTA）；Toast=异步/他处事件；Dialog=危险阻断
- **可访问性**：MessageBar `aria-live` 分级；弹窗焦点陷阱；对比度 ≥ 4.5:1

---

## 9. 附录

### 9.1 模块 → 知识库映射

| 模块 | findings | sources |
|------|----------|---------|
| M1/M8/M12 | F5、F6、FYAN | S4 §1–12、S5 §1–10、S8 §81–85 |
| M2/M3 | F8 | S7 §1–10 |
| M4/M5 | F1、F2 | S1 §1–18 |
| M6 | F4 | S3 §1–10 |
| M7 | F3 | S2 §1–12 |
| M9 | — | S9 §86–94 |
| M10 | — | S10 §95–99 |
| M11 | — | S11 §100–104 |
| UI 全局 | F7 | S6 §1–12 |

逐条来源查 `knowledge/SOURCE-MATRIX.md`。

### 9.2 工程规约

- 提交：`feat/fix/chore(scope): why`；禁止无说明大包上传
- 目录：`renderer` 按 feature 分包（`features/chat`、`features/canvas`、`features/browser`…）
- 每周交付可运行增量 + ≥3 张知识卡片 + PLAN 勾选
- **每次任务/开发收尾：`python scripts/cleanup.py`**（项目记忆固定约定）

### 9.3 交付物清单（随仓库演进）

v0.6 时应存在：可安装的 Windows 包（nsis+portable）、`packages/*` 全部带单测、e2e 冒烟套件、
本 PLAN 勾选完毕、`knowledge/cards/` ≥40 张、`review/` 每阶段一份阶段复盘。
