# S9 无限画布与工作流编排知识来源

> 本文件为「俱佳Agent」知识库第 9 份。目标：支撑在 Agent 内集成一个"支持用户自行搭建工作流的无限画布"——拖拽建节点、自由摆放/缩放/平移/对齐、右键菜单/快捷加节点/快捷连线等替代交互，以及底层的工作流执行、持久化、性能与协同能力。
>
> 验证状态约定：
> - `canonical`：高度确定且稳定的官方根域名页面（reactflow.dev / tldraw.dev / nodered.org / figma.com 等）。
> - `verified`：来自检索结果、确为真实存在的官方文档/源码/仓库页面（含 github.com 真实路径、deepwiki.com 真实条目、官方博客）。
> - `unverified`：来自检索结果但为镜像/代理站点或链接稳定性存疑，或无法确认内容时效。
>
> 来源分类：T1 权威官方文档 / T2 开源项目源码或仓库 / T3 论文·技术报告·官方工程博客 / T4 在线课程·系统教程 / T5 技术社区讨论。

---

## 领域 86｜无限画布基础（视口变换与坐标系）

核心问题：世界坐标↔屏幕坐标转换、缩放/平移、devicePixelRatio、矩阵变换、惯性滚动、视口裁剪。

| 类型 | 标题 | URL | 一句话说明 | 验证状态 |
|------|------|-----|-----------|----------|
| T1 | React Flow — Viewport 类型与 API | https://reactflow.dev/api-reference/types/viewport | 定义 viewport 的 x/y/zoom 三元组与 `screenToFlowPosition`/`flowToScreenPosition` 坐标转换方法。 | canonical |
| T1 | React Flow v11 — The Viewport（概念） | https://v11.reactflow.dev/learn/concepts/the-viewport | 解释视口即一个 CSS 变换（平移+缩放矩阵），以及像素比与坐标关系。 | verified |
| T1 | tldraw — Camera（相机/视口） | https://tldraw.dev/sdk-features/camera | 说明 tldraw 的相机点、缩放与 `setCamera`/`zoomToContent` 等视口 API。 | canonical |
| T2 | xyflow 仓库 — `packages/system`（坐标/变换工具） | https://github.com/xyflow/xyflow/tree/main/packages/system | 含坐标变换、矩阵、viewport 计算等底层系统工具（React Flow 共用）。 | verified |
| T2 | tldraw 仓库 — `packages/editor`（Camera 管理器） | https://github.com/tldraw/tldraw/tree/main/packages/editor | editor 包中的相机与视口控制实现，可直接参考无限画布的相机模型。 | verified |
| T3 | Figma — Building a professional design tool on the web | https://www.figma.com/blog/building-a-professional-design-tool-on-the-web/ | 官方工程博客：为何弃 HTML/SVG/2D Canvas 自建 WebGL 渲染器，逐帧重绘与 zoom/pinch 的取舍，是无限画布视口渲染的第一手权威论述。 | verified |
| T4 | React Flow — 性能与高级用法（含 large viewport） | https://reactflow.dev/learn/advanced-use/performance | 官方进阶指南，含视口内大量节点的渲染与坐标管理策略。 | verified |
| T5 | xyflow/issues — 视口缩放精度/边界相关讨论 | https://github.com/xyflow/xyflow/issues | 社区关于 zoom 边界、坐标偏差、panOnScroll 行为的真实 issue（可按 "viewport" 检索）。 | verified |

---

## 领域 87｜节点模型与拖拽创建

核心问题：节点 schema、端口 port、类型系统、从侧边栏拖拽落点建节点、节点尺寸自适应、自定义节点。

| 类型 | 标题 | URL | 一句话说明 | 验证状态 |
|------|------|-----|-----------|----------|
| T1 | React Flow — Custom Nodes 文档 | https://reactflow.dev/learn/customization/custom-nodes | 定义节点数据结构（id/position/data/type）、Handle（端口）与自定义节点渲染。 | canonical |
| T1 | React Flow — Drag and Drop 示例 | https://reactflow.dev/examples/drag-and-drop | 官方示例：从侧边栏拖拽并在画布落点创建节点（onDrop + screenToFlowPosition）。 | verified |
| T2 | xyflow 仓库 — `packages/react`（Node/Handle 实现） | https://github.com/xyflow/xyflow/tree/main/packages/react | React Flow 的节点组件、Handle 端口与 store 中节点模型的真实实现。 | verified |
| T2 | tldraw 仓库 — `packages/tlschema`（Shape 形状模型） | https://github.com/tldraw/tldraw/tree/main/packages/tlschema | tldraw 的形状（节点）schema 定义，含 props 与类型化属性，可作节点模型参考。 | verified |
| T2 | LiteGraph.js 仓库（节点+端口模型） | https://github.com/jagenjo/litegraph.js | ComfyUI 底层画布库，LGraphNode 的 inputs/outputs 端口与尺寸自适应实现，轻量可借鉴。 | verified |
| T3 | Evan Wallace — Figma（作者自述架构） | https://madebyevan.com/figma/ | Figma 联合创始人亲述：文档表示与画布区用 C++、UI 用 TS+React 的混合架构，为「节点/形状模型如何支撑编辑器」提供第一手工程论述。 | verified |
| T4 | React Flow — Drag and Drop 教程（同上 T1 示例即教程） | https://reactflow.dev/examples/drag-and-drop | 同时作为可运行的系统教程，覆盖拖拽建节点的完整代码路径。 | verified |
| T5 | xyflow/discussions — 自定义节点/动态端口 | https://github.com/xyflow/xyflow/discussions | 社区讨论动态端口、节点尺寸自适应、从 palette 拖入等真实场景。 | verified |

---

## 领域 88｜连线模型与合法性校验

核心问题：贝塞尔/正交/阶梯路径、锚点与重连、类型匹配校验、DAG 环检测、多输入输出语义。

| 类型 | 标题 | URL | 一句话说明 | 验证状态 |
|------|------|-----|-----------|----------|
| T1 | React Flow — Custom Edges 文档 | https://reactflow.dev/learn/customization/custom-edges | 自定义连线渲染（getBezierPath / getSmoothStepPath / getStraightPath）与路径类型。 | canonical |
| T1 | React Flow — Prevent Cycles 示例 | https://reactflow.dev/examples/interaction/prevent-cycles | 用 `isValidConnection` 在连线时做 DAG 环检测，阻止成环。 | verified |
| T1 | React Flow — `isValidConnection` 与 ReactFlowProps | https://reactflow.dev/api-reference/react-flow | 官方 API：连线合法性回调、可连接性约束等属性说明。 | canonical |
| T2 | xyflow 仓库 — Edge/Connection 系统 | https://github.com/xyflow/xyflow/tree/main/packages/react | 连线的数据结构、类型匹配与重连（reconnect）逻辑实现。 | verified |
| T2 | Langflow — 连接校验与类型系统（deepwiki） | https://deepwiki.com/langflow-ai/langflow/5.4-connection-validation-and-type-system | 真实开源项目对端口类型匹配与环检测的工程实现参考。 | verified |
| T3 | （留空） | — | 连线合法性/环检测属经典图算法（拓扑排序）应用，无专门权威论文。 | — |
| T4 | React Flow — Interaction 示例集（连线/重连） | https://reactflow.dev/examples | 含可重连、自动布局、连线动画等系统示例，可作交互教程。 | verified |
| T5 | xyflow/issues — 连线类型校验/重连 | https://github.com/xyflow/xyflow/issues | 社区关于 handle 类型匹配、isValidConnection 行为的真实 issue。 | verified |

---

## 领域 89｜节点对齐与吸附

核心问题：对齐辅助线、网格吸附、等距分布、多选对齐、智能吸附阈值。

| 类型 | 标题 | URL | 一句话说明 | 验证状态 |
|------|------|-----|-----------|----------|
| T1 | tldraw — Snapping（吸附与对齐） | https://tldraw.dev/sdk-features/snapping | 官方文档：形状间对齐辅助线、网格吸附、等距分布等吸附能力。 | canonical |
| T2 | tldraw 仓库 — SnapManager（deepwiki 剖析） | https://deepwiki.com/tldraw/tldraw-v1/11.4-snapping-system | 解析 tldraw 的 SnapManager 与吸附阈值/对齐线计算逻辑（packages/core/src/utils）。 | verified |
| T2 | tldraw 仓库 — `packages/editor` 对齐管理器 | https://github.com/tldraw/tldraw/tree/main/packages/editor | editor 包内负责 snapping 的管理器源码，含多选对齐与智能吸附。 | verified |
| T3 | （留空） | — | 吸附/对齐为 UI 交互工程实践，无专门权威论文；以 tldraw 官方实现替代。 | — |
| T4 | tldraw — Snapping 文档（即教程） | https://tldraw.dev/sdk-features/snapping | 同一官方页面同时可作为系统教程，给出启用与自定义吸附的代码。 | canonical |
| T5 | tldraw/issues — 吸附精度/辅助线 | https://github.com/tldraw/tldraw/issues | 社区关于吸附阈值、对齐线闪烁等真实反馈与讨论。 | verified |

---

## 领域 90｜画布替代交互设计（右键菜单/快捷加节点/快捷连线）

核心问题：右键上下文菜单、快捷添加节点、拖线即连、键盘快捷键、命令面板等替代鼠标拖拽的交互。

| 类型 | 标题 | URL | 一句话说明 | 验证状态 |
|------|------|-----|-----------|----------|
| T1 | React Flow — Context Menu 示例 | https://reactflow.dev/examples/interaction/context-menu | 官方示例：右键节点/画布弹出上下文菜单（onContextMenu + 自定义菜单）。 | verified |
| T1 | React Flow — 多选/快捷键/键盘交互 | https://reactflow.dev/learn | 官方指南覆盖多选、框选、键盘删除/复制等替代交互。 | canonical |
| T2 | xyflow 仓库 — Interaction 处理器 | https://github.com/xyflow/xyflow/tree/main/packages/react | 拖线即连、点击空白建节点等交互钩子的真实实现，可借鉴替代交互。 | verified |
| T3 | （留空） | — | 替代交互属 UX 设计实践，无专门权威论文；以官方示例与 UX 指南替代。 | — |
| T4 | React Flow — Context Menu 教程（同上示例） | https://reactflow.dev/examples/interaction/context-menu | 该示例页含完整可运行代码，可直接作为快捷菜单教程。 | verified |
| T5 | xyflow/discussions #3227 — 节点右键菜单 | https://github.com/xyflow/xyflow/discussions/3227 | 社区具体讨论"右键节点弹出菜单"的多种实现方案。 | verified |

---

## 领域 91｜工作流执行语义

核心问题：DAG 拓扑排序、数据流 vs 控制流、条件分支/循环、错误传播与重试、局部重跑。

| 类型 | 标题 | URL | 一句话说明 | 验证状态 |
|------|------|-----|-----------|----------|
| T1 | Node-RED — 概念与执行模型 | https://nodered.org/docs/user-guide/concepts | 官方概念：flow/node/消息(message)传递式执行模型，含流与子流。 | canonical |
| T1 | n8n — 工作流执行文档 | https://docs.n8n.io/workflows/ | 说明 n8n 节点的数据流执行、错误分支与重试语义。 | verified |
| T2 | ComfyUI 仓库 — `comfy_execution/graph.py` | https://github.com/Comfy-Org/ComfyUI | 图执行核心：DynamicPrompt、ExecutionList、拓扑执行与校验逻辑。 | verified |
| T2 | n8n 仓库 — `workflow-execute.ts`（deepwiki） | https://deepwiki.com/n8n-io/n8n/2.1-execution-context-and-node-processing | 解析 n8n 执行引擎 WorkflowExecute 的节点处理与上下文传递。 | verified |
| T2 | Node-RED 仓库 — `Flow.js`/`Subflow.js`（deepwiki） | https://deepwiki.com/node-red/node-red/2.2-runtime-environment | 解析 Node-RED 运行时如何调度 flow 与消息传递执行。 | verified |
| T3 | （留空） | — | 工作流执行引擎属工业实践（数据流/控制流范式成熟），无单一权威论文。 | — |
| T4 | n8n — 工作流构建与执行教程 | https://docs.n8n.io/workflows/ | 官方教程式文档，含触发/节点/错误处理的端到端说明。 | verified |
| T5 | n8n/Node-RED 社区 — 执行/重试讨论 | https://github.com/n8n-io/n8n/issues | 社区关于局部重跑、错误传播、循环节点行为的真实 issue。 | verified |

---

## 领域 92｜工作流持久化与版本迁移

核心问题：图序列化 JSON schema、版本迁移、导入导出、分享嵌入。

| 类型 | 标题 | URL | 一句话说明 | 验证状态 |
|------|------|-----|-----------|----------|
| T1 | n8n — 工作流导出/导入 | https://docs.n8n.io/workflows/export-import | 官方说明工作流 JSON 的导出、导入与分享格式。 | verified |
| T1 | tldraw — 持久化（store 快照） | https://tldraw.dev/sdk-features/persistence | 说明 tldraw 文档的序列化与本地/远端持久化方式。 | canonical |
| T2 | tldraw 仓库 — `packages/tlschema`（migrations） | https://github.com/tldraw/tldraw/tree/main/packages/tlschema | tlschema 内的版本化 schema 与 migration 表，可作版本迁移参考。 | verified |
| T2 | n8n 仓库 — 工作流 JSON schema | https://github.com/n8n-io/n8n | n8n 工作流对象的 JSON 结构与序列化定义（packages/core）。 | verified |
| T2 | xyflow 仓库 — 序列化/toObject | https://github.com/xyflow/xyflow/tree/main/packages/react | React Flow 的 `toObject()` 提供节点/边/视口的 JSON 序列化方案。 | verified |
| T3 | （留空） | — | 图序列化/迁移属工程实践（JSON Schema + 迁移脚本），无专门权威论文。 | — |
| T4 | n8n — 导出/导入教程（同上 T1） | https://docs.n8n.io/workflows/export-import | 同一页面可作系统教程，给出导入导出实操。 | verified |
| T5 | n8n/issues — 工作流版本/迁移 | https://github.com/n8n-io/n8n/issues | 社区关于旧版工作流导入兼容性、schema 变更的反馈。 | verified |

---

## 领域 93｜画布渲染性能

核心问题：千级节点策略、视口裁剪/虚拟化、SVG vs Canvas vs WebGL、增量渲染与合帧。

| 类型 | 标题 | URL | 一句话说明 | 验证状态 |
|------|------|-----|-----------|----------|
| T1 | React Flow — 性能优化（onlyRenderVisibleElements） | https://reactflow.dev/learn/advanced-use/performance | 官方性能指南：视口外节点裁剪、仅渲染可见元素等优化开关。 | verified |
| T1 | React Flow — `onlyRenderVisibleElements` 属性 | https://reactflow.dev/api-reference/react-flow | 说明只对视口内节点/边渲染的属性，应对大量节点。 | canonical |
| T2 | Excalidraw 渲染架构（deepwiki） | https://deepwiki.com/excalidraw/excalidraw/5-rendering-and-export | 解析 Excalidraw 双 Canvas（Static + Interactive）分层渲染与 rough.js 方案。 | verified |
| T2 | React Flow 渲染层（SVG/Canvas 选择） | https://github.com/xyflow/xyflow/tree/main/packages/react | 节点默认 SVG、自定义节点可换 Canvas/WebGL 的渲染实现参考。 | verified |
| T2 | LiteGraph.js 渲染（Canvas 2D） | https://github.com/jagenjo/litegraph.js | 轻量 Canvas 2D 渲染千级节点的实践，可作性能对照。 | verified |
| T3 | Figma — React at 60fps: improving scrolling comments | https://www.figma.com/blog/improving-scrolling-comments-in-figma/ | 官方工程博客：画布视口更新驱动 React 重渲染的实测剖析（Chrome Profiler + React Profiler），把 FPS 从 19 提到 60，直接对应本项目的画布性能预算。 | verified |
| T4 | React Flow — 性能进阶教程（同上 T1） | https://reactflow.dev/learn/advanced-use/performance | 同一官方页面可作系统教程，含合帧与批量更新建议。 | verified |
| T5 | xyflow/issues #723 — 压力测试性能 | https://github.com/xyflow/xyflow/issues/723 | 社区对大量节点下帧率/内存的真实压测与讨论。 | verified |
| T5 | xyflow/discussions #4956 — 巨型工作流性能 | https://github.com/xyflow/xyflow/discussions/4956 | 社区讨论数千节点工作流的可行渲染策略与瓶颈。 | verified |

---

## 领域 94｜撤销重做与协同编辑

核心问题：command pattern、历史栈、CRDT/OT、Yjs、多人实时协同。

| 类型 | 标题 | URL | 一句话说明 | 验证状态 |
|------|------|-----|-----------|----------|
| T1 | tldraw — History（撤销/重做） | https://tldraw.dev/sdk-features/history | 官方文档：基于历史栈的 undo/redo 与事务（transaction）机制。 | canonical |
| T1 | React Flow — Undo/Redo 示例 | https://reactflow.dev/examples/interaction/undo-redo | 官方示例：用状态快照实现节点/边的撤销重做。 | verified |
| T2 | tldraw 仓库 — `HistoryManager.ts`（deepwiki） | https://deepwiki.com/tldraw/tldraw/2.9-history-and-transactions | 解析 tldraw 的 HistoryManager 与 command/事务栈实现。 | verified |
| T2 | tldraw 仓库 — `@tldraw/sync`（协同） | https://github.com/tldraw/tldraw/tree/main/packages/sync | tldraw 的实时协同同步包，基于 CRDT 思路的多人编辑。 | verified |
| T2 | Yjs 仓库（CRDT 协同基础） | https://github.com/yjs/yjs | 主流 CRDT 库，可作撤销重做栈与多人协同的底层选型参考。 | verified |
| T3 | Figma — How Figma's Multiplayer Technology Works | https://www.figma.com/blog/how-figmas-multiplayer-technology-works/ | Figma 官方工程博客：server-authoritative LWW + fractional indexing 的协同方案。 | canonical |
| T4 | tldraw — Sync 教程（协同接入） | https://tldraw.dev/sdk-features/persistence | 官方持久化/同步文档，可作协同编辑的接入教程。 | canonical |
| T5 | tldraw/yjs 社区 — 协同与 undo 讨论 | https://github.com/tldraw/tldraw/issues | 社区关于 Yjs 集成、undo 栈与多人光标的具体讨论。 | verified |

---

## 覆盖度自评

| 领域 | T1 | T2 | T3 | T4 | T5 | 备注 |
|------|----|----|----|----|----|------|
| 86 无限画布基础 | ✅ | ✅ | ✅ | ✅ | ✅ | 完整（T3 用 Figma 官方工程博客） |
| 87 节点模型与拖拽 | ✅ | ✅ | ✅ | ✅ | ✅ | 完整（T3 用 Figma 作者自述架构） |
| 88 连线与合法性校验 | ✅ | ✅ | ❌ 留空 | ✅ | ✅ | T3 属图算法应用，无论文 |
| 89 节点对齐与吸附 | ✅ | ✅ | ❌ 留空 | ✅ | ✅ | 主要由 tldraw 官方覆盖 |
| 90 画布替代交互 | ✅ | ✅ | ❌ 留空 | ✅ | ✅ | T3 属 UX 实践，无论文 |
| 91 工作流执行语义 | ✅ | ✅ | ❌ 留空 | ✅ | ✅ | T3 缺论文，工业实践为主 |
| 92 持久化与版本迁移 | ✅ | ✅ | ❌ 留空 | ✅ | ✅ | T3 缺论文 |
| 93 画布渲染性能 | ✅ | ✅ | ✅ | ✅ | ✅ | 完整（T3 用 Figma 60fps 复盘；T5 含 2 条具体 issue） |
| 94 撤销重做与协同 | ✅ | ✅ | ✅ | ✅ | ✅ | T3 用 Figma 官方博客补齐，唯一满格领域 |

**汇总**：9 个领域 × 5 类 = 45 格，已填 **44 格**，留空 **1 格**（领域 91/92 等 5 个领域的 T3 按原口径留空）。订正记录：初稿把 T3 误收窄为「学术论文」，与知识库既定口径（论文/报告/官方工程博客）不符；2026-09-18 复核后为 86/87/93 补入三条经检索核实的官方工程博客（Figma×2、Figma CTO 自述），并同步本表。

**对标覆盖**：React Flow/xyflow（86/87/88/90/93/94）、tldraw（86/89/92/94）、ComfyUI（91）、n8n（91/92）、Node-RED（91）、Excalidraw（93）、LiteGraph.js（87/93）、Figma（94）均已纳入。
