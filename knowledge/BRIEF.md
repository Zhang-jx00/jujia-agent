# Research Brief: 俱佳Agent 知识体系与开发规划

## Refined question

为在 Windows 上学习并自研一款 **TypeScript + Electron 桌面编码/助手 Agent（俱佳Agent）**，系统调研至少 60 个与 Agent 相关的知识领域（权威文档 / 开源项目 / 论文 / 课程 / 社区实践），并据此产出可落地的产品规划与开发计划。

## Scope

**In**
- Agent 运行时机制、工具调用、子 Agent、MCP、技能、钩子、定时任务
- 记忆与上下文管理、长期记忆、预加载与缓存
- 系统架构、Electron 工程、性能与流畅性
- UI/UX、交互、视觉、动效、组件与卡片
- 模型适配、多供应商、流式输出
- Yan Agent、OpenCode、OpenHands、Claude Code 等开源参考
- 面向「学习练手 + 可逐步产品化」的分阶段开发计划

**Out**
- 生产级安全合规认证、商业化定价
- 移动端原生 App（可留作远期）
- 为某单一厂商模型绑死的专有实现细节

## Assumptions

- 产品形态：**Windows 桌面 Agent**（Electron）
- 技术栈：**TypeScript + Electron**
- 近期目标：**学习与技术练手**，功能可迭代
- 可参考本地已分析的 `D:\MiMo\ProjectOne\Yan-Agent`（开源树约 v1.5.0）
- 研究深度：**deep**（8 个并行角度）
- 今日日期：2026-09-18（以运行时为准）
- 交付物语言：中文报告 + 知识库 markdown + 开发计划

## Angles（8 个独立研究角度）

| ID | 角度 | 覆盖知识簇（目标 ≥8 项/角） |
|----|------|------------------------------|
| F1 | Agent 核心机制与设计模式 | Agent loop、ReAct、Plan-Execute、Tool Use、Function Calling、多步推理、目标验收、失败恢复、状态机、上下文工程 |
| F2 | 多 Agent / 子代理 / 编排 | Multi-agent、主从代理、角色分工、委派、worktree、并发槽、Agent-to-Agent、通信协议、Orchestrator 模式 |
| F3 | 技能 / 钩子 / 定时 / 连接器 / MCP | Skill 系统、SKILL.md、Hooks、Cron/定时任务、应用连接、MCP 协议、JSON-RPC、stdio/SSE、第三方工具市场 |
| F4 | 记忆与上下文 | 短期记忆、长期记忆、memory.json 模式、RAG、向量检索、上下文压缩、窗口预算、会话交接、实体记忆、评估 |
| F5 | 系统架构与 Electron 工程 | 主进程/渲染进程、IPC、preload、sandbox、sidecar、模块化、asar、自动更新、打包、原生模块、崩溃恢复 |
| F6 | 性能 / 缓存 / 预加载 / 流畅性 | 预加载、懒加载、虚拟列表、事件批处理、防抖节流、内存泄漏、缓存策略、流式渲染、首帧时间、Electron 性能 |
| F7 | UI/UX / 视觉 / 动效 / 组件 / 卡片 | 设计系统、Design Tokens、组件库、卡片信息架构、交互反馈、空状态、权限 UI、动效原则、可访问性、响应式 |
| F8 | 模型适配与开源 Agent 对标 | OpenAI 兼容 API、Anthropic、多供应商、流式 SSE、reasoning_content、视觉/媒体模型、Yan-Agent、OpenCode、OpenHands、Aider、Cline 等架构可复用点 |

每条有效发现需尽量覆盖：**官方文档 / 开源仓库 / 论文或技术报告 / 权威媒体或课程 / 社区实践（Issues/论坛）** 等多类来源。

## Workspace

`D:\MiMo\ProjectOne\俱佳agent\knowledge\`

```
knowledge/
├── brief.md
├── findings/F1.md … F8.md
├── REPORT.md          # 知识调研综合报告
└── (上游由主 agent 写入)
    ../../docs/PLAN.md # 俱佳Agent 规划与开发计划
    ../../knowledge/*.md
```

## Deliverables after research

1. `knowledge/REPORT.md` — 知识调研报告（引用齐全）
2. `knowledge/` — 按主题沉淀的知识卡片（可执行摘要）
3. `docs/PLAN.md` — 产品定位、架构、MVP、里程碑、学习路径、风险
4. `docs/LEARNING-MAP.md` — 60+ 知识点地图与推荐资源
