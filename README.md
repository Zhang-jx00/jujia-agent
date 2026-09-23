# 俱佳Agent

一个**跑在你自己 Windows 上**的个人 Agent：能读文件、改代码、跑命令，
但**每个有副作用的动作都要你点头**，数据默认不出本机。

- **形态**：TypeScript + Electron（本地优先，单机运行，无需服务端）
- **许可**：MIT（见 [`LICENSE`](LICENSE)）
- **支持平台**：**Windows 10/11**（打包产物为 Windows 安装包）。源码层面对 macOS / Linux
  做了兼容处理，但**尚未在这些平台上验证**，欢迎你来补验证。

> **⚠️ 先读安全说明**：这个项目**会执行命令、会改你的文件**，它**不是安全沙箱**。
> 使用前请务必看 [`SECURITY.md`](SECURITY.md)（能做什么/没做什么、如何报告漏洞、使用建议）。

## 核心理念与独特之处

这个项目的设计出发点不是"再加一个能聊天的编程助手"，而是**把"不信任"做成产品的一部分**：
模型可以提议，但**放行与否由确定性的代码和你的手指决定**。以下几条是它区别于同类工具的地方 ——
每一条都有对应的实现与可复跑的验证，不是宣传话术。

**1. 权限判定是确定性规则，不交给模型。**
判定入口是一个纯函数（`decideGate`），输入只有模式、工具、参数与你的规则表，输出放行/询问/拒绝；
模型无法通过"说服"改变它。5 种权限模式 + 自定义规则表（`allow`/`deny`/`ask` + 工具名 glob），
其中 **`deny` 与 `ask` 绝对生效**（连"全部放行"模式也让路）。模型自称"已获授权"不是授权。

**2. 接入外部能力要逐项点头，没点头的工具连调用路径都不存在。**
MCP 服务端连接后先展示**将执行的完整命令**与风险，工具清单**默认一个都不勾选**；
未批准的工具**不会注册进工具表** —— 不是"注册了但拦着"，而是根本调用不到。

**3. "拒绝"是真的拒绝。**
拒绝接入会**退掉那个进程**（不留后台常驻）；被拒的工具调用**远端一次都不会被调用** ——
这条有自动化断言作证：让服务端在每次 `tools/call` 时往 stderr 写一行，主进程据此精确断言"零调用"。

**4. 数据不出本机是默认值，不是可选项。**
密钥不进渲染层、不进模型上下文、**也不进钩子输入**；MCP 的环境变量**值**不回传界面（只回传键名）；
有副作用的动作一律先问。所有数据落在本机一个数据根目录里。

**5. 把"可验证"当产品特性，而不是开发者的自觉。**
- 每阶段做**变异测试**（故意改坏实现，看测试红不红）—— 累计 40+ 例全部被拦住，
  并且真的抓到过三次"测试看着绿、其实什么都没锁住"的漏洞；
- 端到端用**真子进程**（真 spawn、真超时、真杀进程树），不靠假实现推断结论；
- 有一条**无头 dev 管线探针**，专门防"构建全绿但开发模式黑屏"这类只在一种模式下暴露的问题；
- 复核台账（`review/REVIEW-LOG.md`）**公开在仓库里**，包括未通过项与原因。

**6. 边界如实标注。**
未验证的平台、未接入的事件、已知欠账，都写在 `docs/PROGRESS.md` 与 `review/` 里 ——
而不是留一句"理论上支持"。宁可交付"做到这里 + 明确说明"，也不交付"看起来全做了"。

### 文档导航

| 想了解 | 看哪里 |
|--------|--------|
| 怎么用、怎么装 | 本文件「快速开始」 |
| 技能怎么写（按需查阅的说明书） | [docs/SKILLS.md](docs/SKILLS.md) |
| 钩子怎么写（可拒绝的自动化） | [docs/HOOKS.md](docs/HOOKS.md) |
| 插件怎么打包（整包分发） | [docs/PLUGINS.md](docs/PLUGINS.md) |
| 测试临时文件落在哪（不占系统盘） | [docs/TEST-POLICY.md](docs/TEST-POLICY.md) |
| 安全边界与风险声明 | [SECURITY.md](SECURITY.md) |
| 做了什么、还差什么 | [docs/PROGRESS.md](docs/PROGRESS.md) · [CHANGELOG.md](CHANGELOG.md) |
| 每轮复核记录（含未通过项） | [review/REVIEW-LOG.md](review/REVIEW-LOG.md) |
| 工作怎么分类与记录（轨道计划） | [docs/TRACK-PLANS.md](docs/TRACK-PLANS.md) |
| 排期、里程碑编号与修复队列（路线图） | [docs/TRACK-ROADMAP.md](docs/TRACK-ROADMAP.md) |
| 全项目排查记录 | [review/TRACK-SWEEP-1.md](review/TRACK-SWEEP-1.md) |
| 第三方依赖与许可证 | [docs/DEPENDENCY-LICENSES.md](docs/DEPENDENCY-LICENSES.md) |

> **取舍**：本地单机优先（不做云端中转）；不自造插件协议（直接说 MCP）；
> 不采用激进的对话历史压缩（可解释性优先于省 token）。

---

## 快速开始

### 方式 A：直接下载安装包（推荐给使用者）

到 [Releases](https://github.com/Zhang-jx00/jujia-agent/releases) 下载：

| 文件 | 说明 |
|------|------|
| `JujiaAgent-Setup-x.y.z.exe` | NSIS 安装包（可选安装目录、带卸载） |
| `JujiaAgent-x.y.z-portable.exe` | 免安装版，双击即用 |

> 未做代码签名，首次运行会有 SmartScreen 提示 → 选「更多信息 → 仍要运行」。
> 请核对下载来源是本仓库的 Releases 页面。

**首次使用三步**：① 「连接」页填你的模型 API Key 并「测试」→
② 「概览」页**选一个工作区目录**（Agent 只能在这个目录内读写）→
③ 「对话」页试试：`帮我在工作区创建一个 hello.md，内容写「你好，俱佳」`（会弹审批）。

### 方式 B：从源码跑（推荐给开发者）

```bash
git clone https://github.com/Zhang-jx00/jujia-agent.git
cd jujia-agent
npm install

npm run app            # 构建 + 启动（从任何目录跑都行；构建产物不在时会给出提示）
npm run dev            # 开发模式
npm run typecheck      # 类型检查
npm run lint           # 静态检查
npm run test           # 单元 + 集成测试
npm run smoke          # 真实启动 Electron，断言 IPC 全链路 + 渲染层无 Node 泄漏
npm run e2e            # 界面级端到端：真应用 + 真点击，14 步全自动（数据隔离到临时目录）
npm run mut            # 变异测试：按 review/mutations.json 逐项改坏代码，验证测试真拦得住
npm run check:docs     # 文档一致性：文档里的命令/链接/步数/事件数必须与代码一致
npm run check:docs:selftest  # 检查器自检：注入 4 处漂移，证明它真的会失败（而不是永远绿）
npm run perf           # 启动性能预算判定（首帧 < 1000ms）

npm run dist           # 打 Windows 安装包（输出在 apps/desktop/release/）
```

需要 **Node.js ≥ 22**。内置终端的依赖若装不上，看 [`docs/SETUP-TERMINAL.md`](docs/SETUP-TERMINAL.md)。

### 常见问题

| 现象 | 原因与解法 |
|------|------------|
| 弹窗 `Unable to find Electron app at …\out\main\index.js` | 启动时用了**相对仓库根**的路径，而构建产物在 `apps/desktop/out/`。用 `npm run app`（会自己构建，且入口按脚本位置解析）或 `npm run dev` |
| 窗口打开是黑屏 | 依赖版本不匹配导致的渲染层加载失败。本项目曾因 `@vitejs/plugin-react` 与 vite 版本错配出现此问题（已修）。可先跑 `node apps/desktop/scripts/verify-dev-transform.mjs` 定位是不是渲染管线的问题 |
| 打包版窗口打不开 | 环境里可能设了 `ELECTRON_RUN_AS_NODE=1`（Electron 会退化成纯 Node）。启动前清掉它：`set ELECTRON_RUN_AS_NODE=`（cmd）或 `$env:ELECTRON_RUN_AS_NODE=$null`（PowerShell） |
| 想用一份**独立的**数据目录试东西 | 设 `JUJIA_DATA_BASE_DIR` 指向一个目录，数据就落在那里（自动化测试就是靠它隔离的） |

## 当前能力

> 状态口径：**本表只列"能不能用"**，精确状态以 [`docs/PROGRESS.md`](docs/PROGRESS.md) 为唯一权威；
> 工作如何分类与记录见 [`docs/TRACK-PLANS.md`](docs/TRACK-PLANS.md)。

| 能力 | 状态 |
|------|------|
| 多厂商连接（OpenAI 兼容端点 + 自定义 base URL，「测试」会列出真实可用模型） | ✅ |
| 流式对话（可随时停止、超时有界、断流不丢已产出内容） | ✅ |
| **Agent Loop**（三分支：最终答复 / 继续调工具 / 移交）+ 熔断 | ✅ |
| 内置文件工具（读 / 写 / 列目录）+ **路径沙箱** | ✅ |
| **权限门**（5 种模式 + 按参数分级 + 敏感路径强制询问 + **硬/软 ask 两级**） | ✅ |
| 审批决策 **edit**（允许但先改参数再执行） | ✅ |
| **内置终端**（xterm + 真伪终端，每次启动需审批；子进程环境不含敏感变量） | ✅ |
| **git 队列与 diff 审阅**（关键行摘录、噪音文件识别） | ✅ |
| 工作区 **AGENTS.md** 项目指令 + `.jujia/NOTES.md` 长期记忆 | ✅ |
| 外观定制（样式包 / 背景：纯色·渐变·图片·毛玻璃 / 对比度守护） | ✅ |
| 工具卡 L0–L2（一行 → 卡片 → 抽屉看完整输出） | ✅ |
| **MCP Host**（stdio 传输 · 连接同意 · 逐工具批准 · 断开摘工具） | ✅ |
| **技能（Skills）**（`SKILL.md` 渐进披露 + `load_skill` 按需加载） | ✅ |
| **插件**（一个清单打包技能 / 命令 / MCP 服务端 / 选项；贡献物经同一套批准流程） | ✅ |
| **生命周期钩子**（七类事件 · 默认关闭 · 可拒绝 · 有超时与输出上限） | ✅ |
| **界面级自动化验证**（`npm run e2e` 14 步 · 变异测试 · 文档一致性检查） | ✅ |
| 启动性能（`npm run perf`；历史采样与预算见 [`docs/PERF-BUDGET.md`](docs/PERF-BUDGET.md)） | 🔶 见该文档的"采样铁律" |
| 定时任务（RRULE + 补跑） | ⏳ 未开始 |
| **无限画布** / **内置浏览器** / 多模态门控 | ⏳ 未开始 |
| **轻量 IDE** / 远程接入 / 云端 worker 调度 | ⏳ 未开始 |

## 数据与目录（它把你的东西放哪了）

**默认不出本机。** 所有数据都在你机器的用户目录下，不经过我们的服务器（本项目也没有服务器）。

| 内容 | 位置 |
|------|------|
| 配置（外观、工作区路径等） | `%APPDATA%\\jujia-agent\\`（原子写，带 `.bak` 备份与损坏自愈） |
| 连接信息与 API Key | 同上目录；**Key 用系统加密存储，且不进入渲染层、不进入模型上下文** |
| 会话历史 | 进程内保存；**尚未做跨会话持久化**（这是刻意的——先确保安全，再谈便利） |
| 项目指令 | **你自己**工作区里的 `AGENTS.md`（我们**只读，从不改写**） |
| 长期记忆 | **你自己**工作区里的 `.jujia/NOTES.md`（append-only，带日期） |
| 内置终端的历史 | 不落盘，仅存在于当前会话 |

**卸载残留**：卸载应用**不会**自动删除 `%APPDATA%\\jujia-agent\\`（里面有你的连接配置）。
要彻底清理请手动删除该目录 —— 我们不替你动它。

## 安全边界（它会动你什么）

一句话：**它只能做你批准过的事，且只能在你选定的工作区内。**

**会做的**
- 读写你选定工作区内的文件（写操作**逐次询问**）
- 在你批准后执行命令（含内置终端）、修改代码

**不会做的**
- 不会越出工作区：`..` 逃逸、设备路径、UNC、备用数据流、软链/junction 逃逸**全部拦截**
- 不会绕过审批：`exec` 类能力**每次**都要问；权限桥不可用时**默认拒绝**（fail-closed）
- 不会偷传数据：没有服务端、没有遥测、没有自动上传
- 不会读你的密钥去做别的事：Key 不进渲染层、不进模型上下文

**你必须自己承担的**
- 你**批准过**的命令就是在你机器上以你的权限执行 —— 请看清参数再点
- 它**不是安全沙箱**；不要把整个磁盘设为工作区

完整策略、漏洞披露渠道与使用建议见 [`SECURITY.md`](SECURITY.md)。

## 参与贡献

提交前请读 [`CONTRIBUTING.md`](CONTRIBUTING.md) —— 里面写了这个项目对质量的具体要求
（门禁全绿、复核两遍与变异测试、来源宁缺勿滥、绝不假称完成等），它们都来自实际踩过的坑。

## 目录

| 路径 | 说明 |
|------|------|
| `LICENSE` · `SECURITY.md` · `CONTRIBUTING.md` | 开源三件套：许可 / **安全策略与漏洞披露** / 贡献指南 |
| `CHANGELOG.md` | **变更与回退账本**：每阶段的时间戳、改动范围、验证方式、回退点 |
| `docs/PRODUCT-GOAL.md` | **产品最终目标**（做完之后长什么样、验收标准、与 2026 主流路线的取舍） |
| `docs/ARCH-CLOUD-IDE.md` | **架构补充**：轻量 IDE + 本地/云端任务调度 + 高可定制化外观（含三条设计律） |
| `docs/COVERAGE-MATRIX.md` | **领域覆盖矩阵**：60+ 领域逐项落点 / 验收 / 状态（含 6 项补缺） |
| `knowledge/cards/016-electron-terminal-selection.md` | Electron 终端选型调研（含 8 个来源与结论） |
| `docs/SETUP-TERMINAL.md` | **在自己终端里怎么跑命令**（装内置终端的依赖 + 自检 + 常见报错） |
| `docs/PROGRESS.md` | **进度盘点**：已完成 / 未完成 / 被阻塞项 |
| `docs/PERF-BUDGET.md` | **性能预算与实测**（冷启动/可交互 预算 + 实测值 + 待办） |
| `docs/UX-AUDIT.md` | **体验细节排查表**（62 项：动效衔接/加载/响应/反馈/可达性/稳定性） |
| `docs/PLAN.md` | **开发计划（唯一执行依据，v3）**：目标与范围、选型、架构、模块、阶段任务与验收、风险、设计稿 |
| `docs/LEARNING-MAP.md` | 108 个知识领域的地图与学习顺序 |
| `review/EVALUATION.md` | **需求达成度评估**：此前运行各项要求的达成/未达成明细 |
| `knowledge/` | ★ 统一知识库（索引见 `knowledge/README.md`） |
| `knowledge/SOURCE-MATRIX.md` | 108 领域 × 5 类来源的逐格矩阵（脚本自动生成） |
| `knowledge/sources/` | S1–S11：每领域 T1–T5 五类权威来源 |
| `knowledge/cards/` | 知识卡片：对俱佳Agent 的落地决定 |
| `apps/desktop/` | Electron 桌面端（`src/main` · `src/preload` · `src/renderer`） |
| `packages/shared/` | 通用基础设施：原子 JSON 存储 `json-store`（tmp+fsync+rename+`.bak`+version 信封+损坏自愈） |
| `packages/ui-tokens/` | 设计令牌：颜色/间距/字号/圆角/阴影/**动效**（渲染层不得硬编码） |
| `packages/agent-core/` | Agent 运行时核心：模型 provider、SSE 流式协议解析、**工具层（路径沙箱 + 权限门）**（无 Electron 依赖，可单测） |
| `packages/shared-ipc/` | IPC 通道常量与载荷契约（zod，全进程共用） |
| `scripts/` | `cleanup.py` 等工具：清理、覆盖度统计、矩阵生成、链接校验 |

> 后续阶段的 `packages/agent-core`、`packages/canvas-core`、`packages/media-cap`、`packages/ui-tokens`
> 按开发计划 §6 在各阶段**按需创建**，不预建空壳目录。

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发（Electron + Vite HMR） |
| `npm run build` | 构建 main / preload / renderer |
| `npm run smoke` | **冒烟验证**：构建后无界面启动，检验「主进程 + 预加载桥 + 渲染层」全链路 |
| `npm run typecheck` | 全工作区类型检查 |
| `npm run lint` / `npm run format` | 代码检查 / 格式化 |
| `npm run test` | 单元测试（vitest） |
| `python scripts/cleanup.py` | 任务收尾清理（项目约定） |

## 快速开始

1. 阅读 `review/EVALUATION.md` 了解「已完成什么、还缺什么」
2. 按 `docs/PLAN.md` §5–6 执行（阶段划分与逐周任务/验收）
3. 按 `docs/LEARNING-MAP.md` 从 Electron + 流式模型开始
4. 实现顺序严格按 PLAN 的 W1 → W16

## 核心能力路线

| 版本 | 主题 |
|------|------|
| v0.1–v0.4 | 桌面壳 → Agent Loop → 工具与权限 → 记忆 → MCP/Skills/定时 → 打包 |
| v0.5 | **无限画布工作流**（拖拽建节点/连线/对齐/右键菜单）+ **内置浏览器**（可选系统默认浏览器）+ 文档查看 |
| v0.6 | **视频生成等多模态能力**，按用户自配模型能力门控（能力不足 → UI 禁用 + 说明） |

## 原则

1. 证据优先：Agent 完成任务以工具/测试结果为准
2. 安全默认：sandbox、权限队列、工作区路径校验、原子写
3. 性能预算：流式可输入、列表与画布虚拟化、主进程不阻塞
4. 可学习：模块小、可单测、文档与版本一致
5. 来源宁缺勿滥：知识库每格缺来源就留空写原因，绝不编造

## 收尾约定（用户规定）

每次任务结束执行 `python scripts/cleanup.py` 清理临时文件与陈旧记录；
确认后 `--apply` 移入项目内回收站 `.trash/`（保留 30 天可反悔）。此约定已写入项目记忆。
