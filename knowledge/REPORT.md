# 俱佳Agent 知识调研综合报告

## Executive summary

1. **Agent 内核不要自创控制流**：生产界共识是三分支循环——模型输出若是「无 tool 的正文」则结束；若是 handoff 则切换 Agent；若是 tool_calls 则执行后重入循环，并用 `max_turns`/预算熔断（F1）。
2. **Workflow ≠ Agent**：Anthropic 建议从可验证的简单流水线做起，编码 Agent 的「完成」应以测试/工具证据为准，而不是模型自称完成（F1）。
3. **多子代理要克制**：编码任务并行度低于 research；Anthropic 实测 multi-agent 约 15× chat token、单 agent 约 4×；并发槽默认 3–5；父 Agent 只做规划与综合（F2）。
4. **Skills 与 MCP 职责分离**：MCP = 工具/数据连接器（JSON-RPC Host-Client-Server）；Skills = SKILL.md 渐进披露的过程知识。Skills 可以教「如何用 MCP」，不能替代 MCP（F3）。
5. **Hooks 必须能拒绝**：PreToolUse/PostToolUse 等生命周期钩子应返回 allow/deny/ask；「静默退出码 0」≠ 批准（F3）。
6. **定时任务应落盘成 Skill + schedule 侧车**，而不是依赖渲染进程会话存活；桌面最低间隔 1 分钟 + 抖动 + 漏跑仅补一次（F3）。
8. **Electron 安全默认值不可妥协**：contextIsolation + sandbox + 禁止暴露 raw ipcRenderer + 校验 IPC sender；Agent 运行时放 utilityProcess/sidecar，渲染层只做 UI（F5）。
9. **流畅 UI 的根因**：测量优先（DevTools + Chrome Tracing）；流式 delta 小事件 + rAF 批处理；消息/审阅虚拟列表；主进程禁止同步 IPC/重 IO（F6）。
10. **UI 基线**：Windows 桌面优先 Fluent UI React v9 + 语义 Design Tokens；工具卡 L0/L1/L2 渐进披露；权限按钮「动词+名词」；每个表面四态 empty/loading/error/success；动效 100–300ms 且尊重 reduced-motion（F7）。
11. **模型层**：连接抽象为「多 Connection」，协议仅 `anthropic | openai` 两档；对话历史必须 block 级（text/thinking/tool_use/tool_result）；SSE 在主进程/utility 解析（F8）。

## Background & scope

## 一、Agent 核心机制

- ReAct：推理轨迹与动作交错，结果可审计地进入 transcript [F1-1, arXiv 2210.03629]。
- 生产 Agent Loop（OpenAI Agents SDK / Claude Agent SDK）：每回合三分支；`final output = 无工具调用的文本`；`max_turns` 必配 [F1-2, F1-8]。
- Workflow vs Agent：简单任务用 prompt chain / router / evaluator-optimizer；开放式编码再上自由 tool loop [F1-3]。
- 编码可验证：测试反馈作为环境真值；Evaluator 与 Generator 分离，避免自我认证 [F1-4, F1-5]。
- **工具 ACI**：Anthropic SWE-bench 经验——优化工具比优化 prompt 更关键；Windows 桌面工具 schema 应要求**绝对路径** [F1-6]。
- 并发策略：只读工具可并行；写盘/Shell **串行** [F1-9]。
- 长上下文失败模式：懒惰停止、自我偏好、目标漂移 → 外部验证器 + 硬完成条件 [F1-10]。
- Context engineering = 最小高信号 token 集；压缩、笔记、子代理只回传 1–2k 摘要 [F1-11]。
- 工具错误可恢复：`return_error_to_model` 优于硬崩溃；工具命名空间保持小（理想 <10）[F1-13]。

## 二、多代理与子代理

| 模式 | 要点 | 适用 |
|------|------|------|
| agents-as-tools | 父保持对话，专家作为工具调用返回结果 | explore/review/test 助手（推荐） |
| handoff | `transfer_to_*` 工具，专家接管后续回合 | 长专项任务 |
| orchestrator-worker | Lead 规划写入 Memory → 并行 workers → 综合/引用 | 调研类；编码慎用纯并行 |
| worktree 隔离 | 子代理在临时 git worktree 中改代码，无 diff 自动清理 | 并行改代码 |

关键约束：路由 description 保持极短（详情进子系统提示）；并发 3–5；产出写磁盘再回路径；**编码 Agent 默认单线程主循环 + 可选只读 explore 子代理**（F2）。

## 三、Skills / Hooks / 定时 / MCP

- **MCP Host**：Electron main 为每个 server 维护一个 Client；工具调用前必须有 Host 侧同意 UI；工具 annotation 默认不可信（F3）。
- Windows stdio：`cmd /c npx ...`；Streamable HTTP 取代旧 HTTP+SSE；OAuth URL 禁止用 shell 打开（F3）。
- **Agent Skills**：目录 + `SKILL.md`（YAML name/description）；渐进披露：启动只注入 ~100 token 元数据 → 激活加载正文 → 按需资源/脚本（F3 agentskills.io）。
- Skills 目录建议：`~/.jujia/skills/`（用户）+ `<workspace>/.jujia/skills/`（项目）；禁止自动加载外部 `.claude/skills` 等，需用户显式导入。
- **Hooks 事件节拍**：session（Start/End）、turn（UserPromptSubmit/Stop）、tool（PreToolUse/PostToolUse）；默认拒绝语义安全（F3）。
- **定时任务**：RRULE/cron，1 分钟下限，确定性抖动，磁盘持久化；可用 Skill 文件夹承载 prompt（F3 Claude Desktop 模式）。

## 四、记忆与上下文

建议俱佳Agent 数据模型：

```
JuJiaData/
  agents/<agentId>/
    core.json          # pinned memory blocks（原子写 + version）
    notes/*.md         # 结构化笔记 / todo
  sessions/<sessionId>/
    messages.jsonl     # append-only transcript
    summary.md         # 压缩后 handoff packet
  memory.json          # 可选：跨会话事实（日后再上向量）
```

- 淘汰 ≠ 删除：先落盘再压缩出窗（F4 Letta/MemGPT）。
- 预算装配：系统+core 固定 → 工具 schema 上限 → 检索 k → 滑动窗口近期回合 → 预留回复（F4 Anthropic context engineering）。
- 压缩两级：① 清旧 tool_result ② LLM 摘要为结构化 packet（目标/决策/未决 bug/路径/下一步）（F4）。
- 评估：重启后事实回忆、时序问题、多跳一致性、token/延迟（F4 LOCOMO 类别）。

## 五、Electron 架构与工程

```
┌─────────────────────────────────────────────┐
│  Renderer (sandbox + contextIsolation)      │
│  纯 UI：聊天 / 设置 / 审阅 / 终端 xterm      │
│  window.jujia = contextBridge 白名单        │
└──────────────────┬──────────────────────────┘
                   │ typed IPC invoke / events
┌──────────────────▼──────────────────────────┐
│  Main process（薄路由）                      │
│  窗口 · 权限 UI · MCP Host 生命周期          │
│  json-store 原子读写 · 配置缓存              │
└──────────────────┬──────────────────────────┘
                   │ utilityProcess / MessagePort
┌──────────────────▼──────────────────────────┐
│  Agent Runtime（utilityProcess 'jujia-agent'）│
│  Agent loop · 工具执行 · 流式 SSE            │
│  Memory assembler · Hooks 总线               │
│  MCP Clients（stdio children）               │
└─────────────────────────────────────────────┘
```

官方要点：main 永不阻塞；IPC 校验 sender；浏览器窗口零 Agent bridge；终端 = xterm.js + node-pty（main）（F5）。

```
jujia-agent/
  packages/
    agent-core/      # 循环、工具、记忆、provider（可单测，无 Electron）
    shared-ipc/      # 契约类型
    ui-tokens/       # Design Tokens
  apps/
    desktop/         # Electron 壳
```

## 六、性能 / 预加载 / 缓存

| 层 | 做法 |
|----|------|
| 启动 | 壳优先绘制；延迟 import 模型 SDK/高亮/diff；模型目录打开选择器时再解析 |
| IPC | 只发 delta `{sessionId, messageId, seq, text}`；禁止每 token 全量 history |
| 渲染 | rAF 合批流式文本；thinking 同样增量 append；工具卡懒渲染+截断 |
| 列表 | 会话/文件树/审阅虚拟化；`content-visibility:auto` 辅助 |
| 配置 | main 内存 ConfigStore + save 失效；磁盘原子写 + .bak |
| 缓存 | 内存 → 磁盘快照 → 网络 SWR（模型目录、Skill 市场） |
| 禁止 | `sendSync`、main 同步 fs、SSE 路径上大文件 readFileSync |

（F6 + Yan 问题对照）

## 七、UI/UX / 视觉 / 动效 / 组件 / 卡片

- Token 架构：ref → system → component → agent 专属；CSS 变量驱动 light/dark（F7 M3/LobeHub/Fluent）。
- 组件优先：`@fluentui/react-components`（Card/MessageBar/Toast/Dialog/Badge/Skeleton）。
- 工具卡三层：L0 一行状态摘要 → L1 卡片（工具名+耗时+关键参数）→ L2 Drawer（完整 args/日志/diff）。
- 权限审批：默认展示完整命令；按钮「允许本次 / 总是允许 / 拒绝」；**禁止** UI 瞬时消失自动 reject。
- 反馈三分工：MessageBar=本表面状态（须带 CTA）；Toast=异步/他处事件；Dialog=危险阻断。
- 文案：进行中用进行时；成功写明「改了什么」；全应用统一动词。
- 动效：微交互 100–200ms，卡片展开 200–300ms；`prefers-reduced-motion` 仍保留 loading。

| 项目 | 可学 | 可避 |
|------|------|------|

连接 schema 建议（F8/Yan）：

```ts
type ApiFormat = 'openai' | 'anthropic';
interface Connection {
  id: string; name: string; baseURL: string; apiKey: string;
  preset: string; // auto|deepseek|glm|...
  apiFormat: ApiFormat; // preset 推断，可覆盖
  models?: Record<string, { id: string }>;
}
```

## 知识领域覆盖（≥60，详见 LEARNING-MAP）

| 集群 | 示例主题 |
|------|----------|
| Agent 机制 | ReAct、Agent Loop、Workflow/Agent、Tool ACI、Evaluator-Optimizer、Goal Verify、Error Recovery、Context Engineering、State Machine、Budget Cap |
| 多代理 | Subagent ACL、Orchestrator-Worker、Handoff、Worktree、Artifact Handoff、Concurrency Slots、Token Cost |
| 扩展 | MCP Host/Client/Server、stdio/HTTP、Registry、Agent Skills 渐进披露、Hooks、Scheduled Tasks、App Connectors、Skill Marketplace |
| 记忆 | LTM/STM、Memory Blocks、Compaction、Notes/Handoff、RAG vs Memory、Atomic Store、Eval |
| 架构 | Process Model、IPC、Preload Bridge、Sandbox、UtilityProcess、Sidecar、PTY、Packaging、Auto-update、Crash Recovery |
| 性能 | Lazy Import、Virtual List、Event Batching、Config Cache、Measure First、Memory Leak、SWR |
| UI/UX | Design Tokens、Fluent、Cards L0–L2、Permission UI、Empty/Loading/Error、Motion Budget、A11y、Dense Desktop |
| 模型 | OpenAI-compat、Anthropic Messages、SSE、reasoning_content、Vision Relay、Model Catalog、Retry Policy、Stream Events |

## Open questions

1. 首期是否接入真实 MCP 官方 SDK，还是先实现内置工具循环（学习友好）。
2. 渲染层用 React 还是继续 Vanilla（性能 vs 生态）；规划默认推荐 **React + Vite + Fluent**。
3. 是否需要内嵌浏览器验收（MVP 可砍）。
4. 向量检索：MVP 用文件/关键词即可，何时引入 embedding。
5. OpenAI/Anthropic 官方文档部分环境不可达，协议细节以后续联调为准。

## Sources（代表，完整见 findings）

[1] ReAct — arXiv:2210.03629  
[2] OpenAI Agents SDK Running Agents  
[3] Anthropic Building Effective Agents  
[4] Claude Agent SDK Agent Loop  
[6] Anthropic Multi-agent Research System  
[7] modelcontextprotocol.io Specification + Security  
[8] agentskills.io Specification  
[9] MemGPT/Letta, Mem0, Zep papers + Letta docs  
[10] Electron Process/IPC/Sandbox/Security/Performance/UtilityProcess  
[11] react-window  
[12] Fluent 2 / M3 tokens / LobeHub DESIGN.md / NN/g  
（各条 URL 见 `knowledge/findings/*.md`）

---

*详细开发计划见 `docs/PLAN.md`，知识地图见 `docs/LEARNING-MAP.md`。*
