# 俱佳Agent · 知识领域 × 来源类型 总矩阵

> 更新日期：2026-09-18 · **2026-09-24 按 `sources/` 现状重生成** · 覆盖 **108 个知识领域 × 5 类权威来源 = 540 格**
> 逐格数据由 `scripts/gen_matrix.py` 从各来源文件的「覆盖度自评」表**自动解析**，
> 不采信正文里的口头汇总数字（本轮实测发现 4 处自评文字与表格逐格结果不一致，均以表格为准并已记录订正）。
>
> **2026-09-24 重生成说明**：E 簇领域 8（Sidecar / 内核隔离）的自评行曾随
> `sources/S4-architecture.md` 的一次删改**整行丢失**，导致脚本口径掉到 107；本次按证据补回，
> 但它的 **T2 来源条目已一并丢失、无法在不编造的前提下恢复**（本矩阵只存 ✅ 符号、不存 URL），故记 ⬜。
> 因此本版为 **完全覆盖 492 · 部分 7 · 空缺 41**（旧版记 493 / 40）——
> 少的那一格是**真实的信息损失，不是笔误，也不靠改数字抹平**。详见 `review/REVIEW-LOG.md` 复核 025 · F-17。

---

## 一、五类权威信息来源的定义

| 代号 | 来源类型 | 判定标准 |
|------|----------|----------|
| **T1** | 权威官方文档 / 官方规范 | 厂商、标准组织、W3C 等发布的规范原文；`docs.*` 官方站 |
| **T2** | 开源项目源码或仓库 | 可定位到具体 repo，并尽量指到可读的文件 / 目录；不是 repo 首页堆砌 |
| **T3** | 论文 / 权威技术报告 / **官方工程博客** | arXiv、厂商 engineering blog（如 Figma/tldraw 官方博客）、NN/g 等研究机构报告 |
| **T4** | 在线课程 / 系统教程 / 交互式教学 | Coursera/edX/DeepLearning.AI/Frontend Masters/官方 codelab/官方学习路径 |
| **T5** | 技术社区讨论 | GitHub Issues/Discussions、Stack Overflow、Reddit、Hacker News、掘金/知乎/V2EX |

> 两条执行口径：
> 1. **T3 包含官方工程博客**。S9 初稿曾把 T3 误收窄为「学术论文」而批量留空，复核后已订正并补入三条经检索核实的 Figma 官方工程博客（见 `sources/S9-canvas-workflow.md` 的订正记录）。
> 2. **找不到合格来源就留空并写明原因**，绝不编造。T4 是覆盖最弱的一类：Agent 开发属 2025–2026 快速演进领域，协议适配、安全基线、架构组合等主题尚无稳定的独立课程，一律如实留空。

---

## 二、分簇汇总

| 簇 | 知识簇 | 领域数 | 对应文件 | 完全✅ | 部分⚠️ | 空缺⬜ | 填充率 | 五类齐备领域 |
|----|--------|-------|----------|-------|--------|-------|--------|-------------|
| A | Agent 核心机制与设计模式 | 10 | `sources/S1-agent-core.md §1–10` | 50 | 0 | 0 | **100%** | 10 / 10 |
| B | 多 Agent / 子代理 / 编排 | 8 | `sources/S1-agent-core.md §11–18` | 39 | 0 | 1 | 97.5% | 7 / 8 |
| C | 技能 / 钩子 / 定时 / 连接 / MCP | 12 | `sources/S2-extensions.md §1–12` | 51 | 3 | 6 | 90.0% | 6 / 12 |
| D | 记忆与上下文管理 | 10 | `sources/S3-memory.md §1–10` | 44 | 3 | 3 | 94.0% | 6 / 10 |
| E | 系统架构与 Electron 工程 | 12 | `sources/S4-architecture.md §1–12` | 59 | 0 | 1 | 98.3% | 11 / 12 |
| F | 性能 / 缓存 / 流畅性 | 10 | `sources/S5-performance.md §1–10` | 49 | 1 | 0 | **100%** | 9 / 10 |
| G | UI / UX / 视觉 / 动效 / 组件与卡片 | 12 | `sources/S6-uiux.md §1–12` | 48 | 0 | 12 | 80.0% | 3 / 12 |
| H | 模型适配与产品工程 | 10 | `sources/S7-model.md §1–10` | 40 | 0 | 10 | 80.0% | 1 / 10 |
| I | 预加载 / 启动 / 体积 / 内存 / 功耗 | 5 | `sources/S8-preload-appopt.md §81–85` | 24 | 0 | 1 | 96.0% | 4 / 5 |
| J | **无限画布与工作流节点编排** | 9 | `sources/S9-canvas-workflow.md §86–94` | 40 | 0 | 5 | 88.9% | 4 / 9 |
| K | **内置浏览器与文档查看** | 5 | `sources/S10-browser-docs.md §95–99` | 24 | 0 | 1 | 96.0% | 4 / 5 |
| L | **多模态能力适配与视频生成** | 5 | `sources/S11-multimodal-video.md §100–104` | 24 | 0 | 1 | 96.0% | 4 / 5 |
| | **合计** | **108** | | **492** | **7** | **41** | **92.4%** | **69 / 108** |

**规模**：来源文件 **11 份**、来源条目 **560+ 行**、去重后 **320+ 条唯一 URL**。

### 108 个领域从哪来

`docs/LEARNING-MAP.md` 原有 **80 个**编号领域（#1–#80），分两轮补齐时新增 **28 个**：

| 轮次 | 新增领域 | 动因 |
|------|----------|------|
| 第一轮（+9） | 空状态与首次运行引导、主题系统与明暗模式；工具调用跨厂商差异、本地模型接入；**预加载与预热、应用启动优化、包体积与构建优化、内存优化与占用治理、功耗与后台行为优化** | brief 已写入研究范围、用户点名「预加载/内存优化/应用优化」，但 LEARNING-MAP #53–62 没有落成条目 |
| 第二轮（+19） | **无限画布与工作流节点编排 9 个**（视口变换与坐标系、节点模型与拖拽创建、连线模型与合法性校验、节点对齐与吸附、画布替代交互、工作流执行语义、持久化与版本迁移、画布渲染性能、撤销重做与协同编辑）；**内置浏览器与文档查看 5 个**（内嵌 Web 内容三形态、内置浏览器安全、外部浏览器打开与浏览器选择、内置文档查看、Agent 与内置浏览器协同）；**多模态与视频生成 5 个**（视频生成 API 抽象、模型能力声明与能力探测、媒体资产管理、异步长任务 UX、多模态模型能力矩阵） | 用户新增三项硬需求：工作流无限画布、内置浏览器（可选系统默认浏览器）、视频生成按模型能力开关 |

---

## 三、108 领域 × 5 类 逐格矩阵

<!-- 以下表格由 scripts/gen_matrix.py 自动生成 -->

| 簇 | 领域 | S 文件 · 小节 | T1 | T2 | T3 | T4 | T5 | 缺口 |
|----|------|--------------|----|----|----|----|----|------|
| A | ReAct 模式 | `S1-agent-core §1` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| A | Agent Loop 三分支控制流 | `S1-agent-core §2` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| A | Workflow 与 Agent 的边界 | `S1-agent-core §3` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| A | Tool Calling / Function Calling | `S1-agent-core §4` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| A | Tool ACI 设计 | `S1-agent-core §5` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| A | Evaluator-Optimizer 模式 | `S1-agent-core §6` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| A | 目标验收与测试反馈驱动 | `S1-agent-core §7` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| A | 失败恢复与错误分类 | `S1-agent-core §8` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| A | Context Engineering | `S1-agent-core §9` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| A | 状态机与预算控制 | `S1-agent-core §10` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| A | Subagent 模型 | `S1-agent-core §11` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| A | 内置角色型代理 | `S1-agent-core §12` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| A | agents-as-tools 与 handoff | `S1-agent-core §13` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| A | Orchestrator-Worker 模式 | `S1-agent-core §14` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| A | Git worktree 隔离执行 | `S1-agent-core §15` | ✅ | ✅ | ✅ | ⬜ | ✅ | 缺 T4 |
| A | 并发槽位与 token 成本控制 | `S1-agent-core §16` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| A | Artifact 交接 | `S1-agent-core §17` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| A | 路由预算与 description 极简化 | `S1-agent-core §18` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| C | MCP 协议总览 | `S2-extensions §1` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| C | MCP 三原语 + elicitation | `S2-extensions §2` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| C | 传输层 + Windows `cmd /c` | `S2-extensions §3` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| C | MCP 安全实践 | `S2-extensions §4` | ✅ | ✅ | ✅ | ⚠️ | ✅ | 弱 T4 |
| C | Registry + 参考 server | `S2-extensions §5` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| C | Agent Skills 标准 | `S2-extensions §6` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| C | Skill 作用域 + frontmatter | `S2-extensions §7` | ✅ | ✅ | ✅ | ✅ | ⚠️ | 弱 T5 |
| C | Hooks 生命周期 + deny | `S2-extensions §8` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| C | 桌面端定时任务 | `S2-extensions §9` | ✅ | ✅ | ✅ | ✅ | ⚠️ | 弱 T5 |
| C | 定时任务=Skill+调度侧车 | `S2-extensions §10` | ✅ | ✅ | ✅ | ⬜ | ⬜ | 缺 T4/T5 |
| C | 应用连接三级 scope | `S2-extensions §11` | ✅ | ✅ | ✅ | ⬜ | ⬜ | 缺 T4/T5 |
| C | Skills over MCP (SEP-2640) | `S2-extensions §12` | ✅ | ✅ | ✅ | ⬜ | ⬜ | 缺 T4/T5 |
| D | 短期记忆 vs 长期记忆 | `S3-memory §1` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| D | Memory Blocks | `S3-memory §2` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| D | 记忆归档与检索 | `S3-memory §3` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| D | 结构化笔记（NOTES.md） | `S3-memory §4` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| D | Handoff packet | `S3-memory §5` | ✅ | ✅ | ⚠️ | ✅ | ✅ | 弱 T3 |
| D | 上下文压缩与 Compaction | `S3-memory §6` | ✅ | ✅ | ⚠️ | ⬜ | ✅ | 缺 T4；弱 T3 |
| D | RAG 与 Agent Memory 区别 | `S3-memory §7` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| D | Mem0 式写管线 | `S3-memory §8` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| D | 记忆系统评估 | `S3-memory §9` | ✅ | ✅ | ✅ | ⚠️ | ✅ | 弱 T4 |
| D | 原子 JSON 落盘 | `S3-memory §10` | ✅ | ✅ | ⬜ | ⬜ | ✅ | 缺 T3/T4 |
| E | 进程模型 | `S4-architecture §1` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| E | contextIsolation | `S4-architecture §2` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| E | Preload/contextBridge | `S4-architecture §3` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| E | Sandbox | `S4-architecture §4` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| E | IPC | `S4-architecture §5` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| E | 安全 Checklist | `S4-architecture §6` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| E | UtilityProcess | `S4-architecture §7` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| E | Sidecar/内核隔离 | `S4-architecture §8` | ✅ | ⬜ | ✅ | ✅ | ✅ | 缺 T2 |
| E | 内置终端 | `S4-architecture §9` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| E | electron-builder | `S4-architecture §10` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| E | 原生模块 | `S4-architecture §11` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| E | monorepo | `S4-architecture §12` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| F | Measure First | `S5-performance §1` | ✅ | ✅ | ✅ | ✅ | ⚠️ | 弱 T5 |
| F | 模块延迟加载 | `S5-performance §2` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| F | 打包为单文件 | `S5-performance §3` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| F | 禁止阻塞主进程 | `S5-performance §4` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| F | 流式事件批处理 | `S5-performance §5` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| F | 长列表虚拟化 | `S5-performance §6` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| F | IPC 只传 delta | `S5-performance §7` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| F | 配置内存缓存 | `S5-performance §8` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| F | 分层缓存与 SWR | `S5-performance §9` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| F | 内存泄漏排查 | `S5-performance §10` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| G | Design Tokens 分层 | `S6-uiux §1` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| G | Fluent v9 桌面气质 | `S6-uiux §2` | ✅ | ✅ | ✅ | ⬜ | ✅ | 缺 T4 |
| G | AI 聊天 IA | `S6-uiux §3` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| G | 工具卡 L0/L1/L2 | `S6-uiux §4` | ⬜ | ✅ | ✅ | ⬜ | ✅ | 缺 T1/T4 |
| G | 权限审批 UI | `S6-uiux §5` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| G | 界面四态 | `S6-uiux §6` | ✅ | ✅ | ✅ | ⬜ | ✅ | 缺 T4 |
| G | 反馈三分工 | `S6-uiux §7` | ✅ | ✅ | ✅ | ⬜ | ✅ | 缺 T4 |
| G | 动效预算 | `S6-uiux §8` | ✅ | ✅ | ✅ | ✅ | ⬜ | 缺 T5 |
| G | 可访问性 | `S6-uiux §9` | ✅ | ✅ | ✅ | ⬜ | ✅ | 缺 T4 |
| G | 桌面密度与文案 | `S6-uiux §10` | ✅ | ✅ | ✅ | ⬜ | ⬜ | 缺 T4/T5 |
| G | 空状态与引导 | `S6-uiux §11` | ✅ | ✅ | ✅ | ⬜ | ✅ | 缺 T4 |
| G | 主题与明暗 | `S6-uiux §12` | ✅ | ✅ | ✅ | ⬜ | ⬜ | 缺 T4/T5 |
| H | OpenAI-compatible 适配 | `S7-model §1` | ✅ | ✅ | ✅ | ⬜ | ✅ | 缺 T4 |
| H | Anthropic Messages 适配 | `S7-model §2` | ✅ | ✅ | ✅ | ⬜ | ✅ | 缺 T4 |
| H | SSE 流式传输 | `S7-model §3` | ✅ | ✅ | ✅ | ⬜ | ✅ | 缺 T4 |
| H | reasoning/thinking 分离 | `S7-model §4` | ✅ | ✅ | ✅ | ⬜ | ✅ | 缺 T4 |
| H | 多连接抽象 | `S7-model §5` | ✅ | ✅ | ✅ | ⬜ | ✅ | 缺 T4 |
| H | 模型目录与能力回退 | `S7-model §6` | ✅ | ✅ | ✅ | ⬜ | ⬜ | 缺 T4/T5 |
| H | 限流重试退避 | `S7-model §7` | ✅ | ✅ | ✅ | ⬜ | ✅ | 缺 T4 |
| H | 端口/网络安全边界 | `S7-model §8` | ✅ | ✅ | ✅ | ⬜ | ✅ | 缺 T4 |
| H | 工具调用跨厂商差异 | `S7-model §9` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| H | 本地模型接入 | `S7-model §10` | ✅ | ✅ | ✅ | ⬜ | ✅ | 缺 T4 |
| I | 预加载与预热 | `S8-preload-appopt §81` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| I | 应用启动优化 | `S8-preload-appopt §82` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| I | 包体积与构建 | `S8-preload-appopt §83` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| I | 内存优化治理 | `S8-preload-appopt §84` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| I | 功耗与后台 | `S8-preload-appopt §85` | ✅ | ✅ | ✅ | ⬜ | ✅ | 缺 T4 |
| J | 无限画布基础 | `S9-canvas-workflow §86` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| J | 节点模型与拖拽 | `S9-canvas-workflow §87` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| J | 连线与合法性校验 | `S9-canvas-workflow §88` | ✅ | ✅ | ⬜ | ✅ | ✅ | 缺 T3 |
| J | 节点对齐与吸附 | `S9-canvas-workflow §89` | ✅ | ✅ | ⬜ | ✅ | ✅ | 缺 T3 |
| J | 画布替代交互 | `S9-canvas-workflow §90` | ✅ | ✅ | ⬜ | ✅ | ✅ | 缺 T3 |
| J | 工作流执行语义 | `S9-canvas-workflow §91` | ✅ | ✅ | ⬜ | ✅ | ✅ | 缺 T3 |
| J | 持久化与版本迁移 | `S9-canvas-workflow §92` | ✅ | ✅ | ⬜ | ✅ | ✅ | 缺 T3 |
| J | 画布渲染性能 | `S9-canvas-workflow §93` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| J | 撤销重做与协同 | `S9-canvas-workflow §94` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| K | 内嵌形态与选型 | `S10-browser-docs §95` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| K | 内置浏览器安全 | `S10-browser-docs §96` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| K | 外部打开与浏览器选择 | `S10-browser-docs §97` | ✅ | ⬜ | ✅ | ✅ | ✅ | 缺 T2 |
| K | 内置文档查看 | `S10-browser-docs §98` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| K | Agent 协同 | `S10-browser-docs §99` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| L | 视频生成 API 抽象与任务模型 | `S11-multimodal-video §100` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| L | 模型能力声明与能力探测 | `S11-multimodal-video §101` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| L | 媒体资产管理 | `S11-multimodal-video §102` | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| L | 异步长任务 UX | `S11-multimodal-video §103` | ✅ | ✅ | ✅ | ⬜ | ✅ | 缺 T4 |
| L | 多模态能力矩阵与供应商差异 | `S11-multimodal-video §104` | ✅ | ✅ | ✅ | ✅ | ✅ |  |

**合计：108 个领域 · 540 格 · 完全覆盖 492 · 部分覆盖 7 · 空缺 41**
**填充率（✅+⚠️）= 499/540 = 92.4%**

## 缺口台账

| 簇 | 领域 | 位置 | 缺口 | 原备注 |
|----|------|------|------|--------|
| A | Git worktree 隔离执行 | `S1-agent-core §15` | 缺 T4 | ⚠️ 留空 |
| C | MCP 安全实践 | `S2-extensions §4` | 弱 T4 | ⚠️ |
| C | Skill 作用域 + frontmatter | `S2-extensions §7` | 弱 T5 | ⚠️ |
| C | 桌面端定时任务 | `S2-extensions §9` | 弱 T5 | ⚠️ |
| C | 定时任务=Skill+调度侧车 | `S2-extensions §10` | 缺 T4/T5 | ❌ / ❌ |
| C | 应用连接三级 scope | `S2-extensions §11` | 缺 T4/T5 | ❌ / ❌ |
| C | Skills over MCP (SEP-2640) | `S2-extensions §12` | 缺 T4/T5 | ❌ / ❌ |
| D | Handoff packet | `S3-memory §5` | 弱 T3 | △(思想源,无专论文) |
| D | 上下文压缩与 Compaction | `S3-memory §6` | 缺 T4；弱 T3 | △(MemGPT,无专论文) / ✗ 无课程 |
| D | 记忆系统评估 | `S3-memory §9` | 弱 T4 | △(辅助) |
| D | 原子 JSON 落盘 | `S3-memory §10` | 缺 T3/T4 | ✗ 无论文 / ✗ 无课程 |
| E | Sidecar / 内核隔离 | `S4-architecture §8` | 缺 T2 | ⬜ |
| F | Measure First | `S5-performance §1` | 弱 T5 | ⚠️ |
| G | Fluent v9 桌面气质 | `S6-uiux §2` | 缺 T4 | ⬜ |
| G | 工具卡 L0/L1/L2 | `S6-uiux §4` | 缺 T1/T4 | ⬜ / ⬜ |
| G | 界面四态 | `S6-uiux §6` | 缺 T4 | ⬜ |
| G | 反馈三分工 | `S6-uiux §7` | 缺 T4 | ⬜ |
| G | 动效预算 | `S6-uiux §8` | 缺 T5 | ⬜ |
| G | 可访问性 | `S6-uiux §9` | 缺 T4 | ⬜ |
| G | 桌面密度与文案 | `S6-uiux §10` | 缺 T4/T5 | ⬜ / ⬜ |
| G | 空状态与引导 | `S6-uiux §11` | 缺 T4 | ⬜ |
| G | 主题与明暗 | `S6-uiux §12` | 缺 T4/T5 | ⬜ / ⬜ |
| H | OpenAI-compatible 适配 | `S7-model §1` | 缺 T4 | — |
| H | Anthropic Messages 适配 | `S7-model §2` | 缺 T4 | — |
| H | SSE 流式传输 | `S7-model §3` | 缺 T4 | — |
| H | reasoning/thinking 分离 | `S7-model §4` | 缺 T4 | — |
| H | 多连接抽象 | `S7-model §5` | 缺 T4 | — |
| H | 模型目录与能力回退 | `S7-model §6` | 缺 T4/T5 | — / — |
| H | 限流重试退避 | `S7-model §7` | 缺 T4 | — |
| H | 端口/网络安全边界 | `S7-model §8` | 缺 T4 | — |
| H | 本地模型接入 | `S7-model §10` | 缺 T4 | — |
| I | 功耗与后台 | `S8-preload-appopt §85` | 缺 T4 | ⬜ 未找到 |
| J | 连线与合法性校验 | `S9-canvas-workflow §88` | 缺 T3 | ❌ 留空 |
| J | 节点对齐与吸附 | `S9-canvas-workflow §89` | 缺 T3 | ❌ 留空 |
| J | 画布替代交互 | `S9-canvas-workflow §90` | 缺 T3 | ❌ 留空 |
| J | 工作流执行语义 | `S9-canvas-workflow §91` | 缺 T3 | ❌ 留空 |
| J | 持久化与版本迁移 | `S9-canvas-workflow §92` | 缺 T3 | ❌ 留空 |
| K | 外部打开与浏览器选择 | `S10-browser-docs §97` | 缺 T2 | ⚠️ 缺失 |
| L | 异步长任务 UX | `S11-multimodal-video §103` | 缺 T4 | ⚠️未找到独立系统教程（留空） |
