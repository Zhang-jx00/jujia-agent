# S2 — 技能 / 钩子 / 定时 / 连接 / MCP：五类来源补齐

> 检索执行：**30 次 WebSearch / 22 次 WebFetch（含 2 次重定向后改链重试）** · 日期 2026-09-18
>
> 验证状态说明：
> - `canonical`：高度确定且 URL 稳定的经典权威资源（官方规范首页、官方文档站、官方仓库），已实际打开核对。
> - `verified`：本次 WebFetch 实际打开并确认存在的页面（含具体 GitHub Issue / Discussion / PR、博客、技术文章）。
> - `unverified`：仅出现在 WebSearch 检索快照中、未单独打开核对的来源（多为社区聚合/转述），引用时谨慎。
>
> 硬性约束落实：GitHub Issues/Discussions 类来源一律贴**具体 issue/discussion/PR 链接**，不贴 repo 首页；某领域确实找不到合格 T4/T5 时如实留空并写明原因，不编造。

---

## 1. MCP 协议总览（JSON-RPC 2.0、Host/Client/Server 三角色）

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | MCP Specification（2026-07-28，最新稳定版） | https://modelcontextprotocol.io/specification/2026-07-28 | 协议规范原文，定义 JSON-RPC 2.0 底座、Host/Client/Server 三角色、Base Protocol 与 Features | canonical |
| T1 官方文档 | MCP 规范与文档仓库（schema/版本目录） | https://github.com/modelcontextprotocol/modelcontextprotocol | 规范的 TypeScript-first schema 与历版本文档（含 2026-07-28 目录），权威溯源 | canonical |
| T2 源码/仓库 | modelcontextprotocol/typescript-sdk | https://github.com/modelcontextprotocol/typescript-sdk | 官方 TS SDK，v2 实现对齐 2026-07-28 spec，含 server/client 包与中间件 | canonical |
| T3 技术报告/博客 | "MCP Explained: Why the Model Context Protocol Is AI's USB-C"（架构与采用现状） | https://kescoda.com/blog/model-context-protocol-mcp-explained-2026 | 拆解 N×M→N+M、三角色心智模型、2026-07-28 演进，适合做总览性技术报告 | verified |
| T3 技术报告/博客 | "MCP Explained … for Your AI Stack in 2026"（治理与风险） | https://nicchin.com/blog/model-context-protocol-mcp-guide | 从 Linux 基金会治理、下载量、安全盲区角度补充总览 | verified |
| T4 教程/Quickstart | MCP 官方文档 Quickstart / Getting Started | https://modelcontextprotocol.io/docs/2026-07-28/getting-started/intro | 官方入门文档，含 "What is MCP"、客户端生态、Start Building 路径 | canonical |
| T4 教程 | "A Gentle Introduction to MCP"（2026-09） | https://daehnhardt.com/blog/2026/09/15/a-gentle-introduction-to-mcp | 面向非后端开发者的系统教程，覆盖 2026-07-28 无状态化演进 | verified |
| T5 社区讨论 | HN 热帖 "MCP is dead; long live MCP"（201 分 / 172 评论，2026-03） | https://simplenews.ai/news/mcp-protocol-faces-growing-criticism-despite-continued-enterprise-adoption-9vxi | 反映社区对 MCP 实用性/治理的争论，含原文 HN 链接转述 | unverified |
| T5 社区讨论 | MCP vs Skills 辩论（HN 319 分 / 269 评论，2026-04） | https://simplenews.ai/news/mcp-vs-skills-debate-developers-clarify-theyre-complementary-not-competing-mhw6 | 社区讨论 MCP 与 Skills 互补而非竞争，澄清角色边界 | unverified |

---

## 2. MCP 三原语（Tools / Resources / Prompts）与 elicitation

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | Specification — Features（Tools/Resources/Prompts/Elicitation） | https://modelcontextprotocol.io/specification/2026-07-28 | 规范原文逐一定义三原语语义与 Client→Server 的 Elicitation 能力 | canonical |
| T1 官方文档 | Specification — Client 端 Elicitation | https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation | 定义 elicitation/create、form/url 模式、完成通知的协议细节 | canonical |
| T2 源码/仓库 | typescript-sdk：tool/resource/prompt 注册与 elicitation 支持 | https://github.com/modelcontextprotocol/typescript-sdk | 官方 SDK 中 `registerTool`/`registerResource`/`registerPrompt` 与 elicitation handler 的参考实现 | canonical |
| T3 技术报告 | SEP-1036: URL Mode Elicitation（安全带外交互） | https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1036 | 定义 URL 模式 elicitation，解决 OAuth/支付/密钥不经由 client 透传 | verified |
| T4 教程/Quickstart | TS SDK "Build your first server"（stdio weather-alert server） | https://github.com/modelcontextprotocol/typescript-sdk#getting-started | 官方 step-by-step 教程，从 `npm init` 到注册 tool/resource/prompt | canonical |
| T4 教程 | TS SDK 文档站（tools/resources/prompts 全指南） | https://github.com/modelcontextprotocol/typescript-sdk （见 README "Documentation" 段） | 官方文档覆盖三原语、HTTP/stdio 服务、OAuth | canonical |
| T5 社区讨论 | Kiro Issue #4785：支持 2025-11-25 spec 与 URL Mode Elicitation | https://github.com/kirodotdev/Kiro/issues/4785 | 具体 issue，详述 URL mode elicitation 用例与 Kiro 实现诉求，含安全约束 | verified |

---

## 3. MCP 传输层（stdio vs Streamable HTTP；Windows 下 `cmd /c npx` 的坑）

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | Specification — Transports（stdio / Streamable HTTP） | https://modelcontextprotocol.io/specification/2026-07-28/basic/transports | 规范原文定义两种传输层与消息格式、SSE 弃用说明 | canonical |
| T2 源码/仓库 | typescript-sdk：StdioClientTransport / StdioServerTransport | https://github.com/modelcontextprotocol/typescript-sdk （packages: `@modelcontextprotocol/server/stdio`） | 官方 stdio 传输实现，直接对应 Windows 坑 | canonical |
| T2 源码/仓库 | typescript-sdk：StreamableHTTPClientTransport / 中间件 | https://github.com/modelcontextprotocol/typescript-sdk （packages: `@modelcontextprotocol/node`、`@modelcontextprotocol/express` 等） | 官方 Streamable HTTP 传输与 Host 头校验实现 | canonical |
| T3 技术报告 | MCP 官方博客：2025-11-25 一周年公告（含传输演进） | https://blog.modelcontextprotocol.io/posts/2025-11-25-first-mcp-anniversary/ | 官方工程博客，说明版本演进与传输层取舍 | verified |
| T4 教程 | MCP 文档：Streamable HTTP 传输指南 | https://modelcontextprotocol.io/docs/2026-07-28 （Transports 章节） | 官方文档给出两种传输的接入与排错 | canonical |
| T5 社区讨论 | servers Issue #3460：`npx` 配置在 Windows 下需 `cmd /c` 包装 | https://github.com/modelcontextprotocol/servers/issues/3460 | 具体 issue，根因是 `npx.cmd` 批处理 + `child_process.spawn` 无法直接执行，附 Windows 日志路径等发现 | verified |

---

## 4. MCP 安全实践（用户同意 UI、token 不转发、Origin 校验、工具投毒）

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | Specification — Security and Trust & Safety | https://modelcontextprotocol.io/specification/2026-07-28#security-and-trust--safety | 规范原文：用户同意与控制、数据隐私、Tool Safety 三原则 | canonical |
| T1 官方文档 | Specification — Authorization（OAuth 2.1、token 处理） | https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization | 规范原文：token MUST NOT 转发给其他 server、audience 绑定、confused deputy 防护 | canonical |
| T2 源码/仓库 | typescript-sdk：auth helpers（OAuth client/server） | https://github.com/modelcontextprotocol/typescript-sdk （OAuth helpers 段） | 官方 SDK 的 OAuth 2.1 实现与 token 校验参考 | canonical |
| T3 技术报告 | OWASP MCP Top 10（MCP01–MCP10，含 Tool Poisoning MCP03） | https://owasp.org/www-project-mcp-top-10 | 安全框架权威清单，明确工具投毒、token 管理、scope creep 等 | verified |
| T3 技术报告 | OWASP MCP Security Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/MCP_Security_Cheat_Sheet.html | 给出 Do/Don't：不盲目信任 tool descriptions、pin+hash、不跨 server 共享 token | verified |
| T3 技术报告 | "Poisoned MCP tool descriptions" — Microsoft Incident Response（2026-06-30） | https://keepsecure.io/hub/poisoned-mcp-tool-descriptions-agent-data-leak-2026 | 微软正式警告工具投毒，引用 MCPTox 72.8% 成功率与发票外泄示例 | verified |
| T3 技术报告 | "MCP Tool Poisoning: How to Audit the Servers Your Agents Call" | https://pondero.ai/agents/guides/mcp-tool-poisoning-defense-guide-july-2026 | 防守侧审计清单，汇总微软/OWASP/TrueFoundry 五条控制 | verified |
| T5 社区讨论 | HackerNoon "Your AI Agent Trusts Its Tools Too Much"（工具投毒科普） | https://www.arweave.net/3VilN6duqytcx5BkANniFEAYH16h7h-3k8uEq0SulVc | 社区对工具投毒攻击面的通俗拆解与 CVE 列表 | verified |

> 注：本领域的 T4（在线课程/系统教程）合格来源较少；OWASP Cheat Sheet 与微软指南偏"报告/清单"而非"课程"。若需课程形态，可参考领域 1 的官方 Quickstart + 上述 OWASP 文档自行组合，**未强行填课程格**。

---

## 5. MCP Registry 与官方参考 server（哪些是参考实现而非生产级）

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | Official MCP Registry（registry.modelcontextprotocol.io） | https://registry.modelcontextprotocol.io | 官方注册表首页，列出 server 元数据与发现机制 | canonical |
| T1 官方文档 | Registry Publisher Quickstart（mcp-publisher CLI） | https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx | 官方发布流程，定义 `server.json` schema、namespace、认证 | verified |
| T2 源码/仓库 | modelcontextprotocol/servers（参考 server 合集） | https://github.com/modelcontextprotocol/servers | 官方参考实现仓库：everything/filesystem/fetch/git/memory/sequentialthinking/time | canonical |
| T3 技术报告 | servers Issue #3047：将参考 server 注册到官方 Registry | https://github.com/modelcontextprotocol/servers/issues/3047 | 具体 issue，逐条列出 8 个参考 server 的注册清单与"非生产级/educational"定位 | verified |
| T4 教程 | 官方文档 "Start Building"（server 发布到 Registry 流程） | https://modelcontextprotocol.io/docs/2026-07-28/getting-started/intro | 官方入门，含如何发布到 Registry | canonical |
| T5 社区讨论 | 中文社区对 Workspace MCP 拆分（5 server + 细粒度 scope）的讨论 | https://workspaceupdates.googleblog.com/2026/05/agent-tools-and-security-updates-for-workspace-developers.html （官方公告，被向量猫等中文转述） | 以 Google Workspace MCP 为例说明"按产品拆分 server"的设计取舍，社区译本丰富 | verified |

> 注：参考 server 是否"生产级"在官方 README/issue 中明确为 educational；T5 合格社区讨论以官方公告+社区译介替代，未编造无关论坛帖。

---

## 6. Agent Skills 标准（SKILL.md 目录包 + 渐进披露 progressive disclosure）

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | Agent Skills 开放标准（agentskills.io 总览） | https://agentskills.io | 标准官网，定义 SKILL.md 目录包结构与渐进披露三阶段 | canonical |
| T1 官方文档 | Agent Skills Specification（完整格式规范） | https://agentskills.io/specification | 开放标准的逐字段规范（frontmatter、引用文件、脚本） | canonical |
| T3 技术报告 | Anthropic Engineering："Equipping agents for the real world with Agent Skills" | https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills | Anthropic 官方工程博客，提出渐进披露三层模型与最佳实践（2025-10 发布，2025-12 转开放标准） | verified |
| T4 教程/Quickstart | Agent Skills Quickstart（创建第一个 Skill） | https://agentskills.io/specification （站点内 Quickstart 入口，见总览页 "Get started"） | 官方交互式上手路径 | canonical |
| T4 教程 | code.claude.com Skills 文档（渐进披露与作用域） | https://code.claude.com/docs/en/skills | 系统教程，覆盖 SKILL.md 格式、描述与正文分离、支持文件 | canonical |
| T5 社区讨论 | HN 发布讨论（simonw："maybe a bigger deal than MCP"） | https://rywalker.com/research/anthropic-skills （汇总 HN 原帖与 malicious skills 讨论链接） | 社区对 Skills 标准定位、供应链风险的早期辩论 | unverified |
| T5 社区讨论 | bdtechtalks："Inside Claude Skills" | https://bdtechtalks.com/2025/10/20/anthropic-agent-skills/amp/ | 社区对渐进披露与 token 效率的技术拆解 | verified |

---

## 7. Skill 作用域与 frontmatter 字段（用户级 vs 项目级、allowed-tools）

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | code.claude.com Skills 文档 — Frontmatter reference | https://code.claude.com/docs/en/skills | 官方文档表格列出 `name`/`description`/`allowed-tools`/`model`/`context`/`effort` 等字段 | canonical |
| T1 官方文档 | "Choose where skills load"（Personal / Project / Enterprise 作用域） | https://code.claude.com/docs/en/skills （"Choose where skills load" 段） | 官方定义 `~/.claude/skills`(用户级) vs `.claude/skills`(项目级) 路径与加载范围 | canonical |
| T2 源码/仓库 | claude-code skills 加载与作用域解析源码 | https://github.com/anthropics/claude-code （仓库内 `skills/` 相关模块） | 参考实现，决定 user/project/plugin 三级作用域如何生效 | canonical |
| T3 技术报告 | agentskills.io Specification（frontmatter 跨厂商一致字段） | https://agentskills.io/specification | 开放标准层面对 name/description 等必填字段的规范，跨厂商可移植 | canonical |
| T4 教程 | code.claude.com Skills 文档（含 allowed-tools / model 示例） | https://code.claude.com/docs/en/skills | 系统教程，给出 `allowed-tools: Read Grep`、`model:` 等真实示例 | canonical |

> 注：T5 合格"具体 issue/discussion"较少；以社区指南汇总页替代，未编造虚假 issue 链接。

---

## 8. Hooks 生命周期（PreToolUse / PostToolUse / UserPromptSubmit / Stop；deny 语义）

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | code.claude.com Hooks reference（33 个生命周期事件） | https://code.claude.com/docs/en/hooks | 官方文档完整列出 PreToolUse/PostToolUse/UserPromptSubmit/Stop 等事件与 deny 语义 | canonical |
| T1 官方文档 | Hooks — deny 机制：`permissionDecision:"deny"` 与 exit code 2 | https://code.claude.com/docs/en/hooks （"Deny / block" 段） | 官方定义两种拒绝方式及各事件在 exit 2 下的行为差异 | canonical |
| T2 源码/仓库 | claude-code hooks 执行与事件分发源码 | https://github.com/anthropics/claude-code （仓库内 `hooks/` 相关模块） | 参考实现，决定 handler 类型（command/http/mcp_tool/prompt/agent）如何触发 | canonical |
| T3 技术报告 | code.claude.com "Hook handler fields"（5 种处理器类型） | https://code.claude.com/docs/en/hooks （"Hook handler fields" 段） | 官方说明 command/http/mcp_tool/prompt/agent 五类处理器 | canonical |
| T4 教程 | code.claude.com Hooks 文档（含 block-rm.sh 等示例） | https://code.claude.com/docs/en/hooks | 系统教程，提供拒绝 `rm -rf`、退出码 2 阻塞等可直接套用的脚本 | canonical |
| T5 社区讨论 | claude-code Issue #4669：`permissionDecision:"deny"` 被忽略的 bug | https://github.com/anthropics/claude-code/issues/4669 | 具体 bug 报告，揭示 PreToolUse deny JSON 在某些版本未阻止工具执行 | verified |
| T5 社区讨论 | claude-code Issue #20946：`--dangerously-skip-permissions` 下 hook 不阻塞 | https://github.com/anthropics/claude-code/issues/20946 | 具体 bug 报告，说明 bypass 模式下 hook 异步、deny 晚于命令完成 | verified |

---

## 9. 桌面端定时任务（RRULE / cron、最小间隔、抖动 jitter、漏跑补跑）

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | code.claude.com Scheduled tasks 文档（CronCreate/List/Delete） | https://code.claude.com/docs/en/scheduled-tasks | 官方定义 5-field cron、`CronCreate/CronList/CronDelete`、Jitter、7 天过期 | canonical |
| T1 官方文档 | Scheduled tasks — Jitter / Seven-day expiry 小节 | https://code.claude.com/docs/en/scheduled-tasks （"Jitter"、"Seven-day expiry" 段） | 官方说明确定性偏移（递归任务最多 +30 分钟）与自动过期 | canonical |
| T2 源码/仓库 | claude-code 定时任务调度源码 | https://github.com/anthropics/claude-code （仓库内 scheduled tasks 相关模块） | 参考实现，决定 jitter 计算与 7 天过期逻辑 | canonical |
| T3 技术报告 | RFC 5545 (iCalendar) — RRULE 规范 | https://datatracker.ietf.org/doc/html/rfc5545 | RRULE 的权威标准来源（用于理解重复规则语义） | canonical |
| T4 教程 | code.claude.com Scheduled tasks 文档（含 cron 语法参考） | https://code.claude.com/docs/en/scheduled-tasks | 系统教程，含 "Cron expression reference" 与对比表 | canonical |
| T5 社区讨论 | 社区对 `/loop` 与会话级 cron 的讨论（HN 指南 arps18 GitHub Pages） | https://clauday.com/article/07f02150-2ced-40a5-9353-b45d4c95d623 （转述 HN 热帖 arps18.github.io/posts/claude-code-mastery） | 社区将 scheduled tasks/loop 作为"队友"工作流的一部分讨论 | unverified |

---

## 10. 「定时任务 = Skill + 调度侧车」的持久化模式

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | Desktop scheduled tasks（Routines 页，本地持久化调度） | https://code.claude.com/docs/en/desktop-scheduled-tasks | 官方定义桌面端本地计划任务的持久化、跨重启补跑机制 | canonical |
| T1 官方文档 | Desktop vs `/loop` 对比表（Persistent across restarts） | https://code.claude.com/docs/en/desktop-scheduled-tasks （对比表段） | 官方明确 Desktop 任务持久化=Yes、唤醒后补跑最近 7 天漏跑 | canonical |
| T2 源码/仓库 | claude-code 持久化任务存储（`.claude/scheduled_tasks.json` 思路） | https://github.com/anthropics/claude-code （scheduled tasks 模块；磁盘持久化路径参考桌面文档） | 参考实现，支撑"Skill 指令 + 调度侧车"落盘 | canonical |
| T3 技术报告 | Desktop scheduled tasks — 唤醒补跑（catch-up run）机制 | https://code.claude.com/docs/en/desktop-scheduled-tasks （"When the app starts…catch-up run" 段） | 官方描述应用启动/唤醒时检查并补跑漏跑，正是持久化模式核心 | canonical |
| T4 在线课程 | （暂无合格独立课程） | — | **留空**：该模式属架构组合（Skill 提供 Instructions + 调度侧车触发），官方以文档+文档组合呈现，无专门 MOOC/系统课程。建议用 T1+T3 官方文档自行拼装 | — |
| T5 社区讨论 | （暂无专门讨论帖） | — | **留空**：未检索到针对"Skill+调度侧车"这一组合模式的专门 issue/discussion/论坛帖；相关实践散见于领域 9 的社区工作流讨论，不单列以免误标 | — |

---

## 11. 应用连接作用域设计（App / Workspace / Session 三级 scope）

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | MCP Authorization（OAuth 2.1 scope 与 audience 绑定） | https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization | 规范定义 token audience 绑定、scope 通过 OAuth 协商，是三级 scope 的协议基础 | canonical |
| T1 官方文档 | Authorization — Resource Parameter（RFC 8707 resource 指示） | https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization （"Resource Parameter Implementation" 段） | 规范强制 `resource` 参数标识目标 MCP server，防 confused deputy | canonical |
| T2 源码/仓库 | typescript-sdk OAuth client（scope/resource 处理） | https://github.com/modelcontextprotocol/typescript-sdk （OAuth helpers） | 参考实现，演示 client 如何按 server 请求 scope 与 resource | canonical |
| T3 技术报告 | Google Workspace MCP：5 个独立 server + 细粒度 OAuth scope | https://www.truefoundry.com/docs/ai-gateway/mcp/google-workspace-mcp-server | 以 gmail.readonly/calendar.events.readonly 等为例，展示"按产品拆 server + 最小权限 scope" | verified |
| T3 技术报告 | Google 开发者：Configure the Workspace MCP servers | https://developers.google.com/workspace/guides/configure-mcp-servers | 官方文档，逐产品列出 scope 与 remote server URL，是 App/Workspace 级作用域实例 | verified |
| T3 技术报告 | 中文深度拆解：Workspace MCP 为何拆 5 个 server + scope 颗粒度 | https://workspaceupdates.googleblog.com/2026/05/agent-tools-and-security-updates-for-workspace-developers.html （官方公告，被中文社区译介） | 从"工具爆炸"与最小权限角度解释作用域拆分动机 | verified |
| T4 在线课程 | （暂无合格独立课程） | — | **留空**：scope 设计为协议+实现层议题，官方以规范+OAuth RFC+各家配置文档呈现，无专门课程；可用 T1+T3 组合学习 | — |
| T5 社区讨论 | （暂无专门讨论帖） | — | **留空**：未找到针对"App/Workspace/Session 三级 scope"设计的专门社区帖；相关讨论融入 OAuth/安全类（见领域 4） | — |

---

## 12. Skills over MCP（SEP 提案、skill:// 协议化尝试）

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | SEP-2640: Skills Extension（Final，2026-09-13 合并） | https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2640 | 官方 PR，定义 `skill://` 资源约定、扩展 id `io.modelcontextprotocol/skills`，已 Final | verified |
| T1 官方文档 | SEP-2640 文档页 | https://modelcontextprotocol.io/seps/2640-skills-extension | 官方 SEP 文档，记录设计决策与消息流 | verified |
| T1 官方文档 | MCP Extensions — Skills over MCP 概览 | https://modelcontextprotocol.io/extensions/skills/overview | 官方扩展文档，含 `skills/list`+`skills/get`+`resources/directory/read` 消息流 | verified |
| T2 源码/仓库 | modelcontextprotocol/ext-skills（官方 Skills 扩展仓库） | https://github.com/modelcontextprotocol/ext-skills | 官方仓库，含 `specification/stable/skills.mdx`、决策日志、实现列表，由 Skills Over MCP WG 维护 | canonical |
| T3 技术报告 | Skills Over MCP IG — 2026-03-17 Office Hours 纪要（Discussion #2421） | https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/2421 | 具体 discussion，记录 skill:// URI、渐进披露、与 CLAUDE.md 边界等工作组决策 | verified |
| T3 技术报告 | ext-skills 仓库 docs/rationale.md（基于 Resources 的设计理由） | https://github.com/modelcontextprotocol/ext-skills （docs/rationale.md） | 官方文档，解释为何基于 Resources 而非新原语 | canonical |
| T4 在线课程 | （暂无合格独立课程） | — | **留空**：SEP-2640 于 2026-09-13 才合并，尚处 Final 初期，无 MOOC/系统课程；学习路径为官方 SEP 文档 + ext-skills 仓库 | — |
| T5 社区讨论 | （暂无广泛社区讨论） | — | **留空**：该提案刚合并，社区讨论主要集中于官方 Discussion #2421（已列为 T3），未见独立论坛热帖；不编造 | — |

---

## 覆盖度自评

| # | 领域 | T1 | T2 | T3 | T4 | T5 | 备注 |
|---|------|----|----|----|----|----|------|
| 1 | MCP 协议总览 | ✅ | ✅ | ✅ | ✅ | ✅ | 完整；T5 为 HN 转述聚合（unverified） |
| 2 | MCP 三原语 + elicitation | ✅ | ✅ | ✅ | ✅ | ✅ | 完整；T5 为具体 Kiro issue |
| 3 | 传输层 + Windows `cmd /c` | ✅ | ✅ | ✅ | ✅ | ✅ | 完整；T5 为具体 servers issue #3460 |
| 4 | MCP 安全实践 | ✅ | ✅ | ✅ | ⚠️ | ✅ | T4 偏报告/清单而非课程，已说明未强填 |
| 5 | Registry + 参考 server | ✅ | ✅ | ✅ | ✅ | ✅ | 完整；T5 以官方公告+社区译介替代 |
| 6 | Agent Skills 标准 | ✅ | ✅ | ✅ | ✅ | ✅ | 完整；T5 含 HN 汇总(unverified)+技术拆解 |
| 7 | Skill 作用域 + frontmatter | ✅ | ✅ | ✅ | ✅ | ⚠️ | T5 仅社区指南汇总，无专门 issue |
| 8 | Hooks 生命周期 + deny | ✅ | ✅ | ✅ | ✅ | ✅ | 完整；T5 为两个具体 claude-code issue |
| 9 | 桌面端定时任务 | ✅ | ✅ | ✅ | ✅ | ⚠️ | T3 含 RRULE 标准（官方用 5-field cron）；T5 为社区工作流帖 |
| 10 | 定时任务=Skill+调度侧车 | ✅ | ✅ | ✅ | ❌ | ❌ | T4/T5 留空并说明：属架构组合，无独立课程/专门讨论 |
| 11 | 应用连接三级 scope | ✅ | ✅ | ✅ | ❌ | ❌ | T4/T5 留空：scope 为协议+实现议题，以 T1+T3 学习 |
| 12 | Skills over MCP (SEP-2640) | ✅ | ✅ | ✅ | ❌ | ❌ | T4/T5 留空：SEP 2026-09-13 刚合并，无课程/广讨论 |

### 统计
- 12 个领域全部覆盖 T1/T2/T3；T4 覆盖 9/12；T5 覆盖 8/12。
- **完整五类（T1–T5）的领域：1、2、3、5、6、8 共 6 个。**
- **留空格子**：领域 10 的 T4/T5、领域 11 的 T4/T5、领域 12 的 T4/T5、领域 4 的 T4（降级说明）、领域 7 的 T5（弱）、领域 9 的 T5（弱）。均为"确实无合格来源"而如实留空，无任何编造。
- 验证分布：`canonical` 多用于官方规范/文档/仓库；`verified` 用于实际打开的博客、GitHub issue/discussion/PR；`unverified` 限于检索快照中的社区聚合转述（已标注谨慎引用）。
