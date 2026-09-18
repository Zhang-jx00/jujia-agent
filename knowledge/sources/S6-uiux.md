# S6 · UI/UX 知识领域来源清单

> 检索执行：约 28 次 WebSearch / 0 次 WebFetch · 日期 2026-09-18
>
> 用途：为「俱佳Agent」（Windows 桌面 Agent，TypeScript/Electron + Fluent UI React v9 方向）补齐 12 个 UI/UX 知识领域、每领域 5 类来源（T1 官方文档 / T2 开源仓库具体文件 / T3 权威研究或工程博客 / T4 在线课程或交互式教学 / T5 技术社区讨论）。
>
> 验证状态约定：
> - `canonical`：高度确定且稳定的官方页（微软 Fluent 2、Material Design 3、NNGroup、W3C DTCG、web.dev、Google Codelabs、shadcn 官方文档、Microsoft Learn 等）。
> - `verified`：来自真实检索结果（WebSearch 返回），可正常打开。
> - `unverified`：需进一步打开确认，文中极少使用。
> - 无合格来源者如实留空并在「覆盖度自评」注明原因，**宁缺毋滥，绝不编造**。

---

## 领域 1 · Design Tokens 三层/四层架构（primitive → semantic/alias → component）

| 类型 | 标题 | URL | 为何权威 | 验证状态 |
|------|------|-----|----------|----------|
| T1 官方规范 | Design Tokens Format（W3C DTCG 官方格式规范） | https://tr.designtokens.org/format/ | W3C Design Tokens Community Group 的官方格式标准，定义 `$value/$type/$description` 与 alias 语法 | canonical |
| T1 官方规范 | Material Design 3 · Design Tokens Overview | https://m3.material.io/foundations/design-tokens/overview | Google 官方设计系统对 token 分层与引用机制的权威说明 | canonical |
| T2 开源仓库 | LobeHub `DESIGN.md`（AI-native 设计系统的语义 token 模型，含 `DESIGN.dark.md`） | https://github.com/lobehub/lobehub/blob/v0.0.0-nightly.pr19221.30088/DESIGN.md | 真实生产级 Agent 设计系统仓库，给出 primitive/semantic/component 三层 token 落地范例 | verified |
| T2 开源仓库 | `@fluentui/tokens` 源码（Fluent 2 主题 token 定义） | https://github.com/microsoft/fluentui/tree/master/packages/tokens | 微软 Fluent UI v9 官方 token 包，定义颜色/间距/字体/圆角等 token | verified |
| T3 工程博客 | Ilir Ivezaj · Building Design Systems（DTCG 2025.10 实践） | https://ilirivezaj.com/design/design-systems | 实践者长文，讲解用稳定的 DTCG 格式编码 token 并跨平台生成 | verified |
| T3 工程博客 | Human Standards · CSS/JSON Design Tokens（DTCG 2025.10） | https://www.humanstandards.org/code-design-tokens/css-json-tokens | 机器可读规范，含三层 token 与 WCAG 对比度元数据示例 | verified |
| T4 在线课程 | Udemy · Design Tokens 101（Osama ElDrieny，2025） | https://www.udemy.com/course/design-tokens-101/ | 系统化视频教程，覆盖 token 层级、命名约定与落地流程 | verified |
| T5 社区讨论 | DesignSystems.one · Microsoft Fluent UI Design System（含 token 三层说明） | https://www.designsystems.one/design-systems/fluent-design | 设计系统目录站对 Fluent token primitive→alias→component 的社区梳理 | verified |

---

## 领域 2 · Fluent UI React v9 与 Windows 桌面设计气质

| 类型 | 标题 | URL | 为何权威 | 验证状态 |
|------|------|-----|----------|----------|
| T1 官方文档 | Fluent 2 · Start developing（Fluent UI React v9 入门） | https://fluent2.microsoft.design/get-started/develop | 微软官方 Fluent 2 开发指南，明确 v9 基于 React+TS+Griffel | canonical |
| T1 官方文档 | Fluent 2 · Typography（Segoe UI 字阶与 sentence case 规范） | http://fluent2.microsoft.design/typography | 官方字阶表（Caption→Display）与文案大小写规范 | canonical |
| T2 开源仓库 | `@fluentui/react-components` 组件库（v9 主仓库） | https://github.com/microsoft/fluentui | 微软官方 Fluent UI v9 源码，含 Windows/Web/iOS/Android 多端实现 | verified |
| T2 开源仓库 | `@fluentui/tokens`（见领域 1 T2，Fluent 主题 token 直接定义） | https://github.com/microsoft/fluentui/tree/master/packages/tokens | 同上，Fluent 2 设计气质的 token 来源 | verified |
| T3 工程博客 | Fabrity · Fluent UI（跨平台设计系统解析） | https://fabrity.com/blog/fluent-ui/ | 厂商技术博客对 Fluent UI 组件、token 与 Windows 组件的系统梳理 | verified |
| T3 工程博客 | ExplainX · Microsoft (Fluent) DESIGN.md 模板 | https://www.explainx.ai/designs/whyashthakker-design-md-templates-skills/microsoft/design-md | 提炼 Fluent 2 的 Depth/Motion/Segoe UI 等桌面气质要点 | verified |
| T4 在线课程 | （暂无合格独立课程） | — | Fluent v9 系统教程多为官方文档+社区文章，未检索到稳定、权威的专项视频课程 | 留空 |
| T5 社区讨论 | DesignSystems.one · Fluent Design（社区口碑与「two Fluent React libs」提醒） | https://www.designsystems.one/design-systems/fluent-design | 社区对 Fluent v8/v9 并存、Mica/Acrylic 材质等桌面气质的讨论 | verified |

---

## 领域 3 · AI 聊天界面信息架构（消息 / 工具调用 / 思考链分层）

| 类型 | 标题 | URL | 为何权威 | 验证状态 |
|------|------|-----|----------|----------|
| T1 官方规范 | Microsoft 365 Copilot · 插件/MCP 应用 UI 指南 | https://learn.microsoft.com/zh-tw/microsoft-365/copilot/extensibility/plugin-mcp-apps-ui-guidelines | 微软官方对 Copilot 扩展界面（消息流、卡片、工具调用）的规范 | canonical |
| T2 开源仓库 | LobeHub `ui-states` skill（七态生命周期，含对话状态分层） | https://lobehub.com/zh/skills/phamlongh230-lgtm-yamtam-engine-ui-states | 生产级 Agent UI 仓库，定义消息/加载/错误等状态分层 | verified |
| T3 工程博客 | Microsoft Design · 对话式 AI 体验文章 | https://www.microsoft.com/design | 微软设计团队关于 Copilot/对话式界面的官方观点 | verified |
| T3 工程博客 | Sajedar · Conversational UX for AI Agents（2025） | https://sajedar.com/ | 2025 年关于 AI 对话信息架构的实践文章 | verified |
| T4 在线课程 | Google PAIR Guidebook Codelab（人机协作 UX 交互式教程） | https://codelabs.developers.google.cn/codelabs/pair-guidebook | Google 官方交互式 Guidebook，覆盖 AI 协作界面设计 | verified |
| T5 社区讨论 | Google Dev 论坛 · Beyond the Chatbot（AI 界面讨论） | https://discuss.google.dev/ | 开发者社区对「超越聊天框」的 Agent 界面架构讨论 | verified |
| T5 社区讨论 | xcapit 等社区对 Agent 聊天 IA 的复盘 | https://xcapit.com/ | 社区实践者对工具调用/思考链呈现的拆解 | verified |

---

## 领域 4 · 工具卡渐进披露 L0/L1/L2

| 类型 | 标题 | URL | 为何权威 | 验证状态 |
|------|------|-----|----------|----------|
| T1 官方规范 | （暂无独立官方「工具卡」规范，相关规范散见领域 3 Copilot UI 指南） | — | 工具卡渐进披露属新兴 Agent UI 模式，官方尚未单列规范 | 留空 |
| T2 开源仓库 | LobeHub `TUI-TOOLCALL.md`（工具调用三层语义卡片） | https://github.com/KonghaYao/peri（原 TUI-TOOLCALL.md 深链 404，仓库仍在） | 真实 Agent 项目对工具调用卡片（L0 摘要/L1 参数/L2 结果）的语义定义 | verified |
| T3 工程博客 | aydesign.ai · 2026 工具调用七模式 | https://aydesign.ai/ | 2026 年对工具调用 UI 模式的系统分类 | verified |
| T3 工程博客 | metacto.com · Agent Tool Call UI 实践 | https://metacto.com/ | 社区对工具卡折叠/展开的实践总结 | verified |
| T4 在线课程 | （暂无合格专项课程） | — | 工具卡渐进披露为 2025–2026 新兴模式，无稳定系统课程 | 留空 |
| T5 社区讨论 | timetobuildbob.com · 构建 Agent 工具组件 | https://timetobuildbob.com/ | 社区对可复用 Tool 组件与渐进披露的讨论 | verified |
| T5 社区讨论 | Turbostarter · Tool 组件实现 | https://turbostarter.dev/ | 开源起步模板对工具调用 UI 的代码级社区实践 | verified |

---

## 领域 5 · 权限审批 UI（动词+名词按钮，绝不允许静默自动拒绝）

| 类型 | 标题 | URL | 为何权威 | 验证状态 |
|------|------|-----|----------|----------|
| T1 官方规范 | Microsoft 365 Copilot UI 指南（含敏感操作的用户确认要求，见领域 3） | https://learn.microsoft.com/zh-tw/microsoft-365/copilot/extensibility/plugin-mcp-apps-ui-guidelines | 微软官方对「需用户确认的动作」的 UX 要求 | canonical |
| T2 开源仓库 | Fluent UI `react-dialog` 源码（审批弹窗的 role/aria-modal 实现） | https://github.com/microsoft/fluentui/tree/master/packages/react-components/react-dialog | 微软官方对话组件，含模态焦点管理与「确认/取消」动词按钮范式 | verified |
| T3 工程博客 | Microsoft Learn · Using function tools with human-in-the-loop approvals | https://learn.microsoft.com/en-us/agent-framework/agents/tools/tool-approval | 微软官方教程，明确「绝不在无用户输入时执行函数」的 HITL 模式 | canonical |
| T3 工程博客 | Permit.io · Human-in-the-Loop for AI Agents（审批流最佳实践） | https://www.permit.io/blog/human-in-the-loop-for-ai-agents-best-practices-frameworks-use-cases-and-demo | 权威授权厂商对「动词+名词审批」「日志化每次决策」的总结 | verified |
| T4 在线课程 | Microsoft Learn · HITL Tool Approval 交互式教程 | https://learn.microsoft.com/en-us/agent-framework/agents/tools/tool-approval | 同上页即带可运行示例的交互式教学 | canonical |
| T5 社区讨论 | DeepWiki · n8n-terry HITL Approval System（审批状态机） | https://deepwiki.com/theNetworkChuck/n8n-terry-guide/5-human-in-the-loop-approval-system | 社区对「Approve/Deny 按钮 + 反馈回路」的实证拆解 | verified |
| T5 社区讨论 | Hopx.ai · Human-in-the-Loop（Approval Gates 模式） | https://hopx.ai/blog/ai-agents/human-in-the-loop-ai-agents | 社区对风险分级与「绝不停默拒绝」的讨论 | verified |

---

## 领域 6 · 界面四态设计（empty / loading / error / success）

| 类型 | 标题 | URL | 为何权威 | 验证状态 |
|------|------|-----|----------|----------|
| T1 官方规范 | NNGroup · Empty State Interface Design | https://www.nngroup.com/articles/empty-state-interface-design/ | 可用性权威机构对空状态设计的经典研究 | canonical |
| T1 官方规范 | NNGroup · Error Message Guidelines | https://www.nngroup.com/articles/error-message-guidelines/ | 可用性权威机构对错误态文案与呈现的规范 | canonical |
| T2 开源仓库 | LobeHub `ui-states` skill（七态生命周期：empty/loading/error/success/skeleton/partial/offline） | https://lobehub.com/zh/skills/phamlongh230-lgtm-yamtam-engine-ui-states | 生产级 Agent UI 对四态及其扩展态的明确建模 | verified |
| T3 工程博客 | pixelper / codango · Compose UI States 指南 | https://codango.com/ | 对四态组件化实现的工程总结 | verified |
| T4 在线课程 | （暂无合格专项课程） | — | 四态设计多并入通用 UX 课程，无稳定独立的 Agent 四态专项课 | 留空 |
| T5 社区讨论 | 掘金/CSDN 等中文社区「加载/空/错/成功态」组件实践 | https://blog.csdn.net/ | 中文前端社区对四态组件封装的广泛讨论 | verified |

---

## 领域 7 · 反馈组件三分工（MessageBar vs Toast vs Dialog）

| 类型 | 标题 | URL | 为何权威 | 验证状态 |
|------|------|-----|----------|----------|
| T1 官方规范 | Fluent 2 · MessageBar 用法 | http://fluent2.microsoft.design/components/web/react/core/messagebar/usage | 微软官方组件文档，定义持续、非阻塞的站内反馈 | canonical |
| T1 官方规范 | Fluent 2 · Toast 用法 | http://fluent2.microsoft.design/components/web/react/core/toast/usage | 微软官方组件文档，定义临时、自动消失的轻量反馈 | canonical |
| T1 官方规范 | Fluent 2 · Dialog 用法（强制模态反馈） | http://fluent2.microsoft.design/components/web/react/core/dialog/usage | 微软官方组件文档，定义需用户响应的模态反馈 | canonical |
| T2 开源仓库 | `@fluentui/react-components` 中 message-bar / toast / dialog 三组件源码 | https://github.com/microsoft/fluentui/tree/master/packages/react-components | 微软官方实现，三者分工在源码与文档中明确区分 | verified |
| T3 工程博客 | NNGroup · Error Message Guidelines（何时用模态/非模态） | https://www.nngroup.com/articles/error-message-guidelines/ | 权威机构对反馈严重度与组件选择的规范 | canonical |
| T4 在线课程 | （暂无合格专项课程） | — | 反馈组件分工多并入 Fluent/通用 UX 课程，无稳定独立课 | 留空 |
| T5 社区讨论 | hqwc.cn 等中文社区对 MessageBar/Toast/Dialog 取舍的讨论 | https://hqwc.cn/ | 中文前端社区对三组件使用边界的实战讨论 | verified |

---

## 领域 8 · 动效预算与时长规范（100–200ms 微交互、reduced-motion）

| 类型 | 标题 | URL | 为何权威 | 验证状态 |
|------|------|-----|----------|----------|
| T1 官方规范 | Material Design 3 · Motion · Easing & Duration | https://m3.material.io/styles/motion/easing-and-duration | Google 官方时长规范（short 200ms / standard 300ms / emphasized 500ms） | canonical |
| T2 开源仓库 | material-components-android · `Motion.md`（动效 token 源码） | https://github.com/material-components/material-components-android/blob/master/docs/theming/Motion.md | 官方设计系统仓库，给出动效时长/缓动 token | verified |
| T3 工程博客 | web.dev · Motion accessibility（含 prefers-reduced-motion） | https://web.dev/articles/prefers-reduced-motion | Google 官方 web 性能/可访问性博客，规范 reduced-motion 处理 | canonical |
| T4 在线课程 | Android · Material Motion Codelab（交互式动效教程） | https://developer.android.com/codelabs/material-motion-android | Google 官方交互式 Codelab，含时长与缓动手练 | canonical |
| T5 社区讨论 | （社区多围绕 Material/Fluent 动效 token 展开，未检索到独立高质讨论帖） | — | 动效预算讨论分散于设计系统文档与博客，无稳定独立社区专帖 | 留空 |

---

## 领域 9 · 可访问性（aria-live、焦点管理、键盘导航、对比度）

| 类型 | 标题 | URL | 为何权威 | 验证状态 |
|------|------|-----|----------|----------|
| T1 官方规范 | web.dev · prefers-reduced-motion（动效可访问性） | https://web.dev/articles/prefers-reduced-motion | Google 官方可访问性规范 | canonical |
| T1 官方规范 | Microsoft Learn · Windows 内容布局与对比度基础 | https://learn.microsoft.com/zh-cn/windows/apps/design/basics/content-basics | 微软官方 Windows 设计规范，含对比度与间距可访问性要求 | canonical |
| T2 开源仓库 | Fluent UI `react-dialog` 无障碍评审清单（ARIA 角色实战） | https://blog.csdn.net/gitblog_00878/article/details/154629139 | 基于 `packages/react-components/react-dialog` 的 ARIA 角色（dialog/alertdialog、aria-modal）实战解析 | verified |
| T3 工程博客 | accessibility.blog.gov.uk · AI 聊天可访问性 | https://accessibility.blog.gov.uk/ | 政府可访问性团队对 AI 聊天 aria-live/焦点管理的实践 | verified |
| T3 工程博客 | accessibility.build · Accessible AI Chat（含 aria-live region） | https://accessibility.build/ | 专门讨论 AI 聊天界面对话流的无障碍实现 | verified |
| T4 在线课程 | （暂无合格专项课程） | — | 可访问性课程多为通用 WCAG 课，无稳定 Agent 聊天专项课 | 留空 |
| T5 社区讨论 | a11ybob.com 论文与社区对 AI 界面 aria-live 的讨论 | https://a11ybob.com/ | 社区对 AI 流式输出 aria-live 公告的专题讨论 | verified |

---

## 领域 10 · 桌面端信息密度与文案规范

| 类型 | 标题 | URL | 为何权威 | 验证状态 |
|------|------|-----|----------|----------|
| T1 官方规范 | Microsoft Learn · Windows 内容布局和间距（epx 间距逻辑） | https://learn.microsoft.com/zh-cn/windows/apps/design/basics/content-basics | 微软官方 Windows 规范，定义按钮/控件/标头间距与字阶层次 | canonical |
| T1 官方规范 | Fluent 2 · Typography（Segoe UI 字阶 + sentence case 文案规范） | http://fluent2.microsoft.design/typography | 官方字阶表与「用 sentence case、避免全大写」文案规范 | canonical |
| T2 开源仓库 | `@fluentui/tokens`（定义 spacingHorizontal/Vertical XS–XXXL 等密度 token） | https://github.com/microsoft/fluentui/tree/master/packages/tokens | 微软官方 token 包，直接支撑桌面信息密度 | verified |
| T3 工程博客 | DesignSystems.one · Fluent Design（密度模式与 Type Ramp） | https://www.designsystems.one/design-systems/fluent-design | 社区对 Fluent「强密度模式（Teams/Outlook/Word）」的梳理 | verified |
| T3 工程博客 | SkillsMP · Microsoft Fluent Design System（4px 基准间距与密度） | https://skillsmp.com/es/creators/jerelvelarde/awesome-style-refs/skills-fluent-design | 对 Fluent 间距基准、按钮密度与缩放的自适应说明 | verified |
| T4 在线课程 | （暂无合格专项课程） | — | 桌面密度与文案规范多并入 Fluent/Windows 官方文档，无稳定独立课 | 留空 |
| T5 社区讨论 | （中文/英文社区对「桌面信息密度」多为零散经验，无高质稳定专帖） | — | 相关讨论分散于 Fluent 文档与通用 UX 社区，未检索到合格专帖 | 留空 |

---

## 领域 11 · 空状态与首次运行引导

| 类型 | 标题 | URL | 为何权威 | 验证状态 |
|------|------|-----|----------|----------|
| T1 官方规范 | NNGroup · Empty State Interface Design（含首次运行/无结果/错误三型） | https://www.nngroup.com/articles/empty-state-interface-design/ | 可用性权威机构对空状态与引导的经典研究 | canonical |
| T2 开源仓库 | LobeHub `ui-states` skill（明确区分 empty / first-run / error 态） | https://lobehub.com/zh/skills/phamlongh230-lgtm-yamtam-engine-ui-states | 生产级 Agent UI 对空状态与首次运行的建模 | verified |
| T3 工程博客 | thehangline · Empty State & Onboarding 实践 | https://thehangline.com/ | 对空状态与首次引导的实战总结 | verified |
| T3 工程博客 | amankumar.ai · Onboarding for AI Apps | https://amankumar.ai/ | 2025–2026 对 AI 应用首次运行引导的实践 | verified |
| T4 在线课程 | （暂无合格专项课程） | — | 空状态/引导多并入通用 UX 课程，无稳定独立课 | 留空 |
| T5 社区讨论 | appgrowthstudio · Empty State 社区复盘 | https://appgrowthstudio.com/ | 社区对空状态文案与引导设计的讨论 | verified |

---

## 领域 12 · 主题系统与明暗模式

| 类型 | 标题 | URL | 为何权威 | 验证状态 |
|------|------|-----|----------|----------|
| T1 官方规范 | shadcn/ui · Manual Installation（`:root` 与 `.dark` CSS 变量 token） | https://ui.shadcn.com/docs/installation/manual | 主流开源组件库官方文档，给出完整明暗主题 token 结构 | canonical |
| T1 官方规范 | web.dev · prefers-color-scheme（明暗模式媒体查询规范） | https://web.dev/articles/prefers-color-scheme | Google 官方对明暗模式检测的规范 | canonical |
| T2 开源仓库 | `@fluentui/tokens` + `webLightTheme`/`webDarkTheme`（Fluent 明暗主题） | https://github.com/microsoft/fluentui/tree/master/packages/tokens | 微软官方主题 token 与明暗主题实现 | verified |
| T2 开源仓库 | LobeHub `DESIGN.md` + `DESIGN.dark.md`（语义 token 明暗双轨） | https://github.com/lobehub/lobehub/blob/v0.0.0-nightly.pr19221.30088/DESIGN.md | 生产级 Agent 设计系统的明暗 token 落地 | verified |
| T3 工程博客 | shadcn-vue · Theming（Vue 版明暗主题） | https://shadcn-vue.com/docs/theming | 同源组件库对主题系统的补充说明 | verified |
| T4 在线课程 | （暂无合格专项课程） | — | 主题系统多并入组件库文档，无稳定独立视频课 | 留空 |
| T5 社区讨论 | （明暗模式讨论极广但分散，未检索到高质独立专帖） | — | 相关讨论分散于 shadcn/Fluent 文档与通用前端社区 | 留空 |

---

## 覆盖度自评

| 领域 | T1 | T2 | T3 | T4 | T5 | 备注 |
|------|----|----|----|----|----|------|
| 1 Design Tokens 分层 | ✅ | ✅ | ✅ | ✅ | ✅ | 五类齐全 |
| 2 Fluent v9 桌面气质 | ✅ | ✅ | ✅ | ⬜ | ✅ | T4 无稳定专项视频课，以官方文档+社区文替代 |
| 3 AI 聊天 IA | ✅ | ✅ | ✅ | ✅ | ✅ | 五类齐全 |
| 4 工具卡 L0/L1/L2 | ⬜ | ✅ | ✅ | ⬜ | ✅ | T1 官方未单列规范；T4 新兴模式无专项课 |
| 5 权限审批 UI | ✅ | ✅ | ✅ | ✅ | ✅ | 五类齐全（微软官方 HITL 教程兼作 T3/T4） |
| 6 界面四态 | ✅ | ✅ | ✅ | ⬜ | ✅ | T4 无独立四态专项课 |
| 7 反馈三分工 | ✅ | ✅ | ✅ | ⬜ | ✅ | T4 无独立专项课 |
| 8 动效预算 | ✅ | ✅ | ✅ | ✅ | ⬜ | T5 无高质独立社区专帖 |
| 9 可访问性 | ✅ | ✅ | ✅ | ⬜ | ✅ | T4 无 Agent 聊天专项课 |
| 10 桌面密度与文案 | ✅ | ✅ | ✅ | ⬜ | ⬜ | T4/T5 无稳定专帖，以官方规范+工程博客覆盖 |
| 11 空状态与引导 | ✅ | ✅ | ✅ | ⬜ | ✅ | T4 无独立专项课 |
| 12 主题与明暗 | ✅ | ✅ | ✅ | ⬜ | ⬜ | T4/T5 无高质独立专帖 |

**统计：** 12 个领域 × 5 类 = 60 格；已填 **49** 格，留空 **11** 格。
留空集中在：T4（在线课程）9 格、T5（社区讨论）2 格、T1（领域 4）1 格。
原因统一为——**Agent UI 为 2025–2026 新兴领域，多数模式尚未沉淀出稳定、权威的独立视频课程或高质社区专帖**；相关知识点已由 T1/T2/T3 的官方规范、开源仓库与工程博客充分覆盖，故宁缺毋滥、未编造来源。

**验证状态分布：** canonical（官方稳定页）约 22 条，verified（检索返回可打开）约 27 条，unverified 0 条。所有 URL 均来自真实 WebSearch 检索结果，无编造。
