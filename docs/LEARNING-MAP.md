# 俱佳Agent · 知识地图与学习资源（108 领域）

> 配合 `knowledge/findings/` 与 `knowledge/sources/` 使用：每条主题优先学习「权威文档 → 开源实现 → 论文/工程博客 → 可运行实验」。
> #81–104 为两轮增补领域，五类来源统一查 `knowledge/SOURCE-MATRIX.md`。

---

## 1. Agent 机制与设计（10）

| # | 主题 | 关键点 | 优先资源 |
|---|------|--------|----------|
| 1 | ReAct 模式 | 推理+动作交错 | P: arXiv 2210.03629 [F1] |
| 2 | Agent Loop 三分支 | final / handoff / tool 回环 | D: OpenAI Agents SDK · Claude Agent SDK loop docs [F1] |
| 3 | Workflow vs Agent | 最简够用原则 | D: Anthropic Building Effective Agents [F1] |
| 4 | Tool Calling / Function Calling | schema、并行、错误回模型 | D: OpenAI Agents SDK tools [F1] |
| 5 | Tool ACI 设计 | 绝对路径、防呆参数 | C: Anthropic SWE-bench 工具优化 [F1] |
| 6 | Evaluator-Optimizer | 生成与验收分离 | D: Anthropic workflows [F1] |
| 7 | 目标验收 / 测试反馈 | 测试为环境真值 | D/C: Anthropic coding agents 段落 [F1] |
| 9 | Context Engineering | attention budget、JIT 检索 | C: Anthropic effective context engineering [F1/F4] |
| 10 | 状态机与预算 | max_turns、graph 节点、HITL | D: LangGraph overview [F1] |

## 2. 多 Agent / 子代理（8）

| # | 主题 | 关键点 | 资源 |
|---|------|--------|------|
| 13 | agents-as-tools vs handoff | `as_tool` vs `transfer_to_*` | D: OpenAI multi_agent/handoffs [F2] |
| 14 | Orchestrator-Worker | Lead 规划→并行→综合 | D: Anthropic research system [F2] |
| 16 | 并发槽与成本 | 3–5 槽；15× token | C: Anthropic metrics [F2] |
| 17 | Artifact 交接 | 磁盘产物+路径哈希 | C: Anthropic telephone 避免 [F2] |

## 3. 技能 / 钩子 / 定时 / 连接（12）

| # | 主题 | 关键点 | 资源 |
|---|------|--------|------|
| 19 | MCP 协议总览 | JSON-RPC 2.0 Host/Client/Server | D: modelcontextprotocol.io [F3] |
| 20 | MCP Tools/Resources/Prompts | 三原语 + Elicitation | D: MCP spec [F3] |
| 21 | stdio vs Streamable HTTP | Windows `cmd /c npx` | D: MCP transports [F3] |
| 22 | MCP 安全 | 同意 UI、token 不转发、Origin 校验 | D: MCP security best practices [F3] |
| 23 | MCP Registry / 官方 server | 参考实现非生产 | O: github.com/modelcontextprotocol/servers [F3] |
| 24 | Agent Skills 标准 | SKILL.md + 渐进披露 | D: agentskills.io [F3] |
| 27 | 桌面定时任务 | RRULE、抖动、补跑一次 | D: Claude Desktop scheduled tasks [F3] |
| 28 | 定时=Skill+schedule | 磁盘持久化 | D: scheduled-tasks SKILL.md 模式 [F3] |
| 30 | Skills over MCP | SEP-2640 / skill:// | D: MCP WG [F3] |

## 4. 记忆与上下文（10）

| # | 主题 | 关键点 | 资源 |
|---|------|--------|------|
| 31 | 短期 vs 长期记忆 | 会话窗口 vs 跨会话 | P: MemGPT [F4] |
| 32 | Memory Blocks | pinned + 可编辑 + 共享 | D: Letta memory [F4] |
| 33 | 归档检索 | 淘汰后仍可读盘 | D: Letta [F4] |
| 34 | 结构化笔记 | NOTES / todo 外置 | C: Anthropic context engineering [F4] |
| 35 | Handoff packet | ~2k token 摘要交接 | C: Anthropic [F4] |
| 37 | RAG vs Agent Memory | 文档检索 vs 写路径抽取 | P: Zep Graphiti [F4] |
| 38 | Mem0 写管线 | extract/consolidate/retrieve | P: arXiv 2504.19413 [F4] |
| 39 | 记忆评估 | LOCOMO / LongMemEval | P: F4 |
| 40 | 原子 JSON 落盘 | tmp+rename+version | D: cards/003（原子写 + 自愈） |

## 5. 系统架构与 Electron（12）

| # | 主题 | 关键点 | 资源 |
|---|------|--------|------|
| 41 | 进程模型 | main + renderer/window | D: Electron process model [F5] |
| 42 | contextIsolation | 默认开 | D: Electron context isolation [F5] |
| 43 | Preload 桥 | contextBridge 一方法一通道 | D: Electron [F5] |
| 44 | Sandbox | 默认开；preload 用 bundler | D: Electron sandbox [F5] |
| 45 | IPC invoke/handle vs send | 契约化错误对象 | D: Electron IPC [F5] |
| 46 | Security Checklist | 20 条；校验 sender | D: Electron security [F5] |
| 47 | UtilityProcess | 优于 child_process.fork | D: Electron utility-process [F5] |
| 49 | 内置终端 | xterm.js + node-pty | D: cards/016（终端选型，含 8 个来源） |
| 50 | electron-builder | nsis/portable、asarUnpack | D: electron-builder · cards/016（打包与 rebuild 结论） |
| 51 | 原生模块 | 禁止进 sandboxed renderer | D: Electron security |

## 6. 性能 / 缓存 / 预加载 / 流畅（10）

> 来源：`knowledge/sources/S5-performance.md`（`S5 §N` 按该文件的主题序号）+ `knowledge/findings/F6.md`。

| # | 主题 | 关键点 | 资源 |
|---|------|--------|------|
| 53 | Measure First | DevTools + about:tracing | D: Electron performance / Chromium tracing [F6] |
| 54 | 延迟加载模块 | Windows require 很贵 | D: Electron performance [F6] |
| 55 | main/preload 打包 | 单文件减少 require | D: Electron performance [F6] |
| 56 | 禁止阻塞 main | 无 sendSync / 同步 fs | D: Electron performance [F6] |
| 57 | 流式事件批处理 | rAF / 32–50ms | C/D: F6 |
| 58 | 虚拟列表 | react-window + overscan | O: bvaughn/react-window [F6] |
| 59 | IPC 只传 delta | Structured Clone 成本 | D: Electron IPC [F6] |
| 60 | 配置内存缓存 | 热路径禁 normalize-on-read | S5 §8 |
| 61 | 分层缓存 SWR | 目录/技能/设置 | C: F6 |
| 62 | 内存泄漏 | 可退订监听、清理 interval | S5 §10 |

## 7. UI / UX / 视觉 / 动效 / 组件（10）

| # | 主题 | 关键点 | 资源 |
|---|------|--------|------|
| 63 | Design Tokens 三层 | ref→sys→comp | D: M3 tokens · LobeHub DESIGN.md [F7] |
| 64 | Fluent UI React v9 | Windows 气质组件库 | D: fluent2.microsoft.design [F7] |
| 65 | 聊天信息架构 | 消息/工具/思考分层 | O: Open WebUI / LobeHub [F7] |
| 66 | 工具卡 L0–L2 | 渐进披露 | D/C: NN/g + Agent UI 实践 [F7] |
| 67 | 权限审批 UI | 动词+名词、不自动拒 | D: Fluent MessageBar · cards/002（禁止自动拒绝） |
| 68 | 四态设计 | empty/loading/error/success | C: NN/g [F7] |
| 69 | MessageBar vs Toast vs Dialog | 反馈三分工 | D: Fluent 2 [F7] |
| 70 | 动效预算 | 100–300ms + reduced-motion | D: M3 motion · F7 |
| 71 | 可访问性 | aria-live、焦点陷阱 | D: Fluent/NNg [F7] |
| 72 | 桌面密度与文案 | 统一动词、点名变更 | O: LobeHub DESIGN.md [F7] |

## 8. 模型适配与产品工程（8+）

> 来源：`knowledge/sources/S7-model.md`（§ 编号按该文件的主题序号，非领域号）。
> 本簇结论**未单独成 findings 文档**，综合结论见 `knowledge/REPORT.md`（见 `knowledge/README.md` 的簇对照表）。

| # | 主题 | 关键点 | 资源 |
|---|------|--------|------|
| 74 | Anthropic Messages | blocks 历史、thinking 回传 | S7 §2 |
| 75 | SSE 流式 | main 侧解析、事件枚举 | S7 §3 |
| 76 | reasoning_content | 与正文分离，禁当交付 | S7 §4 |
| 77 | 多连接 Connection | apiFormat 两档 | S7 §5 |
| 78 | 模型目录与回退 | API 权威、标注过期 | S7 §6 |
| 80 | 安全边界 | 工作区沙箱、权限门禁 | S7 §8 · D: Electron security checklist |

---

## 9. 预加载 / 启动 / 体积 / 内存 / 功耗（5）——第一轮新增

> 来源：`knowledge/sources/S8-preload-appopt.md`。用户点名「预加载 / 内存优化 / 应用优化」，
> brief 的 F6 角度也写了，但 #53–62 未落条目，故补齐。注意 #81 与 #54 是**相反方向**的技术，取舍见 S8。

| # | 主题 | 关键点 | 资源 |
|---|------|--------|------|
| 81 | 预加载与预热 | preload/prefetch/warm start；预取配置与模型目录、预创建窗口、V8 code cache；与懒加载的边界 | S8 §81 |
| 82 | 应用启动优化 | 冷启动拆分、splash、`app.whenReady` 前置工作、启动耗时测量 | S8 §82 |
| 83 | 包体积与构建优化 | bundle size、代码分割、asar/asarUnpack、locales 裁剪 | S8 §83 |
| 84 | 内存优化与占用治理 | 内存基线、`process.memoryUsage()`、GPU 显存、缓存驱逐 | S8 §84 |
| 85 | 功耗与后台行为 | backgroundThrottling、隐藏窗口行为、轮询改事件驱动 | S8 §85 |

## 10. 无限画布与工作流节点编排（9）——第二轮新增（用户硬需求）

> 来源：`knowledge/sources/S9-canvas-workflow.md`。支撑「用户自行搭建工作流的无限画布」。

| # | 主题 | 关键点 | 资源 |
|---|------|--------|------|
| 86 | 视口变换与坐标系 | 世界坐标↔屏幕坐标、缩放/平移、DPR、矩阵变换、惯性滚动 | S9 §86 |
| 87 | 节点模型与拖拽创建 | 节点 schema、端口 port、类型系统、拖拽落点建节点、尺寸自适应 | S9 §87 |
| 88 | 连线模型与合法性校验 | 贝塞尔/正交路径、锚点与重连、类型匹配、DAG 环检测 | S9 §88 |
| 89 | 节点对齐与吸附 | 对齐辅助线、网格吸附、等距分布、多选对齐、吸附阈值 | S9 §89 |
| 90 | 画布替代交互 | 右键上下文菜单、快捷添加节点、拖线即连、快捷键体系、命令面板 | S9 §90 |
| 91 | 工作流执行语义 | 拓扑排序、数据流 vs 控制流、条件分支/循环、错误传播、局部重跑 | S9 §91 |
| 92 | 持久化与版本迁移 | 图序列化 schema、版本迁移、导入导出、分享 | S9 §92 |
| 93 | 画布渲染性能 | 视口裁剪/虚拟化、SVG vs Canvas vs WebGL、增量渲染 | S9 §93 |
| 94 | 撤销重做与协同 | command pattern、历史栈、CRDT/OT、Yjs | S9 §94 |

## 11. 内置浏览器与文档查看（5）——第二轮新增（用户硬需求）

> 来源：`knowledge/sources/S10-browser-docs.md`。内置浏览器默认实现 + 可选系统默认浏览器。

| # | 主题 | 关键点 | 资源 |
|---|------|--------|------|
| 95 | 内嵌 Web 内容三形态 | webview / BrowserView / WebContentsView 演进与选型 | S10 §95 |
| 96 | 内置浏览器安全 | will-navigate、setWindowOpenHandler、权限请求、下载拦截 | S10 §96 |
| 97 | 外部打开与浏览器选择 | shell.openExternal、系统默认浏览器、自选浏览器路径、scheme 白名单；「内置 vs 系统」取舍标准 | S10 §97 |
| 98 | 内置文档查看 | PDF.js 与 Chromium 内置、Markdown 渲染、长文档虚拟滚动 | S10 §98 |
| 99 | Agent 与内置浏览器协同 | DOM 读取、截图、executeJavaScript 边界、CDP 接入 | S10 §99 |

## 12. 多模态能力适配与视频生成（5）——第二轮新增（用户硬需求）

> 来源：`knowledge/sources/S11-multimodal-video.md`。此类功能**依赖用户自配的模型能力，仅在能力满足时可用**。

| # | 主题 | 关键点 | 资源 |
|---|------|--------|------|
| 100 | 视频生成 API 抽象 | 文生/图生视频、异步任务状态机、时长/分辨率参数、多厂商差异 | S11 §100 |
| 101 | 能力声明与能力探测 | capability registry、运行时探测、**能力不足时 UI 降级/禁用**，避免「点了才报错」 | S11 §101 |
| 102 | 媒体资产管理 | 大文件落盘、缩略图与元数据、播放器、配额与清理 | S11 §102 |
| 103 | 异步长任务 UX | 进度、取消、重试、断点续跑、后台任务面板 | S11 §103 |
| 104 | 多模态能力矩阵 | Sora/Veo/可灵/即梦/通义万相/海螺 + 开源 Wan/HunyuanVideo/CogVideoX；注意 Sora API 2026-09-24 弃用公告 | S11 §104 |

---

## 建议学习顺序（为开发服务）

1. **第 1–2 天**：#41–46 + #73–75（能跑通 Electron 壳 + 一次流式对话）  
2. **第 3–5 天**：#2–10 + #40（最小 Agent loop + 原子配置）  
3. **第 2 周**：#63–70 + #53–59（能做出不卡的聊天 UI）  
4. **第 3 周**：#31–39 + #19–22（记忆 MVP + MCP Host 骨架）  
5. **第 4 周**：#11–18 + #24–30（子代理、Skills、Hooks、定时）  
6. **第二阶段（W8–W12）**：#81–85 + #95–99（启动/预加载优化、内置浏览器）  
7. **第三阶段（W13–W16）**：#86–94 + #100–104（无限画布工作流、视频生成能力门控）

每学完一个主题，在 `knowledge/cards/` 追加一张「对俱佳Agent 的落地决定」卡片（编号递增），避免只收藏不落地。
