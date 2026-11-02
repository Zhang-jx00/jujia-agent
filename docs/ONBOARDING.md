# 俱佳Agent · 接手指南（全景版）

> **这份文件是什么**：一份**按主题组织**的全景说明 —— 项目要做什么、已经做到哪、用什么做的、
> 哪些是硬性要求、开发过程中踩过哪些坑、接手后第一天该干什么。
> **面向的读者**：第一次接触这个项目的人（人或 AI），**手上没有任何会话记忆、没问过原来的作者**。
>
> **这份文件不是什么**：它**不是**逐轮台账，也**不是**状态真值。
> 它只复述**结构性事实**（架构、能力族、纪律、坑），**不复述会变的数字**
> （测试数 / e2e 步数 / 变异条数 / 判据条数 / 版本号 / 提交哈希）——
> 那些数字**只在有机器判据盯着的地方写**，本文件一律给「现扫命令」或「权威位置」。
>
> **与既有文档的分工**（重要，别把两份当一回事）：
>
> | 你想知道 | 看哪份 |
> |---|---|
> | **现在**的版本 / 门禁真值 / 队列计数 / 逐轮做了什么 | 根目录 [`俱佳Agent交接文档.md`](../俱佳Agent交接文档.md) §2 · §9 · §13；[`docs/PROGRESS.md`](PROGRESS.md)「**当前规模**」行；[`CHANGELOG.md`](../CHANGELOG.md) 顶部 |
> | **怎么做事**（32 条工作协议） | [`docs/WORK-PROTOCOL.md`](WORK-PROTOCOL.md) |
> | **界面怎么设计**（令牌 / 动效 / 命中区 / 每轮的 UI 口径） | [`docs/DESIGN-BASELINE.md`](DESIGN-BASELINE.md) |
> | **测试怎么写**（临时文件落哪 / 界面级断言四条硬规矩 / 会漂的计数怎么办） | [`docs/TEST-POLICY.md`](TEST-POLICY.md) |
> | **排期与队列**（T 号 / 里程碑 / 每轮题面） | [`docs/TRACK-ROADMAP.md`](TRACK-ROADMAP.md) · [`docs/TRACK-PLANS.md`](TRACK-PLANS.md) |
> | **能力总表**（哪些能力族已交付） | [`docs/CHECKLIST.md`](CHECKLIST.md) |
> | **发布 / 切公开的检查单** | [`docs/RELEASE-PREP.md`](RELEASE-PREP.md) |
> | **每轮复核记录**（含未通过项与原因） | [`review/REVIEW-LOG.md`](../review/REVIEW-LOG.md) |
> | **对外说明**（用户读的那份） | [`README.md`](../README.md) · [`SECURITY.md`](../SECURITY.md) |
>
> **怎么用这份文件**：
> ① **30 秒**：读 §1（目标与定位）+ §一 的四张表 ⇒ 知道这是什么、边界在哪；
> ② **一小时**：读 §2（技术栈）+ §4（架构）+ §5（红线）+ §十（从哪开始）⇒ 能上手改东西；
> ③ **一周**：读 §6（纪律）+ §八（坑）⇒ 知道这里的人是怎么工作的、哪些地方会骗你。
>
> 本文件成文时的代码基线：**现扫** `git log --oneline -3` 与 `git describe --tags --abbrev=0`。
> 本文件**不记哈希与日期**（会漂）——要基线就现扫。

---

## 一、目标与定位

### 1.1 这个产品是什么

**俱佳Agent** —— 一个**跑在你自己 Windows 上**的个人 Agent（桌面应用，不是网页，不是服务端）。

一句话定位：**能连第三方（Git / 终端 / 文件 / 浏览器 / 画布 / 定时 / MCP），但每一步越界都要当面问过。**

它与"又一个能聊天的编程助手"的根本区别在于：**把"不信任"做成了产品的一部分** ——
模型可以提议，但**放行与否由确定性的代码和你的手指决定**。

### 1.2 明确**不是**什么（这些是产品定位，不是待办）

| 不是 | 说明 |
|---|---|
| 不是服务端 / SaaS | **本产品没有服务器**、没有中转、没有遥测 |
| 不是安全沙箱 | 你批准过的命令就是在你机器上以你的权限执行 |
| 不是多用户产品 | 本机单用户桌面应用；按用户手表走（定时任务） |
| 不是跨平台产品 | **只支持 Windows 10/11**；源码层面对 macOS/Linux 做过兼容处理，但**未验证**（如实标注，不写"理论上支持"） |
| 不是自动执行器 | 执行类动作**永远不可被"总是允许"压掉**；自动下载 / 自动安装 / 后台轮询**刻意不开** |
| 不是插件私有协议 | 直接说 MCP，不自造一套 |

### 1.3 四条不可动摇的产品原则（动它要先问所有者）

1. **密钥不进渲染层、不进模型上下文、不进聊天记录、不进提交** ——
   API Key 用系统安全存储（Windows DPAPI `safeStorage`）加密留在本机；**不可用时退化为明文并在界面明确标注**（不假装安全）。
2. **数据默认不出本机**；唯一的例外是**你显式接入自己的主机、并显式把任务迁过去**（那时数据才会去到那台主机 —— **本产品没有服务器**）。
3. **静默失败是头号禁区** —— 任何跳过 / 吞掉 / 兜底 / 降级都必须在界面或日志里说一句话，并说清为什么可以这样。
4. **每个有副作用的动作都要你点头** —— 权限判定是**确定性规则**（`decideGate` 纯函数），不交给模型；`deny` / `ask` **绝对生效**（连"全部放行"模式也让路）；审批与执行都进**审计账本**；**定时任务 ≠ 免审批**。

### 1.4 远端与仓库现状

- 远端：GitHub `Zhang-jx00/jujia-agent`，**已公开**（判别法见 [`docs/RELEASE-PREP.md`](RELEASE-PREP.md) §三：带令牌请求返 `visibility: public`、**匿名**请求同一 URL 返 **200**）。
- **发布动作全部在所有者手里**：上传产物、编辑/发布 Release、更新发布页、切可见性、轮换凭据 ⇒ **等一句明确的「发」**。
- 凭据现役口径：**GCM 的 OAuth 令牌（`gho_`）**，没有固定到期日；仓库外那份 fine-grained PAT **已失效（401）** ⇒ 旧账里"90 天轮换"的倒计时是**假的**，照它安排会白跑一趟。
  **接手方不得代读凭据文件、不得代走授权链**。
- ⚠️ **本机对 `github.com:443` 有选择性阻断**（时好时坏）⇒ 推送配方见 **§七.5**（与 §十一 的速查表），**每轮重扫 IP**，别拿上一轮的名单当永久名单。

---

## 二、技术栈与工程形态

### 2.1 运行时与语言

| 项 | 版本 | 出处 |
|---|---|---|
| Node.js | `>=22`（引擎声明） | 根 `package.json` 的 `engines` |
| npm workspaces | lockfile v3，**5 个工作区包** | 根 `package.json` 的 `workspaces` |
| TypeScript | `^6.0.3` | 根 `package.json` devDependencies |
| Python | **未声明版本约束**（PATH 上实测 3.8.3） | 仓库级 `cleanup.py` / `count_coverage.py` / `gen_matrix.py` |

> ⚠️ **Python 是事实上的必需工具链，却没有任何版本约束或 CI 检查** ——
> `Path.is_relative_to` 是 3.9+ 的，`from __future__ import annotations` 只救注解、**不救运行时调用**。
> 写仓库级 Python 脚本时**只准用 3.8 可用的 API**。

**TypeScript 编译口径**（`tsconfig.base.json`）—— 这几条是**代码风格层面的硬约束**：

`strict` · `noUncheckedIndexedAccess` · `exactOptionalPropertyTypes` · `noImplicitOverride` ·
`noFallthroughCasesInSwitch` · `noUnusedLocals` · `noUnusedParameters` · `isolatedModules` ·
`verbatimModuleSyntax`（⇒ **类型导入必须用 `import type`**，否则编译期报错）· `noEmit` · `skipLibCheck`

目标：`ES2022` / `module: ESNext` / `moduleResolution: Bundler`。

> **根目录没有 `tsconfig.json`** ⇒ `npm run typecheck` 只跑 5 个工作区包；**根 `scripts/*.mjs` 完全不受 TS 检查**。

### 2.2 框架与关键运行时依赖

| 包 | 版本 | 用途 | 关键约束 |
|---|---|---|---|
| `electron` | `44.4.2`（**精确固定，无 `^`**） | 桌面壳 | 三层：main / preload / renderer |
| `react` / `react-dom` | `^19.3.0` | 渲染层 | |
| `@xyflow/react` | `^12.12.0` | 无限画布 | 第三方默认样式**必须被 CSS 接管**（深色主题漏白底那个坑） |
| `@xterm/xterm` + `addon-fit` | `^6.0.0` / `^0.11.0` | 内置终端 | 卸载**不杀会话**，回来**先问再接** |
| `node-pty` | `^1.1.0` | 真实伪终端 | 原生模块，**必须 unpack**；归 exec 类 |
| `pdfjs-dist` | `^6.3.289` | 离线中文 PDF | 只走 `b64_json` / 字节，**不下载链接**（避 SSRF） |
| `zod` | `^3.23.8` | 全部 IPC 载荷契约 | 对象一律 `.strict()` |

> **零新依赖是纪律**：加依赖属停牌项（要问所有者）。图标因此**内联 SVG 路径**（Lucide · ISC），
> 而不是引 npm 包。

### 2.3 构建 / 测试 / 质量工具

| 类别 | 工具 | 版本 | 备注 |
|---|---|---|---|
| 构建 | `electron-vite` + `vite` + `@vitejs/plugin-react` | `^5.0.0` / `^7.3.6` / `^5.2.0` | 三段构建：main / preload / renderer |
| 打包 | `electron-builder` | `^26.15.3` | NSIS + portable，**只有 x64** |
| 测试 | `vitest` | `^5.0.1` | 从**仓库根**跑；无 jest / cypress |
| 渲染层组件测试 | `@testing-library/react` + `jsdom` | `^16.3.3` / `^30.1.1` | **只作 devDependencies**，不加覆盖率门禁 |
| e2e | `playwright-core` | `^1.63.0` | 只驱动**真实 Electron**，**不下载浏览器** |
| 质量 | `eslint`（flat config）+ `typescript-eslint` + `prettier` | `^10.10.0` / `^8.70.0` / `^3.9.8` | 无 husky / lint-staged / commitlint |

### 2.4 monorepo 分区与依赖方向

```
apps/desktop ──▶ @jujia/agent-core ──▶ zod
      │          @jujia/shared       （无依赖）
      │          @jujia/shared-ipc ──▶ zod
      └─▶ @jujia/ui-tokens          （无依赖）
```

| 包 | 职责 | 对外暴露 |
|---|---|---|
| `apps/desktop` | Electron 桌面壳（main / preload / renderer）+ 门禁脚本 | 产品版本号在这里（每轮 **+minor**） |
| `packages/agent-core` | **与 UI 无关**的智能体内核：provider / loop / 工具 / 权限 / 审计 / Git / 浏览器 / MCP / 定时 / 技能 / 插件 / 媒体 / 更新的**纯逻辑** | 44 个 `export *`；**零 Electron 依赖** ⇒ 可纯 node 单测 |
| `packages/shared` | 原子 JSON 存储 + 流式合批 | `JsonStore` / `atomicWriteJson` / `readJsonSafe` / `Envelope<T>` |
| `packages/shared-ipc` | IPC 通道常量 + zod 载荷契约（四端共用） | `IPC`（通道清单的**权威**）+ 全部 schema |
| `packages/ui-tokens` | 设计令牌与外观样式包 | 颜色 / 间距 / 字号 / 圆角 / 动效 + 样式包白名单与纯规则 |

> **两个刻意为之的设计**（别"顺手优化"掉）：
> ① `packages/*` **没有 build 步骤**，`main`/`types` 直指 TS 源码 ⇒ 但 electron-vite 必须把它们**打包进产物**
> （`INTERNAL_PACKAGES` 排除名单），否则运行时 `ERR_MODULE_NOT_FOUND`；
> ② `shared-ipc` **故意不从 `agent-core` 引类型**（避免循环依赖）⇒ 两边各自定义形状，
> **成员必须一致**这件事由 `policy-consistency.test.ts` 的一致性锁保证，不靠人记得同步。

### 2.5 打包产物形态

| 产物 | 形态 | 要点 |
|---|---|---|
| NSIS 安装包 | `JujiaAgent-Setup-<版本>.exe` | 非一键、非 per-machine、**允许改安装目录**、建桌面 + 开始菜单快捷方式 |
| 便携版 | `JujiaAgent-<版本>-portable.exe` | 单文件免安装 |
| 解包目录 | `apps/desktop/release/<...>/win-unpacked/` | `JujiaAgent.exe` + `resources/app.asar` |

- **asar 内容**：`out/**/*` + `package.json` + **生产依赖**（`node_modules`）；
  **排除** `build/` 与 `release/`。
- **必须 unpack**：`node-pty`（含 `pty.node` / `conpty.node`）与 `@napi-rs/canvas` 的 `.node` ⇒ 打包配置里写了 `asarUnpack`。
- **主进程产物是 CJS**（`apps/desktop/package.json` 没有 `"type": "module"`，只有根有）；渲染层是 ESM。
- 输出目录 `apps/desktop/release/` **已 gitignore**；分发走 GitHub Release。
- ⚠️ **`apps/desktop/build/icon.png`（打包图标）不在 Git 里** —— `.gitignore` 的 `build/` 规则连带命中了它
  ⇒ 干净克隆上 `npm run dist` **不可用** ⇒ 恢复路径是从入库的 `assets/icon/source-generated.png`
  生成（脚本 `apps/desktop/scripts/restore-icon.mjs`，**目前没有 npm script 别名指向它**）。
  ⇒ **发版前必须现扫这一格**（CI 不跑 `dist`，所以这条缺口在 CI 里看不见）。

### 2.6 CI 与门禁分档

| 档 | 门禁 | 什么时候跑 | 进 CI 吗 |
|---|---|---|---|
| **快档** | `typecheck` · `lint` · `test` · `check:docs` · `e2e` | **每次提交前** | CI 跑前四项；**`e2e` 不进 CI**（需要真实 Electron 与图形环境） |
| **慢档** | `smoke` · `perf` · `verify:pack` · `mut` | 阶段收尾与发版前 | **一项都不进 CI** |

- CI 两个 workflow：`ci.yml`（push main / PR / 手动）与 `mutation.yml`（**只手动触发**，因为变异是"逐条改坏源码再跑测试"，几十分钟量级）。
- CI checkout **刻意用 `fetch-depth: 0`**（全量历史 + 标签）—— 因为有一条判据要核对「CHANGELOG 回退点标签真实存在」，
  浅克隆不带标签 ⇒ 那条必然假红。**宁多拉几百 KB，不关掉一条真检查。**
- CI 取真值**不用 `gh` CLI**（本机没装）⇒ 走 API 取 run 的结论。

### 2.7 反直觉配置（照抄，别"顺手修"）

| 配置 | 为什么反直觉 |
|---|---|
| `vitest.config.ts` **没有** `passWithNoTests` | 那一项为 true 时，"一个测试都没收集到"会**以退出码 0 收场** —— 门禁看着绿，其实什么都没跑 |
| `include` **只能有一份** | 曾有两份同名 `include` 键，后者覆盖前者 ⇒ 第一份从头到尾是死代码 ⇒ "安静地少跑东西" |
| `maxWorkers: 4`（不按 CPU 核数拉满） | 本机 spawn 子进程慢时会出现**收集阶段失败**（`FAIL <file> [ <file> ]`，方括号 = 收集失败不是用例失败），单独跑是全绿 ⇒ 假红灯会让人开始忽略红灯 ⇒ **稳定性高于几分钟机器时间** |
| 独立的 `vitest.global-setup.ts` 保证 `.tmp/` 存在 | `mkdtemp` **不建父目录**；而每个收口轮 `cleanup.py --apply` 会把 `.tmp` **整只收进 `.trash`** ⇒ 两者都会让全量测试**集体假红** |
| `environment: 'node'` 是默认，jsdom 靠**文件头 pragma** | 渲染层组件测试各自写 `// @vitest-environment jsdom` |
| `electron.vite.config.ts` 被**排除在类型检查外** | vite 7 的 rolldown 类型与 plugin-react 的 rollup 类型在 `MinimalPluginContext` 上结构性不兼容（生态问题） |
| `npmRebuild: false` | `node-pty` 是 **N-API 模块**（预编译产物跨 Node / Electron 通用）⇒ 不需要 `electron-rebuild`；手动开启反而会撞 MSB8040 |
| ESLint **忽略 `scripts/`** | 仓库级护栏脚本（`.mjs`）不受 ESLint 约束 ⇒ 写它们要自己保证质量 |
| ESLint `max-lines: 800`（skipBlankLines + skipComments） | 防单文件巨石；**行数一律按 eslint 口径**报 |
| `.gitattributes` 强制 LF（`.bat/.cmd/.ps1` 例外 CRLF） | 仓库在 Windows 开发、CI 与贡献者可能在 Linux/macOS；混 CRLF 会让 shebang 失效、测试因末尾 `\r` 失败、diff 噪声 |
| `package-lock.json` 全走 `registry.npmmirror.com` | CI 的 `npm ci` 也从镜像拉包（CI 没设 `registry`）⇒ **换网环境时留意** |

---

## 三、已开发内容（能力地图）

> **权威在台账**：能力面以 [`docs/CHECKLIST.md`](CHECKLIST.md) 与 [`docs/PROGRESS.md`](PROGRESS.md) 为准；
> 本节给的是**地图**（哪一族能力存在、关键约束在哪），细节与逐轮交付去那两份看。

### 3.1 能力族总表

| 层 | 能力族 | 一句话 | 在哪 |
|---|---|---|---|
| **内核** | Agent Loop | 三分支（final / tool / handoff）、有迭代上界、工具串行、**工具失败不中止对话** | `packages/agent-core/src/loop/` |
| | Provider 层 | OpenAI 兼容流式 + SSE 解析 + `tool_call` 分片归位 | `packages/agent-core/src/providers/` |
| | 工具与执行器 | 注册表是**唯一准入**；未注册名字一律拒绝，不做模糊匹配 | `packages/agent-core/src/tools/` |
| | 权限门 | `decideGate` 纯函数：规则 → 模式 → 高危清单 → 敏感路径 → kind | `packages/agent-core/src/permissions/` |
| | 审计 | 判定事实 → 账本；**剔密在落盘之前** | `packages/agent-core/src/audit/` |
| | 记忆 | `AGENTS.md` 递归加载 + `NOTES.md` 长期记忆（带注入隔离声明） | `packages/agent-core/src/memory/` |
| | 技能 / 插件 | 渐进披露；插件一个 manifest 打包技能 + 命令 + MCP | `packages/agent-core/src/{skills,plugins}/` |
| | 钩子 | 七类事件；默认禁用；exit 2 = 显式拒绝 | `packages/agent-core/src/hooks/` |
| | MCP 纯逻辑 | JSON-RPC / 客户端 / 准入 / 工具桥 | `packages/agent-core/src/mcp/` |
| | 定时算式 | RRULE **子集**（子集外**解析阶段直接拒**）+ 补跑口径 | `packages/agent-core/src/schedule/` |
| | Git / 终端 / 浏览器 / 媒体 / 更新 | 纯逻辑层（不碰 IO） | `packages/agent-core/src/{git,terminal,browser,media,update}/` |
| **壳** | 桌面壳 | 左栏导航 + 主区两栏；设置中心**盖整窗**；全局启动器 `Ctrl/Cmd+Shift+P` | `apps/desktop/src/renderer/src/` |
| | 对话 | 流式渲染、历史分页、压缩、结束记要点、附件、任务卡 | `features/chat/` |
| | 轻量 IDE | 文件树 + 打开/编辑/保存 + PDF 入口 | `features/ide/` |
| | 画布 | 工具节点 / 条件分支 / 有界循环 / 局部重跑 / 断点续跑 | `features/canvas/` |
| | 内置终端 | 真 PTY；**卸载不杀会话** | `features/terminal/` |
| | 内置浏览器 | 三档打开；跨站被拦；302 逐跳过门；下载一律取消 | `features/browser/` |
| | Git 面板 | 暂存/提交/推送，写操作的硬 ask 语义**显示在界面上** | `features/git/` |
| | 定时任务 | 清单 + "下一次几点"（主进程算好） | `features/schedule/` |
| | 绘图 | 文生图；提示词真发出去；**只收 `b64_json`，不下载链接** | `features/media/` |
| | 连接 | 连接管理 + 连通性测试 | `features/connections/` |
| | 日志 / 更新 / 概览 | 日志卡（剔密在落盘前）· 更新卡（点一次查一次）· 概览（运行时 / 配置 / 工作区 / 安全基线 / 许可） | `features/{logs,update,workspace,notices}/` |
| **扩展** | MCP 服务端 | 逐个批准；**未批准的工具根本不注册进工具表** | `features/mcp/` + `main/mcp/` |
| | 钩子配置 | JSON 直接编辑；校验失败**不落盘** | `features/hooks/` |
| | 插件 | 展示来源与真实贡献物 | `features/plugins/` |

### 3.2 内置工具清单（注册表是唯一准入）

| 工具 | kind | 一句话 | 权限语义 |
|---|---|---|---|
| `read_file` | read | 读工作区内文本文件 | 自动放行（上限内） |
| `list_dir` | read | 列目录直接子项 | 自动放行 |
| `write_file` | write | 写入工作区内文件 | **软 ask**（可被"本会话总是允许"压掉） |
| `append_note` | write | 追加一句进工作区长期记忆（≤500 字、append-only） | 软 ask |
| `run_command` | **exec** | 执行命令（超时默认 30s / 上限 300s、必杀进程树、环境剔敏） | **硬 ask —— 结构性压不掉** |
| `load_skill` | read | 按需读技能正文（带注入隔离声明） | 自动放行 |
| `handoff` | read | 请求移交任务（**不进注册表**，循环内联注入） | 自动放行 |
| MCP 工具 `<server>__<tool>` | **默认 exec** | 第三方服务端提供的工具 | 只有服务端**明确声明只读**才降级为 read |

> **关键语义**：用户拒绝或超时，工具**返回 `ok:false` 而不是抛异常** —— 模型必须看到"用户拒绝了"。
> **第三方工具默认按最严格档**；服务端自称"只读"**不跳过**权限门（这是已登记的边界，写在界面与 `SECURITY.md` 里）。

### 3.3 IPC 与 preload 桥

- 通道清单的**权威是 `packages/shared-ipc/src/channels.ts`**（现扫即得条数），**禁止裸字符串**。
- preload 桥方法与通道**一一对应**（现扫 `apps/desktop/src/preload/index.ts`）。
- **preload 的三条边界原则**（写在文件头）：
  ① **不暴露 `ipcRenderer` 本体** —— 只暴露具体方法，一方法一通道；
  ② **出参一律再校验一次**（`schema.parse`）—— 契约漂移在 preload 这侧就炸，不让它流到界面；
  ③ **密钥单向** —— `apiKey` 只在新增/更新连接时送出，**永不回传**。
- 通道命名规律（看名字就知道用途）：
  `<能力域>:<动作>`；`-event` = main→renderer 单向推送；`-list` 读集合 / `-get` 读单项；
  `-save` 写入（可 upsert）；`-delete` 删资源 / `-remove` 删表项；`-toggle` 状态开关；
  `-resolve` / `-approve` = 渲染层回填用户决定；`-tail` 取尾部 / `-export` 整本带走。
- **全进程唯一 IPC 入口**（`main/ipc/handle.ts`）：先校验发送方是本应用渲染层再放行 ⇒
  将来引入第二个 webContents（内置浏览器）时**不会顺手开全套 IPC**。

### 3.4 数据落盘面（数据根 = `%APPDATA%\JujiaAgent\JuJiaData`，可用 `JUJIA_DATA_BASE_DIR` 整体挪走）

统一信封：`{ "version": <schema版本>, "updatedAt": "<ISO8601>", "data": <载荷> }`
写入序列 = 同路径串行 → 写 `.tmp` → `fsync` → 旧文件转 `.bak` → `rename`
读取序列 = primary → `.bak` → 默认值（返回 `source: 'primary'|'backup'|'default'`）
**主文件损坏时改名为 `.corrupt-<ts>`，不覆盖健康备份；空文件按"损坏"处理，不静默当"没有"。**

| 类别 | 路径 | 格式 | 关键约束 |
|---|---|---|---|
| 应用配置 | `config.json` | JSON 信封 | 渲染层只能写**白名单键**；工作区**不在白名单**（它是权限边界） |
| 连接（含凭据） | `connections.json` | JSON 信封 | 密钥存 `safeStorage` 或**明文并标注**；渲染层永远拿不到明文 |
| 会话 | `sessions/index.json` · `sessions/<id>/session.meta.json` · `messages.jsonl` · `summary.md` | JSON / JSONL(append-only) / Markdown | **apiKey / 请求头 / 完整 query 永不入库**；JSONL 只追加完整行，读到不完整行**丢掉并报告** |
| 长任务 | `sessions/<id>/task.json` | JSON 信封 | 读不出 = 没有记录 |
| 待记要点账 | `pending-notes.json` | JSON 信封 | 退出路径**只记账**，下次启动再问 |
| 执行审计 | `audit/permissions-<日期>.jsonl` | JSONL（按天） | **剔密在落盘前**；导出 = 原样复制，不二次加工 |
| 结构化日志 | `logs/app-<日期>.jsonl` | JSONL（按天） | 剔密在记录诞生时；保留 7 天；**无网络路径** |
| 权限规则表 | `permission-rules.json` | JSON 信封 | **读坏不许静默当"没有规则"**（健康度随审计上报） |
| 钩子配置 | `hooks.json` | JSON 信封 | 校验失败**不落盘** |
| MCP 配置 | `mcp-servers.json` | JSON 信封 | **只存配置，不存批准结果** |
| 定时任务 | `schedules/tasks.json` | JSON 信封 | 停用不删账 |
| 画布图 | `canvas/<id>.json` | JSON 信封 | id 白名单；空图不许覆盖已有图；图里只有 `connectionId` |
| 生成图片 | `generated-images/` | 图片字节 | 只收 `b64_json`；**不回程下载链接**（避 SSRF） |
| 工作区长期记忆 | `<工作区>/.jujia/NOTES.md` | Markdown（append-only） | 硬上限 200 行 / 25KB；写入前过路径守卫 |
| 项目指令 | `<工作区>/**/AGENTS.md` | Markdown | 逐层递归、最近优先、标注出处；超 600 行截断并标注 |

### 3.5 出站面（**没有遥测**；逐条列在 `SECURITY.md` 的出站表里）

| 目标 | 什么时候 | 送出去什么 | 边界 |
|---|---|---|---|
| 你配置的模型 API | 每次对话 / 工具往返 | 系统提示、对话历史、工具调用与结果、**你附加的图片**（内容块） | 图片**不落盘**；发送前剥 EXIF/XMP，剥不干净就拒发 |
| 同一模型 API 的生成子项 | 你在绘图页按「生成」 | 提示词、张数、尺寸 | **只接受图片数据本身**，不回程下载链接 |
| 第三方 MCP 服务端（本机子进程） | 连接并批准后 | 工具参数 | 它**自己**发起的网络请求不受我们控制（它是独立程序） |
| 内置浏览器 | 你访问网页时 | 与该站点的正常流量 | 跨站被拦、302 逐跳过门、**下载一律取消** |
| 检查更新 | 你点「检查更新」时 | 一条**不带任何本机数据**的 GET | **不下载、不执行、无轮询** |
| 用户自建的主机（**⏳ 未开工**） | 你显式接入并迁移任务时 | 迁过去的那部分任务数据 | 去的是**你自己那台机器**；**本产品不参与** |

---

## 四、系统架构与关键链路

### 4.1 三层职责边界

| 层 | 能做什么 | 不能做什么 |
|---|---|---|
| **main**（主进程） | 一切 IO、进程、系统能力、权限判定、落盘 | —— |
| **preload** | `contextBridge` 暴露的**具体方法**（一方法一通道）+ 出参再校验 | **不暴露 `ipcRenderer` 本体**；不直接给渲染层密钥明文 |
| **renderer** | React 渲染、用户交互、界面状态 | **无 Node**（`contextIsolation` + `sandbox`）；**不许自己判档** |

**主进程内部再分三层**（别越级）：
- **服务层**（`main/*.ts`）：业务能力（会话、Git、终端、浏览器、MCP、调度、日志、审计…）；
- **IPC 层**（`main/ipc/*.ts`，17 个模块）：**只过契约，不写业务**；`ipc.ts` 是**装配根**（只管装配顺序）；
- **判档层**：**每个动作域只有一处判档**（`git-gate` / `open-with-gate` / `hooks-gate` / agent-core 的 `policy.decideGate`）
  ⇒ "同一个目的地出现第二处门"是本仓明确禁止的形状。

### 4.2 权限判定链（核心，改这块前必须读懂）

```
用户规则表（deny / ask 绝对生效，连 bypassPermissions 也让路）
  → 权限模式（default / acceptEdits / plan / dontAsk / bypassPermissions）
  → 高危清单
  → 敏感路径硬 ask（.env / .git / 私钥 / 凭据 / 锁文件 / CI 配置）
  → 工具 kind（read 自动放行 · write 软 ask · exec 硬 ask）
  → 判出来：放行 / 询问（带 bypassable 标记）/ 拒绝
```

- **软 ask**（`bypassable: true`）：默认的"写文件要不要做" ⇒ 界面可以给「本次会话总是允许」。
- **硬 ask**（`bypassable: false`）：高危清单 · 用户自己写的 `ask` 规则 · 敏感路径 · **执行类命令**
  ⇒ **任何"总是允许"都压不掉**，界面也**不许渲染**那个按钮。
- **审批弹窗标题必须写明"为什么问"**（读 `.env` 与读 README 长得一样的弹窗，只会养出惯性点允许）。
- **"总是允许"按工具名记** ⇒ 所以执行类必须是硬 ask（按工具名记住"总是允许 run_command"等于放行**任意命令**）。
- **审批收尾必须按请求 id 精准**：超时 / 窗口销毁只关被点名那一张（"一把全关"是错的解法）。

### 4.3 关键链路速查（改动时按这条链找落点）

| 链路 | 一句话 | 接线锁在哪 |
|---|---|---|
| **A 发消息** | 渲染层 → preload → `ipc/chat.ts` → **`turn-trigger.startTurn()`（唯一入口）** → chat-service → agent-core streamChat → 事件回推 → 落 `messages.jsonl` | `chat-send.test.ts` / `stream-event.test.ts` |
| **B 调工具被拦** | tool_call → executor → `decideGate` → permission-bridge → 渲染层弹窗 → 决定 → **审计记账**（剔密在落盘前）→ 真正执行 | `permission-bridge.test.ts` / `audit-gate.test.ts` |
| **C 接入 MCP** | 存配置 → 起子进程 → 握手 → 列工具 → **待批计划（默认一个不勾）** → 批准后**才注册进工具表** → 断开退进程 | `mcp-consent.test.ts` / `mcp-tool-bridge.test.ts` |
| **D 定时到点** | 定时器 → RRULE 算式 + 补跑 → 推进水位线 → **同一个 `startTurn()`** ⇒ 照样过权限门 | `schedule-service.test.ts` |
| **E 画布跑图** | `canvas-run` 编排（拓扑序 / 局部重跑闭包 / 步数上界 / 取消传播）→ 工具节点**同一注册表同一权限门** | `canvas-run.test.ts` / `canvas-bridge.test.ts` |
| **F 文生图** | 渲染层只传连接 id + 提示词 + 张数 → 主进程取密钥 → 回程字节过魔数 + 上限 → 落数据根 | `image-gen-service.test.ts` |
| **G 内置终端** | 挂载 → **先问再接** → 无会话才新建（exec 类，每次都要确认）→ node-pty → 流式推送 | `terminal-lifecycle-wiring.test.ts` |
| **H 打开外部** | `open-with-gate` 判档（internal 不问 / system·custom 硬 ask，**没有"总是允许"**）→ `shell.openExternal`（`shell:false`） | `open-with-gate.test.ts` |
| **I 更新检查** | 点一次 → 一次 GET（8 秒超时）→ 版本比较 → 三种结局三种话 | `update-service.test.ts` |
| **J 记要点** | 结束会话 → **只记账** → 下次启动问 → 预览（此时才调模型）→ 「记住」才进 `NOTES.md` | `pending-notes.test.ts` / `memory-wiring.test.ts` |

---

## 五、硬性要求（红线）

### 5.1 安全基线（`SECURITY.md` 的机制表 · 摘要）

| 机制 | 做什么 |
|---|---|
| 路径沙箱 | 所有文件操作限制在**你选定的工作区**内；拦 `..` 逃逸、设备路径、UNC、NTFS 备用数据流、软链/junction 逃逸 |
| 权限门 | 每个有副作用的动作都要你确认；判定用**确定性规则**；支持**按参数分级**（写普通文件与写 `.env` 结论不同） |
| 敏感路径强制询问 | 即使在「自动接受编辑」模式下，`.env` / `.git/` / 私钥 / 凭据 / 锁文件 / CI 配置**必须询问** |
| 审批分硬软两级 | 「本会话总是允许」**只压软询问**；**硬询问压不掉** |
| 审批钩子不被按钮绕掉 | 硬询问时 `PermissionRequest` 钩子**照常运行** ⇒ 界面一个「总是允许」废不掉你写的审批程序 |
| IPC 发送方校验 | 全部通道走统一入口，先校验来自**本应用渲染层**；来源未知一律拒绝（纵深防御） |
| 密钥不泄露 | API Key 不进渲染层、不进模型上下文、不进聊天、不进提交 |
| 终端不带敏感环境变量 | 子进程环境剔除 KEY/TOKEN/SECRET/PASSWORD/凭据类变量；代理变量保留但**脱掉内嵌的用户名口令** |
| 导航只认自家页面 | `file:` **不再无条件放行**：只有落在渲染层目录内的才允许 |
| 终端走权限门 | 归 `exec` 类，**每次新建会话都要确认**；权限桥不可用时 **fail-closed（一律拒绝）** |
| 终端 shell 用绝对路径 | 取不到 `ComSpec` 时回退 `%SystemRoot%\System32\cmd.exe`，**不用裸 `cmd.exe`**（避免 PATH 劫持） |
| 外观安全 | 样式包只允许**受控字段**，**拒绝任意 CSS/JS**（防 XSS/RCE） |

### 5.2 必须停下来问（停牌点）

| 类别 | 内容 |
|---|---|
| **等一句明确的「发」** | 上传产物 · 发布/编辑 Release · 更新发布页 · 切仓库可见性 |
| **需要交互授权链 ⇒ 我不做** | 凭据轮换（只做到"查清现状 + 写清步骤"） |
| **改安全语义 ⇒ 停牌** | 权限判定、权限映射、信任边界、敏感路径清单 |
| **加依赖 ⇒ 停牌** | 零新依赖是纪律（图标因此内联 SVG 而不是引包） |
| **等一个明确的题面** | 能力开发类（M11 其余 / M14 / M20–M22） |

> **2026-10-21 起所有者不再逐项拍板**，产品/开发类决策由维护方自行决定并**留痕**（`docs/DECISION-SELF-DIRECTED.md`）；
> **仍然不做的两条**就是上表前两行（对外不可逆动作 + 凭据）。

### 5.3 禁止事项（硬）

1. **禁止把 GUI 自动化跑在用户桌面上** —— e2e / 拍图必须带无头开关（离屏 + `show:false`），
   **不许弹窗、不许抢焦点**（曾把用户正在玩的游戏顶掉）。
2. **禁止 `git add -A`** —— 同仓有并发线时会把别人正在写的半成品一起提交。
3. **禁止改写已推送的历史、禁止移动已推的标签** —— 写错了开新标签、两处同时勘误。
4. **禁止在注入自检 / 变异跑的时候提交** —— 那段时间提交，进去的就是注入形态。
5. **禁止杀归属不明的进程** —— 哪怕是为了让门禁跑通。
6. **禁止用 PowerShell 的文本管道原地改写含中文的源文件** —— `Get-Content -Raw | Set-Content` 会按代码页解码再按 UTF-8 编码 ⇒ **中文变乱码、字符串字面量的引号都被吃掉** ⇒ 整份源码报废。
7. **禁止把管道接在门禁命令后面** —— 管道会把退出码换成最后一个命令的（`npm run typecheck | tail` 让一条真实的类型错被读成"零错误"，**两轮都中招**）。
8. **禁止在命令里接管道判断成功** —— **一切命令以退出码为准**；要看输出就重定向到文件再读。
9. **禁止用脚本生成/改写源码文本** —— 写文件一律用编辑工具；脚本只做"读与跑"。
10. **禁止在对外表述层出现参考项目名称或「借鉴 / 对标」**（表头由机器判据盯，散文由人工复核）。

---

## 六、开发纪律（[`docs/WORK-PROTOCOL.md`](WORK-PROTOCOL.md) 的可用版）

> 原文 **32 条**、逐条有出处。本节是**执行摘要**；真要改动纪律，去读原文 + `review/REVIEW-LOG.md` 的留痕。

### 6.1 一轮（= 一个「排查NN」轮次）的固定流程

```
1  现扫真值      先读现状、查历史、核实事实 —— 再动手
2  否证          看着像缺陷的东西，先查它是不是既有约定；是约定就如实写"不改"并给理由
3  题面现扫定    不照抄计划、不照抄台账题面；现扫不成立 ⇒ 如实记"无可自裁切口"并转下一题
4  改            零新依赖、零新通道；不改安全语义与权限映射
5  配锁          每条新判据必须当场证红（变异 / 注入用例）
6  跑门禁        快档全绿（typecheck / lint / test / check:docs / e2e）
7  重拍展示图    动了界面就重拍（离屏），并同步清单 + README 图注
8  提交 + 标签   版本 +minor；标签打在主体提交上；中文提交说明
9  回填笔 + 推送 + 独立回读    git ls-remote 看过才算数
10 收尾          cleanup.py --apply + 记账 + 残留如实记
```

### 6.2 提交顺序（有讲究，勿调换）

> **先写 CHANGELOG 条目 → 实现与测试 → 版本号先改 → 全门禁（含图形类）→ 提交（中文说明）
> → `mut`（仅干净基线）→ 打标签 → push → `git ls-remote` 核对远端 SHA → 台账 → `cleanup.py --apply`**

- **标签名** = `vX.Y.Z-<轨道词><流水号>`，**只取轨道段、不带任务号后缀**（标签是检索键，带上任务号就查不到同类）；
  CHANGELOG 的**回退点必须写真实存在的标签名**，打完用 `git tag --list` 现扫核对。
- **绝不改写已推送的标签**。
- **`git ls-remote` 核对那一步永远不许省** —— 它是这条链上唯一能证伪"我以为推上去了"的东西。

### 6.3 数字纪律（本仓最常见的病）

| 规则 | 做法 |
|---|---|
| **数字只写一处** | 会变的计数（测试数 / 步数 / 变异条数 / 判据条数 / 命中处数 / 档数 / 文件数）**只写在有机器判据盯的那一处**，其余位置写"以脚本输出为准" |
| **不手抄** | 数字、哈希、时间戳、版本归属**只从真实命令输出抄**；**手算的一律不算数**（手算的灰带上界、对比度都曾因此错过） |
| **不拿旧值冒充现况** | **现扫优先**（上一轮自己报的数字也可能是错的） |
| **生成物不许漂** | 生成物（`docs/DEPENDENCY-LICENSES.md` 等）要由生成器产出并**逐字对账**；没人提交它 ⇒ 它静默漂 |
| **同一事实两处手抄 ⇒ 删副本** | 该守的接真源 · 别处已有的删副本 · 每笔都变的**不写死**（改成"怎么核"） |
| **基线测量只能当判读依据** | 量出来的数（"页签 48 行"）**不许写成断言**（"必须 45 行"就是会被合法增长养瞎的锁） |

### 6.4 判据纪律

- **每条新判据必须当场证红** —— 本仓的机器化做法是：判据进 `scripts/check-docs.mjs`（或对应脚本），
  同时在它的自检脚本里加一处**注入用例**，跑一次看它红不红。**没被红过的判据等于没有判据。**
- **判据宣称的覆盖面 = 它实际测到的覆盖面** —— 标题里那句括号若比断言宽，**那条锁就是假绿**。
- **失焦的锁比没有锁更坏** —— 它给人"有覆盖"的错觉。枚举现状清单的锁**一律现扫**，不写死。
- **安全类断言必须双向** —— 断"危险的东西没进 DOM"的同时，要断"那串源文本还在 / 那个语法确实被识别"。
  只测前一半，"整块根本没渲染"会被当成通过。
- **源码扫描先剥注释** —— 否则注释会替声明作证。
- **「查到了」≠「画出来了」** —— 取到与用上要分成两条断言。
- **前提不存在 ≠ 有问题** —— 单列「不适用」一档：既不报绿（恒绿的锁比没锁更坏）也不报红。
- **量不到就红** —— 别让"查不到"变成"通过"。

### 6.5 表述层纪律

- **对外表述层**（README / 对外文档 / 界面文案 / **文档的表头**）不得出现参考项目名称，也不得出现
  "借鉴 / 对标"这类把别家当参照物的说法（**表头由机器判据盯，散文由人工复核** —— 判散文必然误报，
  **误报三次的判据最后都是被人删掉**）。
- **研究底稿层**（出处链接）**保留** —— 那是"依据是什么"，不是"我们照着谁做"；研究痕迹只留私有目录（永不入库）。
- **已公开的历史不改写**（红线）：仓库早已 public ⇒ 历史上出现过的名称**已经在公开历史里** ⇒ 改文档追不回暴露。
- **素材来源 ≠ 参照物**：内联图标来自 Lucide（ISC）⇒ **必须保留版权声明**（"随副本保留"只对**分发副本**成立）。
- 提交说明**一律中文**；CHANGELOG 标题 = `## [vX.Y.Z-<轨道词>N] — 日期`。

---

## 七、GitHub 操作全指南（提交 · 标签 · 推送 · 回读 · CI 取真值 · 边界）

> 这一节是**操作手册**：怎么提交、怎么打标签、怎么推、推完怎么证明推上去了、CI 结论怎么取真值，
> 以及**哪些事情不许做**（不干扰其他项目 / 其他仓库 / 其他 worktree）。
> 纪律原文在 [`docs/WORK-PROTOCOL.md`](WORK-PROTOCOL.md) 第 2 条与根交接文档 §6；本节是**可照着敲**的版本。

### 7.1 远端与仓库现状（现扫，别凭记忆）

| 项 | 值 |
|---|---|
| remote 名 | `origin` |
| URL | `https://github.com/Zhang-jx00/jujia-agent.git`（**HTTPS，不是 SSH** —— 本机 SSH 私钥当前用户读不了） |
| 主分支 | `main`，跟踪 `origin/main` |
| pushurl | **未单独配置**（push 与 fetch 同一地址） |
| 可见性 | **已公开**（判别法见 §一 1.4） |

```bash
git -C "<仓库根>" remote -v
git -C "<仓库根>" branch -vv
```

### 7.2 一轮里与 GitHub 有关的**完整顺序**（缺一步，下一步就没有输入）

```
1  写 CHANGELOG 条目（含"回退点"标签名）
2  实现 + 测试
3  版本号先改（apps/desktop/package.json，每轮 +minor）
4  全门禁（快档；慢档在阶段收尾 / 发版前）
5  精确 add（逐个文件路径 —— 禁 git add -A）
6  提交（中文说明）
7  在【已提交的干净基线】上跑变异
8  打标签（打在【主体提交】上）
9  git push（分支 + 标签）
10 git ls-remote 独立回读核对  ← 唯一能证伪"我以为推上去了"的东西
11 台账回填（另建"回填笔"提交：不 amend、不移动已推标签）
12 清理 + 记账
```

### 7.3 提交（commit）怎么写

- **说明一律中文**，无英文前缀；正文**不得含会被扫描器误判的字面量**。
- 主体提交模板：`排查39（R70）：<一句话主题> —— <关键取舍>`
- 回填笔模板：`回填笔（R70）：<补记了什么>`
- `git add` **只写路径**（可一次列多个）：`git add "apps/…/x.ts" "docs/y.md"`
  ⇒ **绝不 `git add -A` / `-a`**：同仓有并发线时，它会把**别人正在写的半成品**一起提交进去。
- `git reset --soft` 之后**必须先 `git reset` 清索引**，否则下一条提交会把整批改动吞进去。
- 提交前确认工作树里**没有残留的注入形态**（变异/自检被打断过 ⇒ `git diff` 逐处看，别只信"脚本说它恢复了"）。
- 提交说明**不许写"已完成"** —— 没做完的写没做完。

### 7.4 标签（tag）怎么打

- 名字 = `vX.Y.Z-<轨道词><流水号>`，**只取轨道段、不带任务号后缀**
  （标签是**检索键**，带上任务号就查不到同类；标题里可以带 `· M9b（B3）`，标签不行）。
- 轨道词**受控**（现扫 `docs/TRACK-PLANS.md`）：回归 / 铺设 / 扩容 / 拓展 / 加固 / 升级 / 优化 / 规整 / 排查 / 接驳。
- 标签打在**主体提交**上；结果数字（门禁真值、CI 号）通常**晚于**主体提交
  ⇒ 另建"回填笔"提交补记，**不要 amend、不要移动已推的标签**。
- 打完用 `git tag --list` **现扫核对**那一行（机器判据只看**工作区里那份** CHANGELOG，标签本身是推出去的 ⇒ **两边都要对**）。
- **绝不改写已推送的标签** —— 写错了开新标签 + 两处同时勘误。

### 7.5 推送：本机的**选择性阻断**与配方

`Failed to connect to github.com:443` 有**两种病因**，别混：

| 病因 | 判别 | 处置 |
|---|---|---|
| 真抖 | 重试能成 | 有界重试（3–4 次、间隔 15–20s），日志写清第几次成功 |
| **选择性阻断**（本机常态） | `api.github.com` / `gitee.com` / `registry.npmjs.org` 的 443 **都通**，而 `github.com:443` 不通 | **换解析** ⇒ **重试再多次也没用** |

**配方**（`-c` 是**一次性**的 ⇒ 不落任何配置文件 ⇒ **不污染仓库与全局设置**）：

```bash
# 1) 看被指到哪只 IP
Resolve-DnsName github.com

# 2) 逐只试（换解析）：通的 IP 会立刻返回
curl.exe -sS -I --connect-timeout 8 --max-time 12 --resolve github.com:443:<IP> https://github.com/

# 3) 让 git 走那只 IP（必须同时覆盖 SSL 后端 —— 本机 Git 只带 schannel）
git -C "<仓库根>" -c http.sslBackend=schannel -c http.curloptResolve=github.com:443:<可用IP> ls-remote origin
git -C "<仓库根>" -c http.sslBackend=schannel -c http.curloptResolve=github.com:443:<可用IP> push origin main
git -C "<仓库根>" -c http.sslBackend=schannel -c http.curloptResolve=github.com:443:<可用IP> push origin refs/tags/vX.Y.Z-<轨道词>N
```

⚠️ **那只 IP 是"当天实测"的结果，不是永久名单 ⇒ 每轮重扫**（"这次通了"不等于"下次也会通"）。
⚠️ **SSH 这条路走不通**：本机 `%USERPROFILE%\.ssh\id_ed25519` **当前用户读不了**
（`icacls` 报"处理失败"）⇒ 归属不明的文件**不动 ACL**（本仓规矩：归属不明不擅自动手）。

### 7.6 推送后的**独立回读**（不许省）

```bash
git -C "<仓库根>" ls-remote origin refs/heads/main refs/tags/vX.Y.Z-<轨道词>N
```

要核对的**四件事**：

1. 远端 `main` 的哈希 == **你预期的那一笔**（不是"看起来对"）；
2. 远端**标签 peel 后**（`^{}`）== **主体提交**的哈希（**不是**回填笔）；
3. **零待推**（`git status -sb` 里没有 ahead）；
4. 有并发线同时推 ⇒ **以远端为准重新取一次**，别拿本地缓存说事。

> "推送命令退出码 0" **不是证据** —— 唯一能证伪"我以为推上去了"的就是这一步。

### 7.7 CI 的取真值（**退出码不算证据**）

本机**没装 `gh` CLI** ⇒ 走 REST：

```bash
# 令牌只在内存里过 —— 只打印 run 号 / 状态 / 结论 / head_sha
printf 'protocol=https\nhost=github.com\n\n' | git credential fill
curl.exe -sS "https://api.github.com/repos/Zhang-jx00/jujia-agent/actions/runs?head_sha=<完整哈希>"
```

**三条实测坑**：

1. **别加 `GCM_INTERACTIVE=never` 或 `GIT_TERMINAL_PROMPT=0`** ——
   helper 会**不返回也不报错**地把任务挂死；
2. 私有仓**匿名 API 返 404**（不是 401）⇒ 别读成"仓库不存在"；本仓已公开 ⇒ 匿名返 **200**；
3. **按 `head_sha` 查不到 run ≠ CI 失败** —— workflow 只跟 `main`/PR，
   随标签推上去的主体提交**根本没有 run** ⇒ 台账写「**未触发**」，
   **不许推断成败、不许拿上一轮的绿顶替**。

- 取真值脚本**一次性**放 `.tmp/`（随清理收走），**不升进 `scripts/`** ——
  **读凭据的工具进仓 = 多一条长期要维护的攻击面**。
- 若会话挂了 GitHub MCP：它的工具面**不含 workflow 状态** ⇒ CI 结论仍以 REST 为准。

### 7.8 **不得干扰其他项目**（硬边界 · 红线）

本机同时有**别的仓库、别的 worktree、别的项目**在跑。**所有 GitHub 动作都限定在"本仓 + 本仓这一笔"。**

| 不许做 | 为什么 |
|---|---|
| **不许改全局 `git config`**（`--global`） | 全局配置影响**这台机器上所有仓库**；本仓的推送配方一律用**一次性 `-c`** |
| **不许改 `C:\Program Files\Git\etc\gitconfig`** | 同上（那里面 `http.sslBackend=openssl` 是全局的 ⇒ 用 `-c http.sslBackend=schannel` **一次性覆盖**，别去改文件） |
| **不许代读 / 代走别处的凭据** | 凭据只在**本仓作用域**内取；仓库外的 `.workbuddy/credentials/` **只读不写、不外传** |
| **不许动 SSH 私钥的 ACL** | 归属不明的文件**不动** |
| **不许 `git credential reject` 清掉别的项目的条目** | GCM 条目按 **host + 作用域**存 ⇒ 清理时**只清本仓这一条**，清之前先确认作用域 |
| **不许在别的仓库目录里跑本仓的脚本** | 本仓脚本会动 `.tmp/` / `.trash/` / `release/` ⇒ **只在仓库根跑** |
| **不许把本仓的推送配方直接用到别的项目** | 那只 IP / SSL 后端是**本机**的现象（不是本仓专属，也不是全局可信）⇒ 用在别处**重新现扫** |
| **不许因为本仓要推就顺手清别人的 worktree / 分支** | 并发线的分支与 worktree 是**别人的在制品** ⇒ 本仓只推**自己那笔** |
| **不许把令牌写进任何文件 / 日志 / 台账 / 提交** | 令牌**只在内存里过**；任何落盘即视为泄露（⇒ 要轮换） |
| **不许动别的项目的 `.gitignore` / 凭据 / 分支保护** | 那些是**别的项目的事** |

### 7.9 并发线在同一棵树上时（当前实况）

- 本仓现在**同时挂着多个 worktree**（`git -C "<仓库根>" worktree list` 现扫）⇒ 各推各的分支。
- **同一棵树上多人改** ⇒ ① 提交**逐个文件精确 add**（禁 `-A`）；② **推 `main` 要串行**
  （谁先推谁先推；后一个**以远端为准**重新取）；③ 台账里写清"这一笔包含了我碰过的哪些文件"。
- **复制 / 搬家来的目录**会丢 `node_modules/@jujia/*` 的 junction ⇒ 第一次 typecheck 必红
  ⇒ 按根交接文档 §4 重建 junction（**不联网、不要管理员**）。

### 7.10 GitHub 侧常见故障与处置

| 现象 | 根因 | 处置 |
|---|---|---|
| `Failed to connect to github.com:443` | 选择性阻断 | §7.5 换解析（**重试无效**） |
| `fatal: Unsupported SSL backend 'openssl'` | 本机 Git 只带 schannel | 追加 `-c http.sslBackend=schannel` |
| 推送命令退出码 0 但远端没有 | 推的不是你以为的 ref | `ls-remote` 回读核对（§7.6） |
| `refusing to update checked out branch` | 目标端有 worktree 检出着该分支 | 先切分支或换 ref |
| 取到的凭据 401 | GCM 里**陈旧条目遮蔽**了 store 里的好令牌（helper 先答先赢） | `git credential reject` 清**本仓那一条**陈旧条目 |
| CI 按 head_sha 查不到 run | workflow 只跟 main/PR | 写"**未触发**"，不推断成败 |
| 标签推上去却指错提交 | 打在回填笔上了 | **不移动已推标签**；开新标签 + 两处勘误 |

## 八、踩过的坑（按主题 · 现象 → 根因 → 防线 → 可迁移教训）

> **全部是实测**，不是道听途说。出处：交接文档 §10 / §11 · `review/REVIEW-LOG.md`（复核 001–139）· `docs/TEST-POLICY.md`。

### 8.1 判据假绿的七种形状（每一条都实测撞过）

| # | 形状 | 后果 |
|---|---|---|
| 1 | needle 被**同一行的运行期文案自引用**喂饱 | 锁看着有覆盖，其实测的是自己 |
| 2 | 判据架在**恒真**的字段/属性上 | 永远绿 |
| 3 | 检查器**自己做归一化**（≠ 真实写法） | 测的不是真代码 |
| 4 | 变异窗口**没包住**被测运行 | 变异没生效却算"被拦住" |
| 5 | 预演断言**吃既有状态**（点之前就已经是那个值） | 空处理器也绿 |
| 6 | 锁读原文**被自己的注释喂饱**（否定式锁会被自己注释打红） | 假红/假绿两向 |
| 7 | **天生红的锁** | 教人无视红灯 ⇒ 护栏自毁 |

**教训**：**恒绿的锁比没锁更坏** —— 它给人覆盖的错觉。**每条新锁都要先证明它能红。**

### 8.2 锚点漂移（改一份文档，拆掉别人的锚点）

- **现象**：一条判据把靶文本钉在某一行的**具体内容**上；有人改了那一行（哪怕改对了）⇒ 注入落不进去 ⇒ 自检**当场红**并明说「请更新本脚本的锚点」。
- **防线**：锚点漂了**会自己叫**（比"没人发现"强得多）；处置是**按当前源码重新对准**（**内容一字不改**）。
- **教训**：**改一份文档的连带面不只在那份文档里** —— 它还可能是**别人的锚点** ⇒ 改完要**按名字**把指向它的地方复查一遍。

### 8.3 手抄数字漂移（"数字只写一处"的由来）

- **现象**：能力总表 `docs/CHECKLIST.md` 停在 R12、**漂了十二轮**；生成物 `docs/DEPENDENCY-LICENSES.md` 里的本仓包版本停在 `@jujia/desktop@1.23.0`（真实 1.29.0）⇒ **没有任何门禁会红**。
- **根因**：这些数字**没人守** ⇒ 人抄的那份静默漂。
- **防线**：**当前态只留一处**（有机器判据盯的那一处），其余位置写指针；生成物**由生成器产出 + 逐字对账**；
  **承诺了维护却没维护的索引文件比没有索引更危险** ⇒ 要么兑现，要么**改掉承诺**。
- **教训**：**"漂"和"漏"要分开查** —— 内容在 CHANGELOG / PROGRESS / REVIEW-LOG 里都在 ⇒ 是**索引没跟上**，不是没做。

### 8.4 门禁被杀掉 ≠ 门禁跑完了

- **现象**：跑全量变异时进程被中止 ⇒ 负责把原文写回的 `finally` **没跑到** ⇒ **工作树里留下一处注入形态** ⇒ 直接提交就会把坏代码带进仓。
- **防线**：脚本留「正在跑」的标记；自检自己查"**被注入的每个文件逐字节回到原文**"＋"**HEAD 必须没变**"；提交前**逐个核对靶子文件**（别只信"脚本说它恢复了"）。
- **教训**：**中止不是完成** —— 同理，`process.exit()` 不跑 `finally`（三处脚本因此各留过一次残留）。

### 8.5 并行跑门禁 ⇒ 假红

- **现象**：同一台机器上并行跑两个 GUI 自动化 ⇒ 互相干扰 ⇒ 出现**无法解释的红**（同一份代码单独再跑一次就全绿）。
- **防线**：**机器独占的门禁串行**（e2e / 拍图 / 打包 / 变异 / 注入自检）；本机用一把 `.machine-lock` 目录锁（`mkdir` 原子）排队。
- **教训**：**一次红一次绿不下结论**，但**取证要常驻在门禁里**；也别拿并发当唯一解释、也别拿它当挡箭牌。

### 8.6 打包死法三连（同一条因果被改口三次）

| 曾经的结论 | 被什么推翻 |
|---|---|
| "换目录就绕开了锁" | **全新空目录第一次打照样 EPERM** |
| "锁是短暂的，带等待的重试才是药" | 残骸 **32 分钟后仍 EBUSY**；重试先 `unlink` 上一回残骸 ⇒ **第二次根本没走到 rename**；残骸清掉后转成联网重取超时（单次烧 **199 秒**），真因被盖住 |
| "位置才是变量" | 在**之内**也绿过一次 ⇒ 位置只是**相关** |

- **现在的口径**：这是**竞态窗口**；脚本不原地盲等，失败当下用 `lockProbe` 试一次"给那只 asar 改名"，把"句柄此刻还在不在"打进日志。
- **操作口径**：红了就**重跑一次**（用全新目录）；连红两把就判"这台机器此刻验不了打包产物"，
  台账记「**未能运行 + 原因**」—— **既不记成绿，也不写成产品缺陷**。

### 8.7 中文、编码与换行

| 坑 | 处置 |
|---|---|
| 路径含中文 ⇒ electron-builder / Node 的错误文本乱码（`俱佳agent` → `¾ã¼Ñagent`）⇒ **误导排查** | 判据与文案用相对说法；**本机绝对路径不进代码与配置**；**用户主目录不进活文档** |
| Windows 上以文本模式写文件 ⇒ **整份文件转成 CRLF**，而 `git diff --numstat` **完全看不出来** | 脚本写文件按**字节**核行尾；显式声明编码与换行 |
| PowerShell 双引号 here-string 把反引号当转义 ⇒ 表格行被切断 | 含反引号 / `${}` 的内容**用编辑工具写** |
| `Get-Content -Raw \| Set-Content` 按代码页解码再按 UTF-8 编码 ⇒ **中文变乱码、引号被吃掉** ⇒ 整份源码报废 | 只用编辑工具；或 `node` 脚本按 `utf8` 读写 |
| Python 3.8 上用了 3.9+ 的 API ⇒ `AttributeError` | 只用 3.8 可用 API |
| 表格里写换行 = 结构破坏 | 多行大表改完用"合并回单行 + 断言"的脚本处理，别手工敲 |

### 8.8 树摇：没人用的常量等于没有（R70 新发现）

- **现象**：第三方素材的版权声明（Lucide · ISC）是一个**导出常量**，全仓**只有测试文件引用它**
  ⇒ 打包器当**死代码树摇**掉 ⇒ 实测构建产物对那段文字 **0 命中** ⇒ **分发副本里一个字都没有**
  ⇒ 而 ISC 明文要求「**随副本保留**版权声明」。
- **根因**：**没人用的声明等于没有声明** —— 声明进了仓库，不等于进了产品。
- **防线**：声明**必须被界面真正用上**（概览页那张卡）⇒ 它一进渲染层就必然在分发副本里；
  并立 `check:notices` 门禁六条（发现 / 真正用上 / 文档逐字 / **构建产物查得到** / 产物不比源码旧 / 生成物不许漂）。
- **教训**：**"写在源码里"与"随副本保留"是两件事**；判据要测**分发副本**，不是测源码。

### 8.9 环境类

| 坑 | 处置 |
|---|---|
| **`github.com:443` 选择性阻断**（同机 `api.github.com` / npm registry 都通） | 换解析 + `http.sslBackend=schannel`（本机 Git 只带 schannel）；**每轮重扫 IP**，重试无效 |
| **GUI 自动化弹窗到用户桌面** | e2e / 拍图必须带无头开关；**不许抢焦点** |
| **归属不明的进程握��句柄** | **照旧不杀**；换输出目录 + 重试；连红两把就如实记"未能运行" |
| **机器时钟会跳** | 台账里的"时刻"是**同一侧时钟的相对量**；**日期标签跟着 git 的日期写**，别按"今天几号"倒推 |
| **`cleanup.py` 会吃掉自己的证据** | `.evidence` 进跳过名单；空文件只在临时区算垃圾；区外只报不动 |

### 8.10 还没被机器兜住的（据实登记，不假装覆盖）

- **散文层的表述合规**（T85 的尾巴）⇒ 由人工扫负责，**刻意不加散文判据**。
- **界面手感**（画布拖拽连线、右键命令面板、终端连续打字换行）⇒ 无机器判据 ⇒ 肉眼看过就算，**不写进"已验证"**。
- **真实第三方 MCP 服务端**、**模型是否愿意调用外部工具**、**打包版内置终端能否起得来** ⇒ 自动化只能证一半，另一半是人工项。
- **perf 的规范采样**（空闲 + 连续 ≥3 次 + 报分布）⇒ 等所有者发话，**不得用非规范采样充数**。

---

## 九、当前进度

> **不在本文件复述会变的数字**。当前态真值：
> **版本 / 标签 / 门禁真值 / 队列计数** ⇒ 根 [`俱佳Agent交接文档.md`](../俱佳Agent交接文档.md) §2；
> **规模（测试文件数 / e2e 步数 / 渲染层组件测试数）** ⇒ [`docs/PROGRESS.md`](PROGRESS.md)「**当前规模**」行；
> **能力面** ⇒ [`docs/CHECKLIST.md`](CHECKLIST.md)；
> **逐轮做了什么** ⇒ [`CHANGELOG.md`](../CHANGELOG.md) 顶部 + `docs/CHANGELOG-ARCHIVE.md`。

### 9.1 三条可现扫的进度

```bash
git -C "D:\Github项目\jujia-agent\俱佳agent" log --oneline -5      # 逐轮
git -C "D:\Github项目\jujia-agent\俱佳agent" describe --tags --abbrev=0
git -C "D:\Github项目\jujia-agent\俱佳agent" status --short        # 工作树是否干净
```

### 9.2 队列：能自裁的都做完了

- 队列里的项**不是"没人知道下一步"**，而是**分三类**：**等一句拍板**（发版 / 终端进判定）·
  **等一次现场**（e2e 偶发红那一族）· **能力开发等一个明确题面**。
- **具体是哪几条、为什么没定论、正确的下一步** ⇒ 根交接文档 §9（逐条：现象 / 证据 / 为什么没定论 / 下一步）。
- **计数以机器口径为准** ⇒ 有判据现扫 ROADMAP 的四张表并与交接文档 §2 逐字对账。

### 9.3 明确不做（别重复问）

命令级 `allow`（停牌①永久不开）· CodeMirror（M19 已评估暂不引入）· 远程接入 / 云 worker / 调度（表述已解、**能力未开工**）·
自动下载 / 自动安装 / 后台轮询 · `run_command` 转后台（T42 裁定不做）。

---

## 十、接手后从哪里开始

### 10.1 第一天（把环境与现状摸清）

```bash
# 0) 基线：别凭记忆，先现扫
git -C "D:\Github项目\jujia-agent\俱佳agent" log --oneline -5
git -C "D:\Github项目\jujia-agent\俱佳agent" status --short
git -C "D:\Github项目\jujia-agent\俱佳agent" describe --tags --abbrev=0

# 1) 装依赖（node >= 22）；**不要**改依赖版本
npm ci

# 2) 快档门禁全绿（顺序别乱）
npm run typecheck && npm run lint && npm run test
npm run check:docs && npm run check:docs:selftest
npm run e2e          # 界面级；**必须离屏**，不许弹窗到桌面
```

**看一眼产品**：`npm run app`（真启动 Electron；**它会弹窗到桌面** ⇒ 先确认用户不介意）或
`npm run screenshots`（离屏拍四张对外图 + 清单）。

> ⚠️ **如果目录是复制 / 搬家得来的**（不是 `git clone`）：`npm run typecheck` 会红在
> `Cannot find module '@jujia/shared-ipc'` —— **不是仓库坏了，是 workspace 链接没跟过来**
> ⇒ 重建 `node_modules/@jujia/` 下的 5 只 junction（命令见根交接文档 §4）。

### 10.2 第一周（认全 + 改一轮）

| 天 | 做什么 | 验收 |
|---|---|---|
| 1 | 跑起来 + 读 §一、§二、§四 | 能说清"这个产品的边界在哪" |
| 2 | 读 [`docs/WORK-PROTOCOL.md`](WORK-PROTOCOL.md) 32 条 + 本文件 §六 | 能说清"这里的人怎么做事" |
| 3 | 读 §八（坑）+ 根交接文档 §10 / §11 | 能说清"哪些地方会骗我" |
| 4 | 读一遍 §4.3 的**十条链路**，挑一条跟到底（建议 A 发消息 / B 调工具被拦） | 能画出"改这个功能要动哪几个文件" |
| 5 | 挑一条**小题面**做完一轮（走完 §6.1 的 10 步） | 一次独立提交 + 标签 + 推送 + 回读 |

> **第一轮别碰**：安全语义 · 权限映射 · 依赖版本 · 打包配置 · 对外文案。

### 10.3 常见任务速查表

| 我要改… | 落点 | 必须配的判据 | 必跑的门禁 | 台账要写 |
|---|---|---|---|---|
| 渲染层界面 | `apps/desktop/src/renderer/src/features/**` + `styles.css` | 渲染层组件测试（jsdom）+ **e2e 渲染断言** | 快档全档 + **重拍展示图** | CHANGELOG · PROGRESS §一 · DESIGN-BASELINE 小节 |
| 主进程服务 | `apps/desktop/src/main/*.ts` | `*-wiring.test.ts` 接线锁 | 快档 | CHANGELOG · PROGRESS |
| 权限判定 | `packages/agent-core/src/permissions/` | **双向断言**（放行与拒绝都要测） | 快档 + 慢档 | CHANGELOG + **停牌记录** |
| IPC 契约 | `packages/shared-ipc/src/**` | 契约测试 + preload 出参再校验 | 快档 | CHANGELOG |
| 内核纯逻辑 | `packages/agent-core/src/**` | 单测（**零 Electron 依赖**要保住） | 快档 | CHANGELOG |
| 门禁 / 判据 | `scripts/check-*.mjs` + 对应 `verify-*.mjs` | **自检里加一处注入用例，并当场看它红** | 该自检 + `check:docs` | CHANGELOG · REVIEW-LOG |
| 新增第三方素材 | 源码模块 + `THIRD_PARTY_NOTICES.md` | `check:notices` 会自动接管 | 慢档（构建产物那条） | CHANGELOG · THIRD_PARTY_NOTICES |
| 文档 | `docs/**` | `check:docs` + 注入自检 | 快档 | CHANGELOG |

### 10.4 第一小时清单

根交接文档 §14 有一份**可照着敲的清单**（拿到项目后的"第一小时"）—— 先做那一份，再回到这里读全景。

---

## 十一、这台机器上的环境坑（速查）

| 坑 | 处置 |
|---|---|
| `github.com:443` 选择性阻断 | `git -c http.sslBackend=schannel -c http.curloptResolve=github.com:443:<可用IP> push`（**IP 每轮重扫**） |
| 打包 rename EPERM / asar EBUSY | 换**按运行 id 命名的新输出目录** + 有界重试；连红两把 ⇒ 如实记"未能运行" |
| 中文路径在错误文本里变乱码 | 用相对说法；绝对路径不进代码与配置 |
| 文本模式写文件 ⇒ 整份转 CRLF（diff 看不出来） | 按字节核行尾 |
| PowerShell 管道会吃掉退出码 | **一切以退出码为准**；输出重定向到文件再读 |
| Python 只有 3.8 | 只用 3.8 API |
| 机器时钟会跳 | 日期标签**跟着 git 的日期**写 |
| 并行跑 GUI 自动化 ⇒ 假红 | **机器独占门禁串行**（`.machine-lock`） |
| e2e / 拍图不许打扰桌面 | 必须带无头开关；**不许抢焦点** |
| 归属不明的进程 | **照旧不杀** |
| `cleanup.py` 会吃自己的证据 | `.evidence` 在跳过名单里 |

---

## 十二、文档索引（谁回答什么）

| 问题 | 去哪 |
|---|---|
| 产品是什么 / 边界 / 怎么装 | [`README.md`](../README.md) · [`SECURITY.md`](../SECURITY.md) |
| **第一次接手** | 本文件 + 根 [`俱佳Agent交接文档.md`](../俱佳Agent交接文档.md) §14 |
| **怎么做事**（纪律原文） | [`docs/WORK-PROTOCOL.md`](WORK-PROTOCOL.md) |
| 界面怎么设计 | [`docs/DESIGN-BASELINE.md`](DESIGN-BASELINE.md) |
| 测试怎么写 / 临时文件落哪 | [`docs/TEST-POLICY.md`](TEST-POLICY.md) |
| 能力总表 | [`docs/CHECKLIST.md`](CHECKLIST.md) |
| 排期 / 队列 / 每轮题面 | [`docs/TRACK-ROADMAP.md`](TRACK-ROADMAP.md) · [`docs/TRACK-PLANS.md`](TRACK-PLANS.md) |
| 做了什么 / 还差什么 | [`docs/PROGRESS.md`](PROGRESS.md) · [`CHANGELOG.md`](../CHANGELOG.md) · `docs/CHANGELOG-ARCHIVE.md` |
| 每轮复核记录（含未通过项） | [`review/REVIEW-LOG.md`](../review/REVIEW-LOG.md) · [`review/mutations.json`](../review/mutations.json) |
| 发布 / 切公开的检查单 | [`docs/RELEASE-PREP.md`](RELEASE-PREP.md) |
| 决策留痕（自主授权 / 远程 / 媒体生成） | [`docs/DECISION-SELF-DIRECTED.md`](DECISION-SELF-DIRECTED.md) · [`docs/DECISION-REMOTE.md`](DECISION-REMOTE.md) · [`docs/DECISION-M11-MEDIA-GEN.md`](DECISION-M11-MEDIA-GEN.md) |
| 技能 / 钩子 / 插件 怎么写 | [`docs/SKILLS.md`](SKILLS.md) · [`docs/HOOKS.md`](HOOKS.md) · [`docs/PLUGINS.md`](PLUGINS.md) |
| 设计报备稿（M9/M11/M14/M17/M19/M20–M22/T22/T31/T55…） | `docs/DESIGN-*.md` |
| 第三方依赖与许可 | [`docs/DEPENDENCY-LICENSES.md`](DEPENDENCY-LICENSES.md) · [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) |
| 知识卡片（领域 / 流程 / 决策） | `knowledge/`（`cards` / `modules` / `flows` / `decisions`） |

---

## 附录 A · 一页速查

```bash
# 目录
REPO=D:\Github项目\jujia-agent\俱佳agent        # 仓库根（git 根）
WS=D:\Github项目\jujia-agent                    # 工作区根（.tmp 在这）

# 快档（每次提交前）
npm --prefix "$REPO" run typecheck
npm --prefix "$REPO" run lint
npm --prefix "$REPO" run test
npm --prefix "$REPO" run check:docs
npm --prefix "$REPO" run check:docs:selftest
npm --prefix "$REPO" run e2e

# 慢档（阶段收尾 / 发版前）
npm --prefix "$REPO" run smoke
npm --prefix "$REPO" run perf
npm --prefix "$REPO" run verify:pack
npm --prefix "$REPO" run mut

# 其它
npm --prefix "$REPO" run check:notices        # 第三方素材与许可声明
npm --prefix "$REPO" run license:check        # 依赖许可（会重生成 docs/DEPENDENCY-LICENSES.md）
npm --prefix "$REPO" run screenshots           # 离屏重拍四张对外图
python "$REPO/scripts/cleanup.py" --apply     # 收尾清理（入 .trash，保留 30 天）

# 关键路径
apps/desktop/src/main            主进程（服务 / ipc / 判档）
apps/desktop/src/preload          安全桥（一方法一通道）
apps/desktop/src/renderer/src     渲染层（features / ui / nav.ts）
packages/agent-core/src          内核纯逻辑（零 Electron 依赖）
packages/shared-ipc/src/channels.ts   通道清单的权威
packages/ui-tokens/src           设计令牌
docs/                             治理层（WORK-PROTOCOL / TEST-POLICY / DESIGN-BASELINE …）
review/REVIEW-LOG.md             复核台账（逐轮靶子与教训）
review/mutations.json             变异清单（每条都要当场证红）
.trash/                           回收站（30 天可反悔）
```

> **三条最容易被违反、且违反代价最大的纪律**：
> ① **一切命令以退出码为准，禁接管道**；
> ② **每条新判据先证明它能红**；
> ③ **会变的数字不写死，让它现算现出**。
