# 轨道计划（TRACK PLANS）—— 分类法与全部成果归类

- **建立时间**：2026-09-23
- **用途**：统一"计划命名 + 记录归档"的口径。**今后所有工作都必须归属到某一条轨道**，
  CHANGELOG / PROGRESS / review 记录都按轨道命名。
- **权威关系**：本文件定义**分类与命名**；`docs/PROGRESS.md` 定义**完成状态**；
  `review/REVIEW-LOG.md` 记录**复核**；`review/TRACK-SWEEP-N.md` 记录**排查**。

---

## 一、十条轨道（定义与判据）

| 轨道 | 管什么 | 判据（这条工作属于它的理由） |
|------|--------|------------------------------|
| **轨道回归计划** | 用户发起的**整体审查 + 大修复**（长上下文后发现目标偏移时的纠偏） | 由用户提出、以"复查既有成果"为起点、修复目标是**已存在**的偏移与矛盾 |
| **轨道铺设计划** | **编码主体**：Agent 的核心能力（循环、工具、权限门、会话、记忆、MCP） | 改的是"能不能干活、干活时听不听话"的核心链路 |
| **轨道扩容计划** | **新功能形体**：画布、轻 IDE、内置浏览器、远程接入、云 worker 调度 | 新增一个**用户可见的新界面/新形态**，不是既有能力的加固 |
| **轨道拓展计划** | **可扩展点**：技能（Skills）、钩子（Hooks）、插件、双色/外观、自定义规则 | 让**用户/第三方**能把能力插进来（而不是我们自己加功能） |
| **轨道加固计划** | **基础代码的强度**：安全基线、路径沙箱、IPC 边界、审批分级、密钥保护、原子存储 | 不改功能形态，只让**既有行为更抗攻击/更抗误用** |
| **轨道升级计划** | **替换与迁移**：依赖大版本、渲染管线、provider 适配、协议版本 | 把"旧做法换成新做法"，行为**大体不变** |
| **轨道优化计划** | **效率与资源**（启动/交互性能、内存上界、渲染合批、测试耗时）与**体验打磨**（视觉一致性、动效、微交互细节） | 行为与能力不变：**更快 / 更省 / 更稳 / 更好用**（体验打磨同样不许改变"能做什么"） |
| **轨道规整计划** | **结构与规范**：目录、命名、清理、测试策略、文档导航、门禁清单、记录口径 | 不碰行为，只让**结构与规范**回到有序 |
| **轨道排查计划** | **系统排查与记录**：全项目找问题、变异测试、复核台账、许可证扫描 | 产出是**问题清单与证据**，不是修复 |
| **轨道接驳计划** | **功能之间的对接方式**：渲染层↔IPC↔主进程↔引擎、工具桥、插件贡献接入、钩子与权限门的挂接、画布↔编码 | 单独看每块都对，问题是**两块之间怎么连** |

> 边界说明（避免归类打架）：
> - 同一件事可以**先后**属于不同轨道：先"加固"（把门做结实），后"拓展"（把自定义规则暴露给用户）。
>   归类看**这一轮改动的主要目的**，写在记录里说明即可。
> - 权限门本身属**铺设**（核心链路）；让用户写规则属**拓展**；把门做得更难绕属**加固**。

## 二、已完成的全部成果 → 轨道归类（映射表）

> 这张表就是"以前的记录同步":**历史提交与标签保持原样**（理由见 §四），
> 通过本表把每一批工作归属到轨道，今后检索按轨道走。

| 批次 / 版本 | 内容 | 归属轨道 |
|-------------|------|----------|
| W1–W4（v0.1–v0.4） | 骨架、IPC 契约、配置原子存储、对话与流式 | 铺设计划（1） |
| W5 / W5b（v0.5.x） | 权限门、审批弹窗、edit 决策、对话页走 Agent Loop | 铺设计划（2） |
| W5c（v0.5.4） | 自定义权限规则表（allow/deny/ask，按工具名 glob） | 拓展计划（1） |
| W5d（v0.15.0） | 生命周期钩子七类事件 | 拓展计划（2） |
| W6 / W7（v0.6–v0.7） | 前端骨架与体验、启动性能与交互预算 | 规整计划（1）+ 优化计划（1） |
| W8（v0.8.0） | 记忆与上下文装配 | 铺设计划（3） |
| W9a / W9b（v0.9.x） | 打包发布链路、内置终端（PTY） | 升级计划（1）+ 铺设计划（4） |
| W10a–e（v0.10–v0.13） | MCP 协议层、客户端、同意与准入、真子进程、服务编排 | 铺设计划（5） |
| W11a–c（v0.17–v0.21） | 技能（SKILL.md 渐进披露）、插件清单、插件贡献 MCP 接入 | 拓展计划（3） |
| W12（v0.9.1-pack 等） | 安装包与 Release 分发 | 规整计划（2） |
| W23a/b（v0.8.2 / v0.9.3） | 外观系统与样式包（双色模式） | 拓展计划（4） |
| 安全加固批次（v0.22.0） | 硬/软 ask 分级、IPC 发送方校验、`file:` 收紧、终端环境剔敏 | **加固计划（1）** |
| 零人工测试基建（v0.19.0-e2e） | 界面级端到端（真 Electron，13 步） | 优化计划（2，可重复验证效率） |
| 文档一致性检查（v0.23.0-doccheck） | `check:docs` + 自检 | 规整计划（3） |
| 测试不写系统盘（v0.20.0-cdrive） | 数据隔离到项目内 `.tmp`、C 盘清理 | 规整计划（4） |
| 启动路径修复（v0.19.1-launchfix） | 入口按脚本位置解析、缺产物给提示 | 规整计划（5） |
| 复核台账（REVIEW-LOG 001–020） | 每轮两遍复核与变异测试 | 排查计划（1） |
| **本次**（`review/TRACK-SWEEP-1.md`） | 全项目系统排查 | **排查计划（2）** |
| **本次修复**（CHANGELOG v0.24+） | 按排查报告做的第一轮大修复 | **回归计划（1）** |

**尚未开工、已归类的未来工作**（避免以后又开始漂移）：

| 未来工作 | 轨道 |
|----------|------|
| 内置浏览器（M3/W5a）· 无限画布（M4） | 扩容计划（1）（2） |
| 轻量 IDE · 远程接入 · 云 worker 调度 | 扩容计划（3）（需先解决与"数据不出本机"的表述冲突，见排查报告 S3 相关项） |
| 画布与编码的对接 · 浏览器与对话的对接 | 接驳计划（1） |
| per-server `timeoutMs`/`enabled` · MCP 工具描述漂移基线 | 加固计划（2） |
| 长会话重放回归 · 历史分页窗口 · 工具结果裁剪 | 优化计划（3）+ 加固计划（3） |
| 死能力接线（git 写操作、记忆写入、疲劳提示） | 铺设计划（6）/ 拓展计划（5），逐个判定 |
| utilityProcess 迁移 · main ≤300 行收敛 | 铺设计划（7，见排查报告 S4） |

### 2.1 代码文件归轨索引（2026-10-08 新增 · 规整11）

> §二 的映射表回答"**哪一批**属哪条轨道"；本节回答"**哪个文件**属哪条轨道"。两者并存、互不替代。
>
> **三条口径（缺一不可）**：
> 1. **按目录 / 模块归类**，覆盖 `apps/` 与 `packages/` 下全部源文件，一个不漏；
> 2. 判据取「**这个文件是干什么的**」，不取「它当年是在哪一轮诞生的」；
> 3. **测试文件跟随被测对象所在轨道，不单独列**（避免双计）；一个模块沾两条轨道时写「主轨 + 次轨」；
>    根配置（`package.json` / `tsconfig*.json` / `eslint.config.js` / `vitest.config.ts` / `electron.vite.config.ts` 等）统一归**规整**。
>
> **现扫对账（2026-10-08，`check:docs` 的护栏①机器盯目录级覆盖）**：`apps/` + `packages/` 下代码文件
> （`.ts/.tsx/.js/.mjs/.cjs`，剥 `node_modules`/`out`/`dist`/`release`/`.tmp`/`.trash`）= **216 个**，
> 加根配置 `eslint.config.js` 与 `vitest.config.ts` = **218**；含源文件的目录 = **42 个**。
> 交接来的清单漏了 **9 个非测试文件**，已按判据补在表末（来历写明，不混进原表）。

| 轨道 | 路径（相对仓库根） | 判据 |
|------|--------------------|------|
| 铺设1 | `packages/agent-core/src/loop/` · `packages/agent-core/src/providers/` · `packages/agent-core/src/index.ts` | Agent 循环 / provider·SSE / 包出口 |
| 铺设1 | `packages/shared/src/index.ts` · `packages/shared-ipc/src/{channels,contracts,limits,index}.ts` | IPC 契约与通道常量 |
| 铺设1 | `apps/desktop/src/main/{index,chat-service,workspace,model-history,ipc}.ts` | 主进程服务 = 核心链路宿主侧 |
| 铺设1 | `apps/desktop/src/renderer/src/features/{chat,connections,workspace}/` | 对话与连接界面 |
| 铺设2 | `packages/agent-core/src/permissions/` · `apps/desktop/src/main/{permission-bridge,permission-rules-store}.ts` | 权限门 |
| 铺设2 | `apps/desktop/src/renderer/src/features/{permission,permissions}/` | 审批弹窗与规则页（近名目录收敛属规整） |
| 铺设3 | `packages/agent-core/src/context/` · `packages/agent-core/src/memory/` | 上下文装配与记忆 |
| 铺设4 | `packages/agent-core/src/terminal/` · `apps/desktop/src/main/terminal-service.ts` | 内置终端（PTY） |
| 铺设4 | `apps/desktop/src/renderer/src/features/terminal/` | 终端界面 |
| 铺设5 | `packages/agent-core/src/mcp/` · `apps/desktop/src/main/mcp/` | MCP 协议层 / 客户端 / 同意准入 / 服务编排 |
| 铺设5 | `apps/desktop/src/renderer/src/features/mcp/` | MCP 界面 |
| 铺设6a | `apps/desktop/src/main/{session-journal,session-lru,session-store}.ts` | 会话持久化 |
| 铺设6b | `packages/agent-core/src/context/compaction.ts` | 会话压缩与摘要（与铺设3 同目录，按改动目的分轨） |
| 铺设9 | `packages/agent-core/src/git/` · `apps/desktop/src/main/git-service.ts` | git 模块接线（M8 已收口：`push` 于 `v0.56.0-铺设9` 交付，硬 ask 不可压） |
| 铺设9 | `apps/desktop/src/renderer/src/features/git/` | git 界面 |
| 铺设10 | `apps/desktop/src/main/pending-notes.ts` | M6 记忆写入侧（`append_note`） |
| 加固1 | `packages/shared/src/json-store.ts` | 原子存储（tmp+fsync+rename+.bak+版本信封+损坏自愈） |
| 加固1 | `packages/agent-core/src/tools/path-guard.ts` · `packages/agent-core/src/hooks/runner.ts` | 路径沙箱 · 钩子子进程 env 剔密 |
| 加固1 | `apps/desktop/src/main/{security,secret,paths,config-write}.ts` | 安全基线 / 密钥 / 路径沙箱 / 配置白名单 |
| 加固1 | `apps/desktop/src/main/{git-gate,hooks-gate,open-with-gate}.ts` | 审批硬 ask 分级 |
| 加固1 | `apps/desktop/src/main/{config-store,connections-store,hooks-store,permission-rules-store}.ts` | 各功能自己的原子落盘 |
| 加固1 | `apps/desktop/src/preload/index.ts` | IPC 边界安全基线 |
| 加固1 | `apps/desktop/src/renderer/src/{ErrorBoundary.tsx,error-fallback.ts}` | 崩溃兜底 |
| 加固2 | `apps/desktop/src/main/mcp/`（per-server `timeoutMs`/`enabled` 部分） | MCP 单服务端开关与描述漂移基线（未开工） |
| 拓展2 | `packages/agent-core/src/hooks/{points,runner,types}.ts` · `apps/desktop/src/main/hooks-store.ts` | 生命周期钩子七类事件 |
| 拓展2 | `apps/desktop/src/renderer/src/features/hooks/` | 钩子界面 |
| 拓展3 | `packages/agent-core/src/{skills,plugins}/` · `apps/desktop/src/main/{skills,plugins}.ts` | 技能（渐进披露）与插件清单 |
| 拓展3 | `apps/desktop/src/renderer/src/features/plugins/` | 插件界面 |
| 拓展4 | `packages/ui-tokens/src/` · `apps/desktop/src/renderer/src/features/appearance/` | 外观与样式包（双色模式） |
| 拓展5 | `packages/agent-core/src/commands/{argv,process}.ts` | 插件贡献的命令执行（仅识别、未接线） |
| 扩容1 | `packages/agent-core/src/browser/` · `apps/desktop/src/main/{browser-service,open-with-service,open-with-launch}.ts` | 内置浏览器：导航策略 + 三档打开方式 |
| 扩容1 | `apps/desktop/src/renderer/src/features/browser/` · `apps/desktop/src/renderer/src/markdown/` | 浏览器界面与 Markdown 渲染 |
| 扩容2 | `packages/shared-ipc/src/{canvas-graph,canvas-run}.ts` · `apps/desktop/src/main/{canvas-runner,canvas-store}.ts` | 无限画布：图契约 / 纯规则 / 编排 / 执行 / 持久化 |
| 扩容2 | `apps/desktop/src/renderer/src/features/canvas/` | 画布界面（React Flow） |
| 扩容3 | `packages/shared-ipc/src/pdf-limits.ts` · `apps/desktop/src/main/ipc/pdf.ts` | 轻量 IDE 的 PDF 侧（零出站、大小上限） |
| 扩容3 | `apps/desktop/src/renderer/src/features/{ide,docs}/` | 文件树 / 编辑器 / diff / 文档页 |
| 接驳 | `apps/desktop/src/main/ipc/` · `apps/desktop/src/main/*-wiring.test.ts` | 渲染层↔IPC↔主进程↔引擎的对接面与接线锁 |
| 规整 | `apps/desktop/src/renderer/src/{App.tsx,KeepAlive.tsx,styles.css,styles-wiring.test.ts}` · `apps/desktop/src/main/test-policy.test.ts` | 结构与规范（挂载保持 / 样式 / 测试策略） |
| 规整 | `apps/desktop/scripts/` · `scripts/` | 门禁与工具链（check-docs / verify-pack / run-electron / license-check） |
| 优化1 | `packages/shared/src/stream-batcher.ts` | 渲染合批（行为不变、更快） |
| 优化2 | `apps/desktop/scripts/e2e-ui.mjs` | 零人工测试基建（可重复验证效率） |
| 排查 | `scripts/mutation-check.mjs` · `scripts/count_coverage.py` · `scripts/gen_matrix.py` · `review/mutations.json` | 产出是问题清单与证据 |

**本轮现扫补的 9 行**（交接清单未覆盖的非测试文件；判据同上，来历如实写明）：

| 轨道 | 路径 | 判据 |
|------|------|------|
| 规整 | `apps/desktop/electron.vite.config.ts` | 构建配置（与根配置同类：结构与规范，不碰行为） |
| 规整 | `apps/desktop/src/renderer/src/main.tsx` | 渲染层入口与挂载结构（与 `App.tsx` / `KeepAlive.tsx` 同批） |
| 规整 | `apps/desktop/src/renderer/src/env.d.ts` | 环境类型声明（`window.jujia` 等；纯结构） |
| 铺设2（次：铺设1） | `packages/agent-core/src/tools/executor.ts` | 工具执行器 = 判档与权限门的调用点 |
| 铺设1 | `packages/agent-core/src/tools/registry.ts` | 工具注册表（"有哪些工具"的核心链路） |
| 铺设1 | `packages/agent-core/src/tools/types.ts` | 工具类型契约 |
| 铺设1（次：加固1） | `packages/agent-core/src/tools/builtin/file-tools.ts` | 读 / 写文件工具（走 `path-guard`） |
| 铺设8 | `packages/agent-core/src/tools/builtin/exec-tool.ts` | 内置 exec `run_command`（每次硬 ask + 工作目录守卫 + 环境脱敏） |
| 铺设8 | `packages/agent-core/src/audit/` · `apps/desktop/src/main/{audit-log,audit-service,audit-gate}.ts` · `apps/desktop/src/main/ipc/audit.ts` | 执行审计（M4 收尾其二）：判定事实出口（工具侧 `runTool` 的 `finally`；非工具侧 `audit-gate.ts` 的 `auditedGateRun`，git / 打开外部程序 / 钩子配置三扇共用）、**落盘前剔密**、按天 JSONL 与导出 |
| 铺设8 | `packages/agent-core/src/tools/output-pump.ts` · `apps/desktop/src/main/{tool-output-relay,tool-output-wiring.test,tool-output-relay.test}.ts` | 长命令的实时输出（M4 收尾其三）：攒批与尾部快照（双上界）、按 callId 分线、链条接线锁 |
| 铺设7 | `packages/agent-core/src/schedule/`（`rrule.ts` · `catchup.ts`） | 定时任务的**算式层**（M7）：RRULE 子集的解析与拒收口径、下一次/截至此刻的触发时刻、错过次数、稳定抖动；补跑口径（至多补一次 + 说出跳过几次）也是纯函数 |
| 铺设7 | `apps/desktop/src/main/{schedule-store,schedule-service}.ts` · `apps/desktop/src/main/ipc/schedule.ts` | 定时任务的**落盘与发动机**（M7）：账本（校验只一处 · 读改写在临界区 · 拒"免审批"键）、tick 与"一次只跑一条"、到点走同一扇门 |
| 铺设7 | `apps/desktop/src/main/ipc/turn-trigger.ts` | **起一轮对话的唯一入口**（M7 从 `ipc/chat.ts` 抽出）：用户敲字与定时到点共用它，权限参数汇聚点因此只有一个 |
| 铺设7 | `apps/desktop/src/renderer/src/features/schedule/` | 定时任务页（M7）：清单只搬运主进程算好的"下一次"，规则子集与"定时≠免审批"写在屏幕上 |
| 铺设10 | `packages/agent-core/src/tools/builtin/note-tool.ts` | 记忆写入 `append_note` 工具本体（与 `main/pending-notes.ts` 同批） |

## 三、记录规则（今后一律遵守）

- **发现轨道编号冲突 → 不抢号、开新号，并在两处同时勘误**（先例：`v0.37.0-铺设10`。
  ROADMAP §三 表里"铺设 6 = 会话持久化"，而 §四 总览行把 6 写成"记忆写入侧" —— 同一个号指两件事，
  照着做一定记错账。处置是给新工作开 **10** 号、6 号含义不变、总览行标注勘误；**不改历史、不回填旧号**。
  里程碑号（M1–M23）与轨道流水号是两套编号，冲突只发生在后者。

1. **CHANGELOG 条目**：标题格式 `## [vX.Y.Z-轨道简称N] — 日期`，
   正文首行写 **`轨道：<轨道计划N>（一句话说明为什么归到这条轨道）`**。
   轨道简称用：`回归` / `铺设` / `扩容` / `拓展` / `加固` / `升级` / `优化` / `规整` / `排查` / `接驳`。
2. **PROGRESS 表**：`阶段` 列改写为轨道编号（如 `加固1`、`拓展3`），保留原 W 编号在"内容"列里可追溯。
3. **review/REVIEW-LOG.md**：复核记录标题带轨道号（如 `复核 021 · 轨道回归计划1`）。
4. **排查类产出**：统一放 `review/TRACK-SWEEP-N.md`；**接驳类**放 `docs/LINKAGE-N.md`。
5. **编号连续**：同一轨道内严格递增，不复用；跨轨道不共享编号。
6. **git 标签**（2026-10-08 新立，自 `v0.54.0-扩容2` 起）：标签名 = `vX.Y.Z-轨道简称N` —— **只取轨道段**，
   不带任务号后缀、不含空格 / `·` / 全角括号（让"标签 ↔ 所属轨道"可机器对应）。
   例：标题 `[v0.54.0-扩容2 · M9b（B3）]` → 标签 `v0.54.0-扩容2`。
   **历史标签不回改**（`v0.53.0-M9b-B2` / `v0.52.0-M9b-B1` 等原样保留，靠 §二 与 §2.1 归类检索）；
   文档里的"回退点"必须写**真实存在**的标签名 —— 幽灵标签会让回退在那一点失效
   （先例：`v0.24.0-回归1` 的实际标签是 `v0.24.0-hg1`，2026-10-08 已修指向），`check:docs` 有断言盯着。

## 四、历史记录的同步方式（重要决策）

- **做**：
  - 本映射表覆盖全部历史批次（§二）；
  - `CHANGELOG.md` 顶部加**指针说明**，声明"历史条目按 `docs/TRACK-PLANS.md` 的映射表归类"；
  - `PROGRESS.md` 加指针；
  - 今后所有新条目按 §三 的规则写。
- **不做（并说明理由）**：
  - **不改写已推送的 git 历史与标签**。重写会改变 commit hash，让已有克隆、标签、Release 全部失配，
    且本项目把"每阶段提交 + 打标签 + Release"当作可回退的安全网 —— 为了"名字统一"而拆掉安全网，得不偿失。
  - **不逐条重写历史 CHANGELOG 条目**：它们是有价值的**审计轨迹**（记录了当时的判断与踩坑）。
    改名会污染证据。用映射表达到"可检索、可归属"的同一目的，同时保住证据原貌。
  - 若某条历史记录**内容本身有错**（不只是命名），则在**新一轮**条目里写明更正，并在原文加一行
    `> 更正：见 vX.Y.Z`，**不改写原句**。
