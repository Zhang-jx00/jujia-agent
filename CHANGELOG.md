# 变更记录（CHANGELOG）

> 约定：每个阶段或关键改动一条记录，含**时间戳 / 范围 / 改动内容 / 验证方式 / 回退点**。
> 回退点 = git tag 或 commit 短哈希；任何时候可用 `git checkout <tag>` 回到指定版本。
> 阶段划分见 `docs/PLAN.md` §5–6。

---

## [v0.6.0-arch] — 2026-09-18 23:12

**类型**：架构级范围扩展（用户要求：轻量类 IDE + 接入自有云主机 + 本地/云端调度 + 高可定制化外观）

**联网核实（2026-09-18 检索，来源见文档 §9）**
- **会话状态归 host**：Remote Agent Host Session 范式中，客户端断开只应是 UI 事件；
  靠 host 持有会话日志 + 单调 seq + 增量回放/快照恢复（opencode AHP 与 Anthropic Managed Agents 同思路）
- **三种远端传输**：出站 HTTPS（Cursor 自托管 worker 做法，无入站端口/防火墙/VPN）→ SSH（复用 sshd）→ 反向隧道
- **真实风险**：匿名 dev tunnel 可被未认证访问者触发命令执行（厂商文档 + 安全厂商实测告警）
- **运行位置四档权衡**：本机/容器/一次性 VM/边缘 isolate；长无人值守任务用一次性 VM 换内核边界
- **远端沙箱必须是完整工具链 harness**（只读控制面 + 工具 harness + 持久输出面 + 质量门）
- **Codex App Server 思路**：双向 JSON-RPC 暴露 threads/events/diffs/approvals，重运行时放在状态聚集处

**改动内容**
- 新增 `docs/ARCH-CLOUD-IDE.md`：五层架构、三条设计律、新增模块 M19–M23、路由规则表、
  迁移机制、IDE 与 Agent 的集成方式（共用 `WorkspaceRef`）、外观系统的可定制边界与安全约束
- 新增模块与周次：**M19 轻量 IDE（W19）· M20 远程接入（W20）· M21 云端 worker（W21）·
  M22 调度与切换（W22）· M23 外观系统（W23）**；M13 并入 M23
- **权限门定为本机专属**：远端 worker 无放行权，只能执行已批准的那一次调用
- 编辑器选型：**CodeMirror 6**（轻量、模块化），Monaco 作为备选
- PLAN / PRODUCT-GOAL / COVERAGE-MATRIX / README 同步更新

**验证**：文档一致性核对（矩阵 ↔ 计划 ↔ 目标）；四件套保持全绿（上一轮 141/141）

---

## [v0.5.1-coverage] — 2026-09-18 23:07

**类型**：范围补全（用户要求：点名的 60+ 领域**每一项都要实现**）
**改动内容**
- 新增 `docs/COVERAGE-MATRIX.md`：把你点名的领域（系统设计 / 前端与 UI/UX / 视觉与动效 /
  组件与卡片 / 技能管理 / 多子 agent 编排 / 钩子 / 定时任务 / 应用连接 / 内存与缓存与预加载 /
  响应速度与流畅 / 模型适配 / MCP / agent 机制 / 记忆与长期记忆 / 长任务 / 多代理分工 /
  高自定义权限 / 高自定义背景 等）逐项映射到模块、落点与验收标准
- 核对出 **6 项原计划真空缺**，已补为独立交付物并写入 PLAN 与 PRODUCT-GOAL：
  | 新增 | 内容 | 周次 |
  |------|------|------|
  | M13 | 主题与背景自定义（背景图/纯色/毛玻璃/透明度） | W17 |
  | M14 | 多子 agent 编排（并发派发/分工/汇总/各自权限） | W18 |
  | M15 | 自定义权限规则表（allow/deny/ask + 参数 glob） | W5c |
  | M16 | 钩子四类齐备（Pre/Post/Stop/SessionStart） | W5d |
  | M17 | 长任务与断点续跑 | W18 |
  | M18 | 启动性能预算与预加载策略 | W7 |
- 明确记录：**参考产品（codex / workbuddy / zcode / qoder / opencode）架构对比列为下一轮第一件事**

**验证**：文档一致性核对（PLAN 周次 ↔ 矩阵 ↔ 目标文档）；四件套保持全绿

---

## [v0.5.0-w5a] 补充 · 2026-09-18 23:01

**新增文档**：`docs/PRODUCT-GOAL.md`（产品最终目标）——用户要求明确「产品最终形态」以便对照预期。

**本轮联网核实（2026-09-16/17/18 动态，来源见文档 §8）**
- **DeepSeek V4.1-Flash**（552B MoE，激活 8–16B，原生视觉）据 Terminal-Bench 2.1 在编码与安全基准上
  超过 GPT-5.6 Sol 与 Kimi K3；**OpenAI GPT-6 Astra**（面向自主计算机使用，Agents' Last Exam SOTA）；
  Meta Muse Spark 1.3（会主动澄清与**确认关键操作**）；开源 agent 模型 Occamy-1.0（35B/3B 激活）
- 范式变化：**持久化 agent + 异步执行成为默认 UX**（Claude Code Projects / Cursor Projects）；
  Google 为 managed agents 引入 **Credentials API（占位符把密钥挡在模型上下文外）** 与 Files API；
  **MCP 已成事实标准**（Google Home MCP）；Grok Bot 集成 1Password（**每次填充都需批准**）
- 反面经验：有资料警告**激进压缩对话历史**会损坏隐藏推理与缓存前缀 → 本项目明确不采用

**由此对目标文档做出的取舍**：坚持本地单机路线（隐私优先）、权限判定用**确定性规则**而非模型判断、
不自造插件协议而直接接入 MCP、密钥不仅不进渲染层还要**不进模型上下文**（待补）。

**验证**：复核 005 第一遍全绿（git 干净 · typecheck · lint · 141/141）

---

## [v0.5.0-w5a] — 2026-09-18 22:58

**阶段**：P1 · W5（第一部分）「权限队列与分级策略」
**前置**：复核 004（对象 W4）已通过——第一遍全绿；第二遍变异测试 **4/4 全部被拦住**
（name 赋值而非串接 / 按 append 而非 index / 取消 maxTurns 上界 / 工具失败抛错）。
**范围**：权限**策略层**（纯函数，可单测）。审批弹窗的 edit 决策与队列持久化留待 W5 第二部分。

**本轮联网核实（延续「不依赖过时知识 + 接触新技术」两条要求）**
核实 2026 年主流 Agent 框架的权限/HITL 做法，得到三条与本项目直接相关的结论：
1. **「处处都问」等于没问**——会训练出橡皮图章式审批（审批疲劳）；正确做法是**按参数分级**，
   而不是按工具名一刀切。本项目原设计（write 一律询问）据此升级为分级策略。
2. **被自动批准的工具不会到达审批回调**；需要「每次调用都执行」的检查必须放在 PreToolUse 钩子
   （钩子拒绝即使在高放行模式下也生效）——验证了 PLAN 中 PreToolUse 设计的必要性。
3. 2026 年各框架已把审批决策从三态扩展到 **approve / edit / reject / respond**，
   其中 **edit（允许并改参数后执行）**是一等公民；本项目 W3 缺 edit，列为 W5 第二部分待办。
（完整记录见 `knowledge/cards/012-permission-tiering-2026.md`，含 5 个来源 URL）

**改动内容**
- 新增 `packages/agent-core/src/permissions/policy.ts`（纯函数策略层）：
  - 五种模式：`default` / `acceptEdits` / `plan` / `dontAsk` / `bypassPermissions`（语义对齐业界）
  - **按参数分级**：`acceptEdits` 下写普通文件放行；命中敏感目标（`.env`、`.git/`、私钥、
    `.npmrc`/credentials、锁文件、`.github/workflows/`）**仍必须询问**，且标为高风险
  - 高危工具清单优先于任何模式（含 bypassPermissions）
  - 只读调用一律放行（不打扰用户）；覆盖写入风险高于新建
  - `fatigueHint()`：连续批准同一工具 ≥3 次时引导改用规则/模式，抵抗审批疲劳
- 支持 Windows 反斜杠路径的敏感识别

**验证方式**
| 项 | 结果 |
|----|------|
| `npm run typecheck` | 通过 |
| `npm run lint` | 0 error / 0 warning |
| `npm run test` | **141/141**（118 → 141；策略层新增 23 例） |

**回退点**：tag `v0.5.0-w5a`（上一版 `v0.4.0-w4`）

---

## [v0.4.0-w4] — 2026-09-18 22:52

**阶段**：P1 · W4「三分支 Agent Loop + maxTurns + 工具串行执行」（`docs/PLAN.md` §6 P1 第 4 行）
**前置**：复核 003（对象 W3）已通过——第一遍全绿；第二遍变异测试 **4/4 全部被拦住**
（去掉 realpath 校验 / 越界判定改 startsWith / 写工具不再询问 / 拒绝后仍执行）。
**范围**：Agent Loop 与流式工具调用拼装；**尚未接入对话页**（W5 负责把 chat 改为走 Loop）。

**联网核实（用户要求：不得依赖过时知识）**
- **Kimi K3 已发布**（2026-07-16，7-27 开源权重）：2.8T MoE、1M 上下文、原生多模态；
  本卡片 009 原记的 `kimi-k2.6` **已落后两个版本** → 预设更新为 `kimi-k3`，并在卡片中补记来源与时间
- 核实流式工具调用规范，沉淀为知识卡片 011（见下）

**改动内容**
- **`providers/tool-call-accumulator.ts`（新增）**：流式 `tool_calls` 拼装器。落实卡片 011 的四条规则：
  按 `index` 归位（不按到达顺序 append）、`name` 串接、`arguments` 仅在流结束后解析、容忍首帧无 content；
  解析失败给出 `parseError` 而非抛异常
- **`providers/openai-compat.ts`**：支持 `tools` / `tool_choice` 参数与 `tool` 角色消息序列化
  （assistant 带 tool_calls 时回传、tool 消息带配对 `tool_call_id`）；流结束时先产出 `tool_calls` 事件
  再给出 `done(tool_calls)`
- **`loop/agent-loop.ts`（新增）**：三分支 Loop
  - `final`：模型直接答复 → 结束
  - `tool`：串行执行工具 → 结果作为 `tool` 消息回传 → 继续循环
  - `handoff`：模型调用内建 `handoff` 工具 → 结束并标记，交由上层处置
  - **maxTurns 熔断**（默认 8）；工具失败一律翻译成「可回传模型」的文本，不中断对话
- **契约**：`StreamEvent.done.reason` 增加 `tool_calls`

**验证方式（4 项全绿）**
| 项 | 结果 |
|----|------|
| `npm run typecheck` | 通过 |
| `npm run lint` | 0 error / 0 warning |
| `npm run test` | **118/118**（101 → 118；新增拼装器 8 例 + Loop 9 例） |
| `npm run smoke` | `SMOKE OK …（v1 / primary）；工作区工具链路可用` |

**过程中修掉的 1 个真实缺陷**
- Loop 里 `calls = ev.calls` 用**赋值**接收工具调用，若 provider 分多次给出 `tool_calls` 事件就会丢掉先到的调用
  （实测：两个调用只剩第二个）→ 改为按 `index` 合并

**回退点**：tag `v0.4.0-w4`（上一版 `v0.3.0-w3`）

---

## [v0.3.0-w3] — 2026-09-18 22:41

**阶段**：P1 · W3「工作区选择 + 文件工具（绝对路径 + sandbox 校验 + 写门禁）」（`docs/PLAN.md` §6 P1 第 3 行）
**范围**：路径沙箱 + 内置文件工具 + 权限门 + 工作区选择；不含 Agent Loop（W4）与完整权限状态机（W5）。

**改动内容**

*1) `packages/agent-core/src/tools/`（新增，可单测、无 Electron 依赖）*
- `path-guard.ts`：**路径沙箱（本项目安全核心）**——逐条拒绝 Windows 特有绕过手法
  （设备路径、UNC、备用数据流 ADS、尾随点/空格、保留设备名、空字符），
  越界判定用 `path.relative` 而非字符串前缀；再用 **realpath 校验**拦截符号链接/junction 逃逸
- `builtin/file-tools.ts`：`read_file` / `write_file` / `list_dir`；读取超限**如实标注截断**，
  写入有大小上限；所有路径先过 guard
- `executor.ts`：**权限门唯一入口**——`read` 自动放行，`write`/`exec` 一律询问；
  拒绝与超时是**两种不同结果**（文案与 `decision` 均区分）；支持「本次会话总是允许」
- `registry.ts`：工具注册表，未注册名字直接报错（不做模糊匹配）；
  `toOpenAiTools()` 只导出 `name/description/parameters`，不泄露内部实现

*2) 主进程*
- `workspace.ts`：工作区存于 `config.json`；**路径只能由系统目录对话框产生**，
  不接受渲染层传来的任意路径（否则边界形同虚设）；校验存在/是目录/可写
- `permission-bridge.ts`：把权限询问接到渲染层并带超时；**窗口关闭或渲染进程崩溃时
  所有挂起请求立刻按超时收尾**，不留无上界的等待
- `ipc.ts`：新增 `WORKSPACE_GET/PICK/CLEAR`、`PERMISSION_REQUEST/RESOLVE`、`TOOL_RUN`

*3) 渲染层*
- `features/workspace/WorkspaceCard.tsx`：工作区卡片 + **工具自检台**（一键试跑三个工具、
  一键填入越界路径）——让 W3 验收标准可人工复核，也是 M2 的验收入口
- `features/permission/PermissionDialog.tsx`：审批弹窗（允许一次 / 本次会话总是允许 / 拒绝），
  串行排队避免「批量误批」，按钮不做危险默认焦点

**验证方式（4 项全绿）**
| 项 | 结果 |
|----|------|
| `npm run typecheck` | 通过（4 个 workspace） |
| `npm run lint` | 0 error / 0 warning |
| `npm run test` | **101/101**（57 → 101；新增 path-guard 28 例 + 工具执行 16 例） |
| `npm run smoke` | `SMOKE OK … 工作区工具链路可用（工作区=未选择，list_dir=已拦截）` |

**对抗性用例（安全基线，不允许放宽）**
- 越界拦截：`..` 多级、绝对路径指向外部、`ws` vs `ws2` **前缀陷阱**、UNC、设备路径、ADS、
  尾随点/空格、Windows 保留设备名
- 逃逸防护：**junction 指向工作区外 → 拒绝**；指向内部 → 放行
- 权限门：**用户拒绝时磁盘必须没被动过**（关键断言）；超时与拒绝文案不同；
  「总是允许」写入会话白名单后不再询问；参数不合法不打扰用户
- 过度拦截防护：工作区内含 `..` 但未越界的路径**必须放行**（修复首版误判）

**过程中修掉的 3 个真实缺陷**
1. `input.trim()` 提前吃掉尾随空格，等于绕过「以空格结尾」检测（防护被自己的规范化绕过）
2. `..` 片段被「尾随点」规则命中，导致 `sub/../a.txt` 这类**工作区内合法路径被误拒**（过度拦截）
3. 工作区根目录不存在时 realpath 返回 null 未处理 → 改为直接拒绝（fail closed）

**回退点**：tag `v0.3.0-w3`（上一版 `v0.2.2-review`）

---

## [v0.2.2-review] — 2026-09-18 22:27

**类型**：复核 002 修复（对象 `v0.2.0-w2`；按用户约定「下次任务前复核两遍」执行）
**范围**：修协议层缺陷 + 补异常路径测试；不含新功能。

**复核结论**：第一遍全绿；第二遍（变异测试 + 异常路径实验）暴露 **2 项严重缺陷**。

**修复内容**
1. **`isAbort` 漏判超时**（严重）：Node `AbortSignal.timeout()` 抛的是 `TimeoutError`（code=23）而非 `AbortError`，
   导致「上游超时」被误报为「连接失败」
   → 新增 `isTimeout()`（含 `cause` 链判定）；`ProviderError` 增加 `timeout` 码；三处 catch 同步处理
2. **对话链路无超时**（严重）：上游接受连接但不响应时永久挂起（`withTimeout` 写了未接线）
   → `chat-service` 接入 `withTimeout(controller.signal, 300_000)`，与用户中止语义分离
3. **流中途断开的契约未锁定**（中）：明确「抛 `network_error` 且已产出增量不得丢失」并以用例锁死
4. ESLint 补 `varsIgnorePattern` / `caughtErrorsIgnorePattern` 为 `^_`（轻微）
5. 按用户要求：README 移除「参考 Yan-Agent / OpenCode / Cline 等」一行

**新增测试（54 → 57）**
- 服务端发送途中强制断开 socket → 增量保留 + `network_error`
- 上游一直不响应 → 超时识别为 `timeout`（有界，不永久挂起）
- 用户在等待响应头阶段主动取消 → `done(aborted)`

**验证方式**
| 项 | 结果 |
|----|------|
| `npm run typecheck` | 通过 |
| `npm run lint` | 0 error / 0 warning |
| `npm run test` | **57/57** |
| `npm run smoke` | `SMOKE OK …（v1 / primary）` |
| **变异测试 ×4** | **4/4 全部被测试拦住**（[DONE] 判定 / flush 尾包 / 中止语义 / usage 字段）；还原用文件备份，未用 `git checkout --` |

**回退点**：tag `v0.2.2-review`（上一版 `v0.2.1-vendor`）

---

## [v0.2.1-vendor] — 2026-09-18 22:22

**类型**：复核 002 前置项 · **厂商接口与模型信息联网核实**（用户明确要求：不得引用过时或已废弃内容）
**范围**：只改预设数据与文档，不改协议实现。

**核实方式**：① 抓取官方文档页面；② 用无效 Key 实测端点（401=路径有效 / 404=路径错误 / 000=不可达）。

**核实发现（含废弃项）**
| 项 | 原预设（已过时） | 核实后的当前值 | 证据 |
|----|-----------------|---------------|------|
| DeepSeek 模型 | `deepseek-chat` | **`deepseek-flash`** | 官方文档：`deepseek-chat`/`deepseek-reasoner` **2026-07-24 弃用**；现行为 `deepseek-flash`(V4.1-Flash) 与 `deepseek-v4-pro` |
| DeepSeek 端点 | — | `/v1/chat/completions` 与 `/chat/completions` **均返回 401** | 实测：两条路径都有效 |
| 智谱模型 | `glm-4-plus` | **`glm-5.3`**（旗舰） | 官方模型概览：`glm-4-plus` 已不在列表中；另有免费额度 `glm-4.7-flash` |
| Moonshot 模型 | `moonshot-v1-8k` | **`kimi-k2.6`** | 官方平台页：K2.6 为最新最智能模型；`moonshot-v1` 属第一代 |
| OpenAI 模型 | `gpt-4o-mini` | **不再预设** | 多方资料一致：`gpt-4o`/`gpt-4o-mini` 已废弃；官方文档站对自动化访问返回 403，未取得可信 ID 列表 |
| Ollama 模型 | `qwen2.5:7b` | **不再预设**（改由运行时读取本机列表） | 模型取决于本机已 pull 内容；官方推荐工具调用用 `qwen3` 系列 |
| OpenAI 端点 | — | 本机网络 **000（不可达）** | 实测：与 github.com 首页被阻断同源 |

**设计原则（由此确定）**：**能自动发现的就不预设，能核实到官方 ID 的才写死。**
对模型迭代极快（OpenAI）或依赖本机环境（Ollama）的厂商留空模型名，改为点「测试」时通过
`GET {base}/models` 拉真实列表回填候选——已实测该端点在 DeepSeek / 智谱 / Moonshot 均返回 401（路径有效）。

**改动内容**
- `ConnectionsPanel.tsx`：更新 5 个厂商预设（含核实日期与废弃说明注释）、新增预设说明提示行、
  模型输入框占位文案改为引导用户从测试结果中选择
- 新增知识卡片 `knowledge/cards/009-vendor-api-verification-2026-09.md`：完整核实记录 + 来源 URL +
  对 W3/W5 的影响（五家均支持 OpenAI 兼容 `tools`；DeepSeek 新增 `thinking` / `reasoning_effort` 参数
  与 Anthropic 格式端点，属 provider 能力差异，应进 capability registry）

**验证方式**：`npm run typecheck` 通过 · `npm run lint` 0 问题 · `npm run test` **54/54** · `npm run build` 成功

**回退点**：tag `v0.2.1-vendor`（上一版 `v0.2.0-w2`）

---

## [v0.2.0-w2] — 2026-09-18 21:57

**阶段**：P1 · W2「Connection UI + OpenAI-compatible SSE 流式对话」（`docs/PLAN.md` §6 P1 第 2 行）
**范围**：新增 `packages/agent-core`（provider 与流式协议解析）+ 连接管理链路 + 对话 UI；
不含记忆/工具/权限（W3–W5 职责）。

**改动内容**
- **新增 `packages/agent-core`**（无 Electron 依赖，可单测）
  - `providers/sse.ts`：SSE 解析器（**纯函数**，按事件边界切分，处理注释行/CRLF/多行 data/尾包）
  - `providers/openai-compat.ts`：`streamChat()` 流式生成器 + `listModels()` 连通性探测 +
    `resolveEndpoint()` baseUrl 归一化（自动补 `/v1`，兼容智谱 `/api/paas/v4` 等）
  - `providers/types.ts`：`ProviderEvent` 契约（`text_delta` / `usage` / `done`）
- **契约扩展** `packages/shared-ipc`：`ConnectionInput` / `ConnectionView`（脱敏）/
  `TestResult` / `StreamEvent`（discriminated union）/ `ChatSendResult` / `ChatMessageView`；
  新增 9 个 IPC 通道（连接 CRUD + 测试、对话 发送/停止/历史、流式事件推送）
- **主进程**
  - `main/secret.ts`：优先 Electron `safeStorage`（Windows DPAPI）加密 API Key，不可用时降级为明文并标注
  - `main/connections-store.ts`：`connections.json`（原子写）+ **脱敏视图**（渲染层只拿到 `hasApiKey` 与 `hint`）
  - `main/chat-service.ts`：会话管理 + 后台流式转发 + 中止；**错误轮次不写入历史**
  - `main/index.ts`：`mainWindow` 引用管理 + `emitStream` 注入（窗口销毁时静默丢弃事件）
- **渲染层**：应用外壳（概览 / 连接 / 对话 三页签）
  - `features/connections/ConnectionsPanel.tsx`：厂商预设（DeepSeek/智谱/OpenAI/Moonshot/Ollama）、
    增删改查、连通性测试（回填可用模型到 datalist）
  - `features/chat/ChatPanel.tsx`：单次订阅流式事件、按 messageId 归位增量、**流式期间输入框保持可用**、
    停止按钮、token 用量显示
- **知识卡片**：`knowledge/cards/008-streaming-sse-pitfalls.md`

**验证方式（4 项全绿）**
| 项 | 命令 | 结果 |
|----|------|------|
| 类型检查 | `npm run typecheck` | 通过（4 个 workspace） |
| 静态检查 | `npm run lint` | 通过，0 error / 0 warning |
| 单元测试 | `npm run test` | **54/54**（新增 35 例：SSE 边界 13 + provider 端到端 22） |
| 端到端冒烟 | `npm run smoke` | `SMOKE OK …（v1 / primary）` |

**关键测试用例（用真实本地 SSE 服务，非打桩）**
- 「逐字符慢写」极端分片仍正确拼装；中文/Emoji 跨 chunk 不破
- **无 `[DONE]` 直接断流 → flush 尾包不丢**（首版真实缺陷，被此用例当场抓出）
- 401 → `http_error(status=401)`；`data` 内 error → `bad_response`；全垃圾负载 → 报错而非静默成功
- 用户中止 → `done(aborted)` 而非抛错；端口无人监听 → `network_error`
- 请求体断言：`stream=true`、model/temperature/max_tokens 与 `Bearer` 鉴权头

**回退点**：tag `v0.2.0-w2`（上一版 `v0.1.2-review`）

---

## [v0.1.2-review] — 2026-09-18 19:52

**类型**：**复核修复**（对象：`v0.1.1-w1`；按用户约定「下次任务前复核两遍」执行）
**范围**：不新增功能，只修复复核暴露的缺陷；详细台账见 `review/REVIEW-LOG.md` 复核 001。

**复核方式与结论**
- 第一遍（状态与一致性）：git/标签/文档/目录/依赖 —— 发现 1 项轻微（README 缺登记 `packages/shared`）
- 第二遍（对抗性与运行时）：**变异测试 + 损坏注入实验** —— 暴露 5 项严重缺陷
- 结论：复核前「四件套表面全绿」但存在**形同虚设的安全断言、死代码存储链路、会毁掉健康备份**三类问题；
  修复后全部闭环。

**修复内容（按严重度）**
1. **安全断言自引用**（严重）：断言与配置模板共用同一常量，常量被改坏则两层同时失效
   → 断言改用独立字面量真值 `REQUIRED_SECURE`，并新增 `assertBaselineConstantIntact()` 校验常量本身
2. **运行时写路径是死代码**（严重）：仅 IPC 调用才写盘，`写→备份→恢复` 从未在真实运行时走到
   → 新增 `ensureConfigFile()`，首次启动原子落盘
3. **启动异常留下僵尸进程**（严重）：`whenReady` 内 await 抛错无捕获，无窗口无看门狗，实测挂死 7 分 23 秒
   → 全流程 try/catch + 失败即 `app.exit(1)`；冒烟看门狗提前到任何 await 之前
4. **恢复事件被自愈掩盖**（严重）：自愈后 `source` 恒为 primary，UI 永远看不到恢复提示
   → 新增会话级 `recoveredFrom` / `recoveredAt` 并上报渲染层（`role="status"` 明示）
5. **损坏主文件覆盖健康备份**（严重）：无条件把主文件 rename 成 `.bak`，实测把 122B 健康备份换成 33B 垃圾
   → 仅当主文件可解析时才转存 `.bak`；损坏文件隔离为 `<file>.corrupt-<ts>` 留证
6. `SECURITY_BASELINE` 补 `webviewTag` 字段，模板改为从常量派生（中）
7. `cleanup.py` 覆盖 `*.corrupt-*` 隔离文件（轻微）
8. `README.md` 补登记 `packages/shared/`（轻微）
9. **变异还原连带回滚未提交修复**（严重·流程）：用 `git checkout --` 还原变异时，同一文件里未提交的
   `webviewTag` 修复被一并丢弃，测试从 21/21 掉回 19/21
   → 重新施加修复并复跑四件套；同时立规：变异测试只在**已提交基线**上做，还原用精确补丁，禁止 `git checkout --`

**验证方式**
| 项 | 命令 / 实验 | 结果 |
|----|-------------|------|
| 类型检查 | `npm run typecheck` | 通过 |
| 静态检查 | `npm run lint` | 0 error / 0 warning |
| 单元测试 | `npm run test` | **21/21**（新增「损坏主文件不得覆盖健康 .bak」等对抗用例） |
| 端到端冒烟 | `npm run smoke` | `SMOKE OK …（v1 / primary）`，首次启动落盘成功 |
| **变异测试** | 故意把 `SECURITY_BASELINE.sandbox` 改为 `false` | **被拦**：单测报 `sandbox 被改为 false，应为 true`；启动 fail-closed 退出；进程无挂死 |
| **损坏注入实验** | 截断 `config.json`（保留健康 `.bak`）后重启 | **通过**：日志 `启动时配置不可用（来源=backup），已用备份自愈写回`；`.bak` 122B 未被动；隔离出 `config.json.corrupt-1789732192973`；UI 显示恢复提示与时间 |

**回退点**：tag `v0.1.2-review`（上一版 `v0.1.1-w1`）

---

## [v0.1.1-w1] — 2026-09-18 19:28

**阶段**：P1 · W1「原子存储 + 契约打通」（`docs/PLAN.md` §6 P1 第 1 行）
**范围**：新增 `packages/shared`（原子 JSON 存储）+ 把它接进真实运行链路；不含任何 UI 业务功能。

**改动内容**
- **新增 `packages/shared`**：`json-store.ts` 实现六条设计约束
  1. 先写临时文件再 rename（避免半截 JSON）
  2. `fsync` 后再 rename（避免「rename 成功但内容丢」）
  3. 覆盖前旧文件转 `.bak`（可回滚上一版）
  4. 读取三级降级：主文件 → `.bak` → 默认值，并返回 `source` / `recovered` 供 UI 如实提示
  5. 同路径写入**串行化**（避免并发覆盖，对应 Yan 的配置竞态教训）
  6. 带 `{version, updatedAt, data}` 信封 + `migrate` 钩子（为 schema 变更预留）
- **契约扩展** `packages/shared-ipc`：`appConfigSchema`、`configSnapshotSchema`、`IPC.CONFIG_GET` / `CONFIG_SET`
- **主进程**：新增 `main/config-store.ts`（配置读写封装），`IPC.CONFIG_SET` 只接受已知字段并显式剔除 `undefined`
- **预加载桥**：新增 `configGet()` / `configSet()`，全部经 zod 校验后才返回渲染层
- **渲染层**：展示配置 schema 版本 / 读取来源 / 是否从损坏中恢复（`data-config-*` 供冒烟断言）
- **冒烟强化**：除 Node 泄漏检查外，新增「配置读取链路已打通」断言
- **静态检查**：`.mjs` 工具脚本补充 Node 全局声明；TS 文件关闭 `no-undef`（官方建议，交给编译器）

**验证方式（4 项全绿）**
| 项 | 命令 | 结果 |
|----|------|------|
| 类型检查 | `npm run typecheck` | 通过（3 个 workspace 全清） |
| 静态检查 | `npm run lint` | 通过，0 error / 0 warning |
| 单元测试 | `npm run test` | **19/19**（json-store 9 例 + 安全基线 10 例） |
| 端到端冒烟 | `npm run smoke` | `SMOKE OK …原子配置读取成功（v1 / default）` |

**关键测试用例（对应真实事故场景）**
- 「主文件半截损坏（模拟断电）→ 自动回退 `.bak` 并标记 `recovered`」 ✅
- 「主文件与 `.bak` 均损坏 → 回退默认值且不抛异常」 ✅
- 「12 路并发写同一文件 → 结果始终是完整 JSON，无残留 `.tmp`」 ✅
- 「旧版本信封 → 先 `migrate` 再 `validate`，`detectedVersion` 更新为当前版本」 ✅

**回退点**：tag `v0.1.1-w1`（上一版 `v0.1.0-p0`）

---

## [v0.1.0-p0] — 2026-09-18 19:19

**阶段**：P0 · W0 环境与脚手架（`docs/PLAN.md` §6 P0）
**范围**：仅工程底座，不含任何业务功能。

**改动内容**
- **workspace 骨架**：根 `package.json`（npm workspaces：`apps/*`、`packages/*`）+ `tsconfig.base.json`（strict 全家桶）
  + `eslint.config.js`（含 `max-lines: 800` 防巨石文件）+ `.prettierrc.json` + `vitest.config.ts`
- **契约包** `packages/shared-ipc`：IPC 通道常量、`SECURITY_BASELINE`、`appInfoSchema`（zod）
- **桌面端** `apps/desktop`：electron-vite 三层结构（`src/main` / `src/preload` / `src/renderer`）
  - `main/security.ts`：安全基线模板 + `assertSecureWebPreferences` 自检（fail-closed）+
    导航拦截 / 新窗口拒绝 / 权限默认拒绝 / 禁止 `<webview>`
  - `main/index.ts`：安全窗口、单实例锁、`--smoke` 无界面冒烟
  - `preload/index.ts`：`contextBridge` 白名单桥（只暴露 `appInfo()`，绝不暴露 `ipcRenderer`）
  - `renderer/`：React 19 壳页面，可视化运行时信息与安全基线
- **工具链**：`scripts/run-electron.mjs`（规避 `ELECTRON_RUN_AS_NODE` 陷阱）+ `security.test.ts`
- **CI**：`.github/workflows/ci.yml`（lint → typecheck → test → build，windows-latest）
- **工程约束文件**：`.gitignore`、`.gitattributes`（LF 归一）、`.editorconfig`
- **知识卡片**：`knowledge/cards/007-electron-p0-gotchas.md`

**依赖版本（实际解析）**：Electron 44.4.2 · electron-vite 5.0.0 · Vite 7.3.6 · React 19.3.0 ·
TypeScript 6.0.3 · ESLint 10.10 · Vitest 5.0.1

**验证方式（4 项全绿）**
| 项 | 命令 | 结果 |
|----|------|------|
| 类型检查 | `npm run typecheck` | 通过（含 2 个 workspace） |
| 静态检查 | `npm run lint` | 通过，0 warning |
| 单元测试 | `npm run test` | 10/10 通过（安全基线 6 例 + 导航 3 例 + scheme 1 例） |
| 端到端冒烟 | `npm run smoke` | `SMOKE OK`：主进程 + 预加载桥 + 渲染层 + IPC 全链路就绪，渲染层无 Node 泄漏 |

**过程中修复的 5 个真实问题**（详见知识卡片 007）
1. 环境变量 `ELECTRON_RUN_AS_NODE=1` 使 Electron 退化为 Node → 统一经 `run-electron.mjs` 启动
2. `externalizeDepsPlugin` 外部化内部 TS 包 → `exclude: ['@jujia/shared-ipc']`
3. `did-finish-load` 早于 IPC 回包 → 冒烟改轮询（200ms × 8s）
4. TS 6.0 弃用 `baseUrl` / React 19 移除全局 `JSX` 命名空间 / 缺 `vite/client` 类型 → 逐一修正
5. Electron 44 移除 `getLastWebPreferences()` → 改为传参前断言配置对象

**回退点**：tag `v0.1.0-p0`（上一个可回退版本为 `v0.0.0-baseline`）

---

## [v0.0.0-baseline] — 2026-09-18 19:00

**范围**：接手既有知识资产，建立可回退基线（未写任何应用代码）。

**改动内容**
- 初始化 git 仓库，加入 `.gitignore`、`.editorconfig`
- 基线内容：`docs/`（PLAN v3 + LEARNING-MAP）、`knowledge/`（108 领域 × 5 类来源矩阵、
  findings/ sources/ cards/）、`review/EVALUATION.md`、`scripts/`（cleanup / count_coverage /
  gen_matrix / fix_paths / fix_source_urls / fix_links_round2）
- 建立本 CHANGELOG 作为变更与回退的账本

**验证方式**
- `git log --oneline` 可见基线 commit；`git tag` 可见 `v0.0.0-baseline`
- `python scripts/cleanup.py` 报告「没有需要清理的内容」

**回退点**：tag `v0.0.0-baseline`

---
