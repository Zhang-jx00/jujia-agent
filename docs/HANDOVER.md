# 项目交接文档（HANDOVER）

- **交接对象**：QoderCN（项目后续开发与维护方）
- **交接日期**：2026-09-23（同日三遍复查修订）
- **代码基线**：`ea56929`（标签 `v0.28.0-规整7`；本文档自身随该版本提交）
- **阅读顺序建议**：先读本文档 → 再读 `docs/PRODUCT-GOAL.md`（定位）→ `docs/TRACK-ROADMAP.md`（排期与编号）→ `docs/PROGRESS.md`（状态权威）。
- **一句话提醒**：**`docs/PROGRESS.md` 是完成状态的唯一权威**；若本文档与 PROGRESS 冲突，**以 PROGRESS 为准**。

---

## 1. 项目概述

### 1.1 项目是什么

**俱佳Agent（JujiaAgent）**：跑在用户自己 Windows 机器上的个人 Agent ——
**能读文件 / 改代码；命令执行只走用户手驱动的内置终端与逐个批准的 MCP 工具
（模型可以自主提出执行命令，但**每一次都要用户点头**）；每个有副作用的动作都必须用户点头，数据默认不出本机**。

三条不可妥协的定位（详见 `docs/PRODUCT-GOAL.md`）：

- **本地单机优先**：不做云端账号体系、不做商业化；本地单机、无服务器中转。
- **权限判定用确定性规则**，不交给模型判断（`deny/ask` 规则绝对生效，连"全部放行"模式也让路）。
- **密钥不进渲染层、也不进模型上下文**（Key 只在主进程用于认证头）。

工程底线（对外开源项目）：LICENSE / SECURITY.md / CONTRIBUTING.md 齐备、
**不得依赖本机特殊状态**（环境变量/代理/中文路径才能跑）、**未验证的平台如实标注**（当前仅验证 Windows）。

### 1.2 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 桌面壳 | **Electron**（main / preload / renderer 三进程） | 安全基线：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false` |
| UI | **React 19 + Vite**（自研组件，**未用** Fluent UI / zustand / xyflow —— PLAN 选型表里曾写过，实际未引入，见注意事项 §5.7） | 工具卡 L0–L2（一行 → 卡片 → 抽屉）、rAF 合批、气泡窗口化（常驻 ≤120） |
| 引擎 | **`@jujia/agent-core`**（纯 TS，不依赖 Electron） | provider/SSE、工具执行、权限门、钩子、技能、插件、记忆装配、MCP 客户端 |
| 契约 | **`@jujia/shared-ipc`**（zod schema + 通道常量） | **全部 IPC 通道**（清单与数量以 `src/channels.ts` 为准 —— 文档刻意不写数字，避免再漂移）；入参/出参全部过 zod；**刻意不依赖 agent-core**（分包边界） |
| 存储 | **`@jujia/shared` 的 `json-store`** | 原子写（tmp + fsync + rename + `.bak` + version 信封 + 损坏自愈） |
| 终端 | **node-pty + xterm** | node-pty 是 **N-API 模块（ABI 稳定，预编译二进制跨 Node/Electron 通用）→ 不需要 electron-rebuild**（打包配置 `build.npmRebuild: false`；本机 VS Build Tools 缺 Spectre 缓解库，从源码编译会报 MSB8040） |
| 测试 | **vitest**（单元/集成）+ **Playwright 驱动真 Electron**（e2e） | `maxWorkers: 4`（本机满并发会出现"加载超时假红灯"） |
| 打包 | **electron-builder** | `npm run dist`（内含 build）；产物在 `apps/desktop/release/` |
| 脚本 | Python 3.13（`scripts/cleanup.py`、`gen_matrix.py` 等） | 收尾清理、知识库统计 |
| 运行时 | **Node 22（managed）** · Python 3.13（managed） | 版本与路径约定见仓库根的运行时说明；**不要全局 `npm install -g`**，包装进 workspace |

### 1.3 目录结构（只列需要知道的）

```
俱佳agent/
├─ apps/desktop/                 Electron 桌面端
│  ├─ src/main/                  主进程：index.ts（窗口+安全基线）、ipc.ts（全部通道的统一入口）、
│  │                             chat-service.ts、terminal-service.ts、mcp/、permission-bridge.ts、
│  │                             security.ts（发送方校验）、config-write.ts（配置白名单纯函数）、
│  │                             session-lru.ts（会话淘汰）、secret.ts、paths.ts、connections-store.ts
│  ├─ src/preload/               contextBridge 白名单暴露
│  ├─ src/renderer/              React 界面（features/{chat,permissions,hooks,plugins,mcp,appearance,...}）
│  ├─ scripts/e2e-ui.mjs         界面级端到端（真 Electron，步数以脚本为准，数据隔离到临时目录）
│  └─ scripts/run-electron.mjs   Electron 启动器（必须经它启动，见 §5.2）
├─ packages/
│  ├─ shared/                    json-store 原子存储（基础设施）
│  ├─ agent-core/                引擎：providers/ loop/ tools/（含 path-guard） permissions/ hooks/
│  │                             skills/ plugins/ memory/ git/ mcp/ terminal/ browser/（新，见 §3.3）
│  ├─ shared-ipc/                zod 契约 + IPC 通道常量（contracts.ts / channels.ts）
│  └─ ui-tokens/                 外观系统：主题包（受控字段白名单，拒绝任意 CSS/JS）
├─ scripts/                      check-docs.mjs（文档一致性检查，**项数以自身输出为准**）、verify-docs-check.mjs（检查器自检）、
│                                mutation-check.mjs（变异测试）、cleanup.py、license 相关、gen_matrix.py
├─ docs/                         PRODUCT-GOAL / PLAN / PROGRESS / TRACK-PLANS / TRACK-ROADMAP /
│                                COVERAGE-MATRIX / HOOKS / SKILLS / PLUGINS / TEST-POLICY /
│                                PERF-BUDGET / SETUP-TERMINAL / ARCH-CLOUD-IDE / LEARNING-MAP /
│                                UX-AUDIT / DEPENDENCY-LICENSES / CHANGELOG-ARCHIVE / HANDOVER(本文)
│                                DESIGN-SESSIONS(6a 报备，已批已交付) / DESIGN-COMPACT(6b 报备，已批已交付) / DESIGN-T22-TAB-STATE(T22 报备，待批)
├─ review/                       REVIEW-LOG.md（复核台账）、TRACK-SWEEP-1.md（全项目排查报告）、
│                                REVIEW-LOG-ARCHIVE.md、mutations.json（变异定义）、EVALUATION 已删
├─ knowledge/                    统一知识库（README.md 是四层体系导航：地图→来源→矩阵→发现→报告→卡片）
├─ assets/                       应用图标（DESIGN-NOTES.md）
└─ .workbuddy/                   工作数据（记忆/凭据已迁至此，**不属于交付物**）
```

### 1.4 核心模块与数据流（必须先懂的三条链路）

1. **对话链路**：renderer `ChatPanel` → `window.jujia.chatSend`（preload 白名单）→ `ipc.ts` 统一入口
   （**先做发送方 URL 校验**）→ `chat-service.ts` → `agent-core` Agent Loop → provider SSE 流 →
   `StreamEvent` 经 `emitStream` 推回渲染层（rAF 合批渲染）。
2. **工具链路**：Loop 产出 tool_calls → `runTool`（agent-core）→ **权限门**（模式 + 规则表 + 敏感路径 +
   高危清单 → 硬/软 ask 两级）→ 需要时经 `PermissionBridge` 弹窗问用户 → 执行 → 结果回模型。
3. **MCP 链路**：用户在 MCP 页添加服务端 → 连接需**同意** → 工具进入**同一个注册表** →
   逐工具批准后可用 → 断开即摘除工具；退出时 `disposeAll()` 杀全部子进程。

---

## 2. 已完成部分（逐项：功能 / 代码位置 / 思路 / 测试）

> 状态口径：**`docs/PROGRESS.md` 为唯一权威**。下表"测试"列指当前可复跑的验证。

### 2.1 桌面壳与安全基线（M1）✅

| 项 | 位置 | 思路 |
|----|------|------|
| 窗口与生命周期 | `apps/desktop/src/main/index.ts` | `closed` 时调用 `permissionBridge.cancelAll('窗口已关闭')`（兑现"挂起审批立即收尾"承诺）；`before-quit` 清理 MCP/终端子进程 |
| **IPC 发送方校验** | `apps/desktop/src/main/security.ts`（`isTrustedSenderUrl`）+ `ipc.ts` 统一入口 | **全部通道共用一个入口**（清单以 `shared-ipc/src/channels.ts` 为准），入口先校验发送方是应用自己的渲染层（fail-closed）。**新通道默认受保护** |
| 渲染层隔离 | preload 白名单暴露 `window.jujia.*` | 渲染层**零** `node:` 依赖（有检查）；能力全部走 IPC |

测试：`security.test.ts`（URL 判定）、`ipc-wiring.test.ts`（接线锁：统一入口、白名单调用、cancelAll 位置）、e2e 步骤 4/5。

### 2.2 连接与模型适配（M2）✅

- 位置：`apps/desktop/src/main/connections-store.ts` + `packages/agent-core/src/providers/`。
- 思路：多 Connection（OpenAI 兼容端点 + 自定义 baseUrl）；「测试连接」真调 `listModels`（20s 超时）；
  **API Key 走 `secret.ts`（Electron safeStorage 优先，不可用退化为明文并如实标注）**，不进渲染层、不进模型上下文。
- 测试：连接 CRUD 与测试链路的单元测试；e2e 步骤 2。

### 2.3 聊天与流式 UI（M3）✅

- 位置：`apps/desktop/src/renderer/src/features/chat/ChatPanel.tsx` 等。
- 思路：流式 delta **先入缓冲、`requestAnimationFrame` 每帧刷一次**；气泡常驻 ≤120（超出给「显示更早的」按钮）；
  重页签（对话/终端/外观/连接）`React.lazy` 懒加载。
- 测试：`docs/PERF-BUDGET.md`（**采样铁律：空闲状态连续 ≥3 次，单次不可比**）；`npm run perf` 预算判定（首帧 <1000ms）。

### 2.4 工具执行与权限门（M4）🔶 权限门已落地，**内置工具面仍窄** —— 本项目的心脏，改动需最谨慎

| 项 | 位置 | 思路 |
|----|------|------|
| **内置工具清单（实际）** | `packages/agent-core/src/tools/registry.ts` 的 `createDefaultRegistry()` | **四个**：`read_file` / `write_file` / `list_dir` + **`run_command`（`v0.33.0-铺设8` 接上）**，外加技能的 `load_skill`、Loop 的 `handoff`、逐个批准的 MCP 工具。`run_command` 声明为执行类 → **每次硬 ask**（"总是允许"压不掉）、工作目录必须在工作区内、子进程环境剔除密钥类变量、默认 30 秒超时、输出超限如实标注、stdin 立即关闭（不支持交互式命令）。因此"能跑命令"的准确含义是：**模型可自主提出、但每一条都要用户逐次确认**；另有用户自己驱动的内置终端与批准过的 MCP 工具 |
| 路径沙箱 | `packages/agent-core/src/tools/path-guard.ts` | **不做字符串前缀匹配**（Windows 短名/大小写/符号链接都会绕）；按真实路径解析判定 |
| 权限门 | `packages/agent-core/src/permissions/policy.ts` | 5 种模式（default/acceptEdits/plan/dontAsk/bypassPermissions）；**硬 ask vs 软 ask 两级**：执行类命令/敏感路径/用户自写 ask 规则/高危清单 = **硬 ask**（「总是允许」压不掉），普通写文件 = 软 ask（可被会话白名单压掉） |
| 高危清单 | 配置 `alwaysAskTools`（引擎级兜底） | 来自配置文件，**不经渲染层写入** |
| 规则表 | `apps/desktop/src/main/permission-rules-store.ts` + 渲染层权限页 | allow/deny/ask，**按工具名 glob**；**按参数 glob 刻意未做**（理由在 CHANGELOG v0.14.0，勿"顺手补上"） |
| 审批桥 | `apps/desktop/src/main/permission-bridge.ts` | 挂起请求有界（120s 超时）；窗口关闭 `cancelAll` 立即收尾 |
| 审批决策 | `edit`（允许但先改参数再执行） | 渲染层可编辑参数后放行 |

测试：`executor-hard-ask.test.ts`（11 例）、`policy.test.ts`、`policy-consistency.test.ts`（**跨包一致性锁**：`agent-core` 的 `PERMISSION_MODES` 与 `shared-ipc` 的 zod 枚举必须完全一致）、变异 10/10 被拦（见 `review/REVIEW-LOG.md` 复核 019）。

### 2.5 Agent Loop 与钩子（M5）✅

- Loop：`packages/agent-core/src/loop/agent-loop.ts` —— 三分支（最终答复 / 继续调工具 / 移交）+ `maxTurns` 熔断 + 工具错误回模型可恢复。
  ⚠️ **第三分支"移交"在应用层没有被区别处置**：`chat-service.ts` 把 `branch === 'handoff'` 与正常结束都赋成 `'stop'`
  （三元表达式两个分支字面相同），界面因此拿不到区分。Loop 层语义正确且有测试；**要让用户看见"移交"，
  需让 `done` 事件带上 `reason`** —— 已记入 `docs/PROGRESS.md` §2.3，不要以为"三分支"等于界面有三种结果。
- 钩子：`packages/agent-core/src/hooks/`（**七类事件**：SessionStart / UserPromptSubmit / PreToolUse / PermissionRequest / PostToolUse / PostToolUseFailure / Stop）。
  进程型 runner；**默认关闭**、可拒绝、有超时与输出上限；`PermissionRequest` 钩子在硬 ask 时照常运行。
- 测试：`runner.test.ts`（21 例）、e2e 步骤 12（七类齐全且默认关闭）。

### 2.6 记忆与上下文（M6）🔶 部分

- 已做：工作区 `AGENTS.md` 项目指令 + `.jujia/NOTES.md` 长期记忆的**读取与装配**（`packages/agent-core/src/memory/memory.ts`）。
- **未接线**：`projectContextHints`（`appendNote` 已于 `v0.37.0-铺设10` 接通）。
- 会话历史**仅内存**（重启即丢，**这是刻意的、README 已如实标注**）；`chat-service.ts` 有 **LRU 上限 20**（`session-lru.ts` 纯函数 + 7 例测试）。

### 2.7 扩展生态（M7）🔶 大部分完成

| 项 | 位置 | 思路 |
|----|------|------|
| MCP Host | `apps/desktop/src/main/mcp/mcp-service.ts` + `real-transport.ts` | stdio 传输；连接需同意；**逐工具批准**；断开摘工具；插件声明的服务端同样走审批（插件不能自带权限） |
| 技能 | `apps/desktop/src/main/skills.ts` + `agent-core/src/skills/` | `SKILL.md` 渐进披露 + **前缀稳定** + 有界；来源优先级：用户级 → 用户插件 → 工作区 → 工作区插件；每次对话前重扫（新技能即时生效）；`load_skill` 是只读工具，过权限门 |
| 插件 | `apps/desktop/src/main/plugins.ts` | 一个清单打包 技能/命令/MCP 服务端/选项；贡献物经同一套批准流程 |
| 定时任务 | **未开始**（RRULE + 补跑，见 §3.4） | |

测试：MCP 真子进程端到端（`mcp-e2e.test.ts`）、e2e 步骤 7/8/13。

### 2.8 终端与 Git（M8）🔶 部分

- 终端：`apps/desktop/src/main/terminal-service.ts`（node-pty + xterm；**每次启动需审批**；只能开在当前工作区内；子进程环境**剔除敏感变量**（`API_KEY`/`*_TOKEN` 等）并对代理变量脱掉内嵌凭据）。
- Git：`packages/agent-core/src/git/git.ts`（334 行 + 测试齐全）—— status / diffStat / diffSummary / recentCommits / stage / unstage / commit 全部实现。
  **`v0.32.0-铺设9` 已接线**：6 条 `GIT_*` 通道 + `git-service.ts` + 渲染层 Git 页签，运行期用户可达（e2e 第 17/18 步在真实仓库上验证）。
  判档集中在 `apps/desktop/src/main/git-gate.ts`（唯一判档处）：**只读不问 / 暂存软 ask / 提交硬 ask**，
  与所有者给定的口径一致；`plan`/`dontAsk` 拒写、用户自写 `git_*` allow/deny/ask 规则、`bypassPermissions` 全部照常生效（复用同一个 `decideGate`，没有第二套权限语义）。
  **仍未做**：`push`（将来必须硬 ask 且不可被"总是允许"压掉）· 分支切换 · stash · 冲突解决 · 逐行 diff 视图（界面只有摘要 + 关键行摘录）。

### 2.9 外观系统（M23）✅

- 位置：`packages/ui-tokens/src/theme-pack.ts` + 渲染层 AppearancePanel。
- 思路：样式包**只允许受控字段**（枚举白名单 + 数值范围 + 图片路径白名单），**拒绝任意 CSS/JS 与 `data:`/`javascript:`/`file:`** —— 防把注入面写进配置。
- 测试：theme-pack 校验测试；e2e 步骤 3。

### 2.10 基础设施（M12）🔶 部分

- `packages/shared/src/json-store.ts`：原子写 + `.bak` + version 信封 + **损坏自愈**（有并发写测试，放宽了超时）。
- 配置：`config-store.ts` + **白名单写入**（`config-write.ts` 纯函数：白名单外字段**显式报错**，绝不静默丢弃；`permissionMode` 可写、`workspace` 只能由主进程目录选择器写）。
- **日志与自动更新未做**。

### 2.11 内置浏览器（M10）🔶 **主链路已通**（打开 / 导航 / 读正文 / 安全四条都可用），收尾项 = 三档打开方式与文档查看

- **策略层** `packages/agent-core/src/browser/policy.ts`：`decideNavigation` / `decideWindowOpen` /
  `normalizeInputUrl` / `isLoopbackHost`，本步又加了 `decideUserNavigation` 与
  `decideProgrammaticNavigation`（用例数以测试文件为准）。**新逻辑也放这一层**，不放服务层 ——
  纯函数才单测得动、才做得了变异。
- **服务层** `apps/desktop/src/main/browser-service.ts`：`WebContentsView` 挂到主窗口。
  **视图配置刻意不带 preload**（第三方网页绝不能拿到 `window.jujia` 这套能力）；
  为此单独写了 `assertBrowserViewPreferences`，它**反过来要求"必须没有 preload"** ——
  没有复用主窗口那个断言，避免为了共用而把主窗口的检查改松。
- **两条导航路径是分开的**：用户主动 → `decideUserNavigation`（只过协议白名单）；
  页面自己跳（重定向 / meta refresh / 脚本改 location）→ `decideProgrammaticNavigation`，
  除协议白名单外**还不许跳出用户所打开的那个 origin**。
  为什么：`decideNavigation` 只知道"这是不是合法网址"，不知道用户本意要看哪儿；
  放任页面乱跳等于把用户的授权发给整个网络（含跳去 `127.0.0.1:随机端口` 打本机服务）。
- **IPC**：`BROWSER_OPEN_WITH / BACK / FORWARD / RELOAD / CLOSE / GET_TEXT / SET_BOUNDS / STATE`
  ＋ `BROWSER_EXE_PICK / GET / SET` ＋ `BROWSER_STATE_CHANGED`，入参出参全过 zod，且全部经统一入口（默认受发送方校验保护）。
  原先的 `BROWSER_OPEN` / `BROWSER_NAVIGATE` 已并入 `BROWSER_OPEN_WITH` —— "打开一个网址"只剩一个入口，
  免得界面绕不绕得开权限门取决于调哪一条通道。
- **界面**：`features/browser/BrowserPanel.tsx`（地址栏 + **打开方式下拉** + 后退/前进/重载/关闭 + 读正文 + **被拒理由展示**）。
  注意 `WebContentsView` 是**浮在渲染层之上的原生视图**，CSS 管不到它 ——
  渲染层只能把占位区坐标报给主进程去摆（`BROWSER_SET_BOUNDS`）。
- **e2e**：起**本地** HTTP 服务（127.0.0.1 随机端口，不依赖外网）做真实加载与正文提取；
  另断言"跨站跳转被拦"与"`file://` 被拒且理由里点出协议与风险"。
  **这两条断言经过一次红/绿实验才可信**：最初它们只看界面文案，把 `preventDefault` 整行删掉依然全绿（复核 026 的 G-8）。
  现在问的是**真值** —— 经读正文通道取回 guest 实际 `origin` 与页面正文；跳转目标也用**同主机不同端口**
  （Chromium 会把 `localhost` 重写回 `127.0.0.1`，用 localhost 看不出有没有越站）。
  第 14 步另有**运行时桥探针**：页面自己报告 `typeof window.jujia` 与 `typeof window.process` 必须都是 `undefined`。
- **导航审批口径（所有者已拍板，2026-09-24）**：浏览器导航**不再加一层审批弹窗** ——
  用户在地址栏亲手输入并回车 **= 显式授权**。防线由四层承担：① 只允许 http/https（协议白名单，其余拒绝并说明风险）；
  ② 页面自发导航不得越出用户所选 origin；③ 视图不挂 preload（网页拿不到能力桥，且有运行时探针证明拿不到）；
  ④ 不接文件系统。**将来不要"顺手补上"每次导航都问一层** —— 那是卡片 012 的教训：**处处都问等于没问**，
  只会把人训练成无脑点"允许"。要加审批，只加在"能产生本机副作用"的动作上（写盘、执行、外发）。
- **两条后补的底线（`v0.43.0-外审4` · 外部审查 T11，实测后落地）**：
  ① **服务端重定向逐跳过判** —— 跨站 302 / 301 实测**不触发** `will-navigate`（只走 `will-redirect`），
  所以两个钩子共用同一个判档点（接线锁断言"全文件只有一处判定"），链式重定向**每一跳各判一次**，不留"已判过"的缓存。
  ② **网页发起的下载一律取消**（`will-download` → `item.cancel()` + 把文件名与理由显示出来）：
  实测不挂这条时，第三方页面的附件**不经任何询问**就落进系统"下载"目录 —— 本项目没有"下载管理"这套产品，
  所以处置是拦下并说清楚，而不是顺手做一个下载器（将来若真要做，属产品决策，需报备）。
  附带一条 UX 底线：被我们自己拦下的那一跳，Electron 会跟着抛 `ERR_FAILED (-2)`，
  **不许把它显示成"这个网页坏了"** —— 真实理由必须留在界面上。
- **子框架的边界（2026-09-28 批复裁决，写档而不是"修掉"）**：origin 锁只管**顶层导航** ——
  含服务端重定向的逐跳，也含 iframe 把**顶层**跳走的那种（frame busting 走的仍是上面那对事件）。
  **但 iframe 内容自己发出的第三方子资源请求拦不住**：实测 Electron 44 里子框架初次加载不触发任何 `will-*` 事件，
  事件层无从下手；而把跨站 iframe 一律禁掉等于毁掉正常网页（绝大多数站点都嵌第三方资源、地图、播放器、登录框）。
  所以"在应用里看网页"这件事**固有地包含**第三方子资源与它们的追踪请求 —— 这是**边界**，不是待修的洞，
  如实记在这里。要收紧它，先得回答"还要不要能正常看网页"，那是产品决策而不是安全修复。
  真正兜住风险的是另外几层：视图无 preload（网页拿不到任何应用能力）、只放 http/https、不接文件系统、下载一律拦下。
- **打开方式三档（M10 收尾 · `v0.35.0-扩容2`）**：判档在 `main/open-with-gate.ts`（**唯一判档处**，与 `git-gate.ts` 同一个理由），
  流程在 `open-with-service.ts`，唯一碰外部世界的是 `open-with-launch.ts`（`shell:false`、参数只有网址）。三条口径别改松：
  ① 外发两档（`system` / `custom`）**每次硬 ask**，服务层里**不存在** `remembered` / `alwaysAllow` 缓存；
  ② 自选程序路径**只能由主进程原生文件对话框**写入（契约 `browserExeClearSchema` `.strict()` 且只收 `null`），
  且必须绝对路径、真实存在的文件、**不在工作区内**、Windows 上不是 `.cmd`/`.bat`；
  ③ 网址**先过 `decideNavigation` 再过权限门** —— 连自己都判不该开的地址，不该弹出来让用户替它背书。
  默认档 `AppConfig.browserOpenWith` **不进** `WRITABLE_CONFIG_KEYS`：由主进程在真的打开成功之后写。
- **仍未做**：PDF / Markdown 应用内查看（选型待拍板，见 §3.2 第 2 项）；视图"隐藏但保留"未做；
  目前**离开页签即关闭视图**（视图浮在最上层，不收掉会盖住别的页面；代价是切回来要重新加载）；
  `security.ts` 的 `openExternalIfSafe` 仍是 `void shell.openExternal(...)`（失败被吞成"没反应"，已登记待办 —— 属既有路径，未混进本轮）。

### 2.12 质量基建（这是本项目最值钱的部分之一，请务必沿用）

| 工具 | 命令 | 说明 |
|------|------|------|
| 类型/静态检查 | `npm run typecheck` / `npm run lint` | 严格模式（strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes） |
| 单元/集成测试 | `npm test` | 全量绿（**测试文件数与用例数以 `docs/PROGRESS.md` 为准**，那里有机器检查）；`maxWorkers: 4`（防满并发假红灯） |
| 界面级 e2e | `npm run e2e` | 真 Electron + 真点击，数据隔离到唯一临时目录；收尾清理失败只提示不静默（**步数以 `apps/desktop/scripts/e2e-ui.mjs` 为准**） |
| 启动性能 | `npm run perf` | 预算判定，超预算非零退出；**采样铁律见 PERF-BUDGET** |
| 冒烟 | `npm run smoke` | 真实启动 Electron 断言 IPC 全链路 |
| **变异测试** | `npm run mut` | 按 `review/mutations.json` 逐项改坏代码验证测试真拦得住；**"无法运行"单独成类，不算被拦住** |
| **文档一致性** | `npm run check:docs`（**项数以自身输出为准**）+ `npm run check:docs:selftest`（注入的漂移必须全部被拦住） | 见 §5.4 |
| 许可证 | `npm run license:check` | 强 copyleft 硬拒绝；清单自动生成于 `docs/DEPENDENCY-LICENSES.md` |
| 清理 | `python scripts/cleanup.py --apply` | 移入项目内 `.trash/<时间戳>/`，30 天可反悔，**绝不直接删** |
| CI | `.github/workflows/ci.yml` | lint / typecheck / test / **check:docs** / build；**CI 不跑 smoke/perf/e2e**（需真实图形环境，本地跑） |

当前门禁（清单权威在 `docs/PROGRESS.md`）：typecheck / lint / test / smoke / perf / e2e / check:docs。

---

## 3. 未完成部分（剩余任务 / 当前进度 / 中断位置）

### 3.1 全部剩余里程碑（编号规范见 `docs/TRACK-ROADMAP.md` §一）

| 里程碑 | 内容 | 状态 |
|--------|------|------|
| **M10 内置浏览器** | WebContentsView + 三档打开方式 + 读正文给模型 | 🔶 **主链路已通**（打开 / 导航 / 读正文 / 安全：策略 + 服务 + IPC + 界面 + e2e）；**收尾项 = 三档打开方式、PDF/Markdown 应用内查看** ← 本里程碑未完部分 |
| M9 无限画布 | 节点/连线/DAG 校验/执行/持久化 | ⏳ 未开始 |
| M11 多模态 | capability registry、视频生成任务 | ⏳ 未开始 |
| M14 / M17 | 多子 agent 编排 / 长任务断点续跑 | ⏳ 未开始 |
| M19–M22 | 轻量 IDE / 远程接入 / 云 worker / 调度 | ⏳ 未开始（**先解决与"数据不出本机"定位的冲突**，见 §5.8） |
| ~~M6 写入侧~~ | **已交付（`v0.37.0-铺设10`）**：`append_note` 工具（写类 + 写前守卫 + 只由人显式点）；`appendNote` 内部也加了守卫 | ✅ 达成（自动摘要写入仍待 compact） |
| M7 定时任务 | RRULE + 补跑 | ⏳ 未开始 |
| **M8 git（整个模块）** | status/diff/log/stage/unstage/commit 已实现且有测试，`v0.32.0-铺设9` **已接线**：6 条 `GIT_*` 通道 + `git-gate.ts` 判档 + `git-service.ts` + Git 页签 | ✅ **已接线**（读侧放行、写侧软 ask、`commit` 硬 ask，三重保险各有变异）；**剩余**：`push` / 分支 / stash / 冲突 / 逐行 diff |
| **内置 exec 工具** | 让模型能自主执行命令（`run_command`），**一律硬 ask** | ✅ **`v0.33.0-铺设8` 已交付**（每次确认 + 工作目录守卫 + 环境脱敏 + 超时与输出上限；变异 M13–M15 各咬一重） |
| M12 日志/自动更新 | 结构化日志、更新通道 | ⏳ 未做 |

### 3.2 中断位置与原因（从这里继续）

**最近两轮已交付**：轨道扩容计划 1 第 1、2 步（M10 内置浏览器，见 §2.11）· 轨道铺设计划 9（M8 git 模块接线）。

**轨道铺设计划 9（M8 git 模块接线）已交付**（`v0.32.0-铺设9`）：6 条 `GIT_*` 通道 + `git-gate.ts` 判档 +
`git-service.ts` + Git 页签 + e2e 第 17/18 步（在真实仓库上跑，且回磁盘核对提交数与提交主题）。

**已按所有者口径实现的权限映射**（`git-gate.ts` 是唯一判档处，勿在胶水层复制判断）：

| git 动作 | 性质 | 审批档位 | 现状 |
|----------|------|----------|------|
| `status` / `diff` / `log` | 只读 | **不问**（读侧放行） | ✅ 已实现，e2e 断言"只读查询弹窗数为 0" |
| `stage` / `unstage` | 暂存区操作、**可逆** | **软 ask**（可选"总是允许"） | ✅ 已实现，记住后不再问（e2e 验证） |
| `commit` | **写仓库历史** | **硬 ask** | ✅ 三重保险 + 变异 M10/M11/M12；弹窗文案写明"会写入仓库历史" |
| `push`（**尚未实现**） | 外发远端、**不可逆** | **硬 ask，且永远不可被「总是允许」压掉** | ⏳ 做的时候照 `commit` 同一套加：一条通道 + 一行档位 + 一条测试 + 一条变异 |

**M8 未完的部分**（不冒充做完）：`push` · 分支切换 · stash · 冲突解决 · 逐行 diff 视图（界面只有摘要 + 关键行摘录）。

**M10（内置浏览器）仍剩的收尾**：

1. ~~**三档打开方式**~~ → **已交付（`v0.35.0-扩容2`）**：内置 / 系统默认浏览器（`shell.openExternal`，仅 http/https）/
   自选本机程序（**只能由主进程原生文件对话框选定**、不得位于工作区内、Windows 上拒 `.cmd`/`.bat`），
   默认档由主进程在"真的打开成功"之后记住。**外发两档每次硬 ask，且没有任何"记住授权"这条路**
   （判档在 `open-with-gate.ts`，与 git 的 `push` 同一档口径 —— 所有者 2026-09-26 批复）。
   附带合并：`browser:open` / `browser:navigate` 两条通道并入 `browser:open-with`，只剩一个入口。
2. **PDF / Markdown 应用内查看**（PLAN §8.4 的文档查看部分）—— **选型已拍板（2026-09-26），按时序拆开**：
   **Markdown 先行 → 已交付（`v0.36.0-扩容3`：「文档」页签 + 纯函数解析器 + 元素树渲染 + 分块挂载）**；**PDF 用 `pdfjs-dist`，随 M19 与文件树一起做**
   （"点开一个文件"的前提是存在文件树，硬塞进 M10 违背范围纪律）。**PLAN 的 DoD 不降低，只是时序后移。**
   选型的第一性理由（不是"PLAN 定了它"）：① 不开 `plugins: true`、不引入受插件影响的 webContents —— 安全基线零偏离；
   ② 能在渲染层做**真值断言**（canvas 像素 / DOM 证明真的渲染出来了），而内置 PDFium 只能证明"URL 加载完了"。
   原两条依据打架的位置：
   `PLAN.md:72` 定 `pdfjs-dist`（理由"纯前端渲染可控"），而本仓库知识库
   `knowledge/sources/S10-browser-docs.md:80`（T1/T3 来源）推荐"优先用 Chromium 内置 PDFium，
   需要标注/表单/自定义 UI 才上 PDF.js"。差别是实打实的：内置 PDFium 要给那个视图开 `plugins: true`
   （一处安全基线偏离，且与"视图无 preload"要一起论证）；`pdfjs-dist` 要新增依赖与 worker 接线，
   但**可验证性更好**（能断言真实渲染出的页数/像素）。另有一个前置缺口：**当前界面没有文件树**，
   "点开一个文件"这个动作不存在，查看器挂在哪还没定义（可能与 M12 之后的"轻量 IDE"合并考虑）。
3. **视图生命周期的体验取舍**：现在"离开页签即关闭"，要不要改成"隐藏但保留"（需给视图加 hide 能力，
   并想清楚隐藏期间网页继续跑算不算副作用）。

**M4 已交付（`v0.33.0-铺设8`）**，所以 WorkBuddy 给的序列现在是：
**R-12 已交付（`v0.34.0-规整8`：756 行 → 装配根 45 行 + 11 个模块，最大 142 行）**·
**M10 收尾上半已交付（`v0.35.0-扩容2`：三档打开方式 + 外发硬 ask）**；
~~下一轮 = M6 记忆写入侧接线~~ → **已交付（`v0.37.0-铺设10`：`append_note` 工具 + 界面显式入口 + 写前守卫）**；
~~轨道铺设计划 6a「会话持久化」~~ → **已交付（`v0.38.0-铺设6a`：数据布局报备 + 五开关批复后按图施工）**。
**外部审查 P0 四项（T1–T4）已交付（`v0.39.0-外审1`）**，T12（8 个时间戳残留）顺带清掉；
**P1 第一批（T5 / T6 / T7）已交付（`v0.40.0-外审2`）**，并顺带补上自己抓出的 T17（用量事件从来没接到界面）、
核实为"不成立"的 T8（未改一行代码）；**渲染层组件测试首批已开（`v0.41.0-组件测试1`）**（jsdom + testing-library，
只进 devDependencies、不加覆盖率门禁），T19 / T20 / T21 三条就是写测试时登记出来的。
**P1 第二批已交付（`v0.42.0-外审3`：T9 两半 + T19 修复 + T21 分节）**，
**P1 第三批（收尾批）已交付（`v0.43.0-外审4`：T10 handoff 逐 id 配对 + T11 重定向逐跳过判 / 网页下载一律拦下）**
—— **P1 到此走完**。
**轨道铺设计划 6b 已交付（`v0.44.0-铺设6b`）**：compact + 会话结束自动摘要 + 注入隔离界面。
报备稿 `docs/DESIGN-COMPACT.md` 七条全批 + 两条追加验收（④补问也要先预览、⑦e2e 从界面打开 NOTES.md），
状态已改写为"已批已交付"，并**在原地记下两处与报备的出入**（§二 触发点 3 没做、§五 的"生成时间"取文件 mtime）。
新变异 **M50–M55** 已占用（累计 55 项），**下一轮新变异从 M56 起**。
**T22 已交付（`v0.45.0-T22`）**：切页签不丢对话的连接与会话选择（`KeepAlive` 保持挂载 + 对话页稳定 key 的边界 + `onError` 补回"错误态重挂"），
报备稿 `docs/DESIGN-T22-TAB-STATE.md` 七条全批、状态已改写为"已批已交付"；e2e 33 步、变异 M56–M60（累计 60 项）。
**M19a 已交付（`v0.46.0-M19a`）**：文件树 / 打开 / 保存（走既有 write_file 那扇门）/ PDF（零出站）/ 逐行 patch。**下一轮 = M19b**：CodeMirror 6（新增依赖决策）+ **cmap/标准字体本地打包**（本轮为保零出站没设资源地址，未内嵌字体的 CJK PDF 可能缺字 —— 怎么打包要单独定）；之后 M9 画布 → M8 push（批复给定的序列）。
**报备已交、等批后才施工**：`docs/DESIGN-M19-IDE.md`（范围切分 M19a/M19b、权限映射表、五条上限、覆盖保护、
PDF 零出站、diff 扩 `GIT_DIFF` 而不新开通道，末尾九条开关）。
挂账不变：perf 规范采样（等"机器空闲"）· T13–T16 · T18。
**并行队列**：外部审查 P2（T13–T16）已登记在 `docs/TRACK-ROADMAP.md` §二，
其中 T16 标的是"**未核实**"，接手时先逐条读源码核实再动手，不许把报告的说法当既成事实 ——
两轮下来报告已有**两处失实**（ADS 的 realpath 机理、T8 的 `json-store` 已有实现），队列里都按实测写了结论。
其余排期：PDF 查看随 M19 与文件树；M8 收尾（`push` → 逐行 diff 视图；编号方案已批准：`push` 归 M8、逐行 diff 并入 M19）。

**中断原因**：按路线图分步交付 —— 策略层先行并充分测试，再做服务与界面，再做打开方式（均已完成）；
剩下的文档查看是独立增量，且需要先定选型，不必挡在下一个里程碑前面。

### 3.3 已就绪、可直接使用的半成品

- `packages/agent-core/src/browser/policy.ts`：`decideNavigation / decideWindowOpen / normalizeInputUrl /
  isLoopbackHost / decideUserNavigation / decideProgrammaticNavigation`，
  用例覆盖 9 种危险协议、大小写与空白绕过、畸形输入 fail-closed、本机前缀陷阱、跨站跳转、子域与本机探测
  （**用例数以 `policy.test.ts` 为准，别在文档里写死数字**）。**接手方请直接复用，不要重写。**
- `apps/desktop/src/main/browser-wiring.test.ts`：**接线锁**（策略真的挂在 `will-navigate` 上、
  视图拿不到 preload、通道都在统一入口后面、没有"执行任意 JS"的通道）。
  改浏览器相关的任何东西先看这个文件，它红就是真的破坏了底线。

### 3.4 已"降级处理"的能力（不要当成 bug，也不要悄悄恢复）

- `MODE_LABEL`（agent-core 版）与 `fatigueHint` **已删除**（零调用方死代码）。
  **审批疲劳提示**若要做：做在审批弹窗里（main 侧记录连续批准次数），并补测试 —— **不要只把函数加回来**。
- git（**整个模块**，不只是写操作）、记忆写入：**未接线是已知状态**（README/PROGRESS 如实标注），接线时必须过权限门。

---

## 4. 后续计划（优先级 / 步骤 / 预期目标）

> 完整队列见 `docs/TRACK-ROADMAP.md` §二/§三（修复队列 R-01…R-12 + 开发队列）。此处按优先级摘录。

| 优先级 | 任务 | 步骤摘要 | 预期目标（DoD） |
|--------|------|----------|-----------------|
| **P0（已完成）** | ~~M10 第 2 步（服务/IPC/界面/e2e）~~ → **`v0.31.0-扩容1` 已交付** | 见 §2.11 | 能开网页、能读正文；危险导航被拒且理由可读；e2e 含本地 HTTP 真加载 ✅ 全部达成 |
| ~~**P1** M10 剩余：三档打开方式~~ | ✅ **已交付（`v0.35.0-扩容2`）**：判档 `open-with-gate.ts`（内置不问 / 外发两档每次硬 ask、无"记住"路径）；自选程序只能由主进程对话框选定且不得在工作区内；`browser:open`/`navigate` 并入 `browser:open-with`；e2e 第 20 步用**请求台账**做真值 + 变异 M17–M19 | 见 §2.11 三条口径 | 外发必问、拒即零交付、硬 ask 不被压掉 —— 全部有机器断言 |
| ~~**P1** Markdown 查看~~ → **已交付 `v0.36.0-扩容3`** | **PDF 查看随 M19** | 已拍板：Markdown 先行；PDF 选 `pdfjs-dist`（理由与适用范围见 §3.2 第 2 项与 S10 卡片的裁决段） | MD 能在应用内看、长文档不卡；PDF 与文件树同批交付，DoD 不降 |
| ~~**P1 R-12：`ipc.ts` 拆分**~~ | ✅ **已交付（`v0.34.0-规整8`）**：`main/ipc.ts` 756 → 45 行，拆出 `main/ipc/` 下 11 个模块（最大 142 行）；接线锁扫描范围同步扩到全部 ipc 文件并新增「每条通道必须被注册 / 每个模块必须被装配」两条 + 变异 M16；e2e 20/20 行为零改动 | 达标 |
| **P1** | **M6 写入侧 + M4 内置 exec 工具**（~~M8 git 模块接线~~ → **`v0.32.0-铺设9` 已交付**，见 §3.2） | 过权限门（读=放行、写=软 ask、执行/`commit`=硬 ask）；接线后**补变异测试与接线锁**（防"抽了纯函数却没接上"）—— M8 已照此做完，M4 照抄 `git-gate.ts` 的形状 | 用户能通过界面/对话真实使用；台账记录 |
| **P2** | **M9 无限画布** | 先写 `docs/LINKAGE-1.md`（画布↔编码引擎的对接契约）再动工 | 3 节点流程能跑、图可存可读 |
| **P2** | utilityProcess 迁移**评估**（只评估不实现） | 输出"做/不做/分几步 + 代价"结论 | PLAN 的 ADR 不再悬空 |
| **P3** | M7 定时任务 / M11 多模态 / M19+ | 按路线图 | 各自 DoD 见 PLAN 验收清单 |

**工作节奏约定**（重要）：每个阶段 = **先在 `CHANGELOG.md` 写条目 → 代码与 CHANGELOG 一起提交 → 打标签 → 汇报
（当前进度/本次范围/验证方式）**。提交说明一律中文。回退靠 `git checkout <tag>`。

---

## 5. 注意事项（已知问题 / 技术债 / 环境 / 踩坑 / 谨慎区）

### 5.1 已知 bug 与行为取舍（如实列出，不要"顺手修掉"语义）

- **会话历史仅内存**（重启即丢）——刻意设计，README 已标注；`sessions` Map 有 LRU 上限 20。
- **`plan`/`dontAsk` 模式语义**：plan=只读、dontAsk=拒绝而不询问（与"不静默自动拒绝"的默认取向相反，需用户显式选择）。
- **CI 与门禁的差异**：CI 只跑 lint/typecheck/test/check:docs/build；**smoke/perf/e2e 只在本地跑**（workflow 里有注释说明）。
- e2e 收尾清理**尽力而为**（失败只打印提示，旧目录交给 `cleanup.py`）—— 因为沙箱有"同轮删除次数"配额（见 §5.2）。

### 5.2 本机/沙箱环境坑（在这台开发机上实测过，换机器也可能遇到类似问题）

- **`spawnSync` 一律 `EBUSY`**（连 `node -e`、`cmd.exe` 都起不来），**异步 `spawn` 正常** →
  **所有脚本一律用异步 spawn**（`mutation-check.mjs` 已因此改造）。症状：`status === null` + error 带 EBUSY。
- **子进程"跑不起来"≠"测试失败"**：变异脚本已把"无法运行"单独成类、不计入被拦住（否则给假信心）。
- **沙箱删除配额**：同一轮删除次数超阈值（约 50）会拦构建/清理（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`）→
  一轮别反复跑全量测试+多次构建；**配额耗尽时绝不跑变异测试**（还原步骤可能失败，把变异留在源码里）。
- **`ELECTRON_RUN_AS_NODE=1`** 会让 Electron 退化成纯 Node → **必须用 `apps/desktop/scripts/run-electron.mjs` 启动**。
- **vitest 限并发**（`maxWorkers: 4`）：满并发会出现 `FAIL <file> [ <file> ]` 的**收集阶段失败**（单独跑全绿）——假红灯。
- **本机 spawn 很慢**（单次 git 约 0.7–1s）：凡"每用例都 spawn 真实进程"的测试文件，**显式放宽超时**
  （`vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })` 并写明原因），否则全量跑出现假红灯（json-store 并发写实测 5.88s）。
- **git push 走代理不稳定**（偶发 schannel/502）→ 失败就重试；**推送后必须 `git ls-remote` 核对远端 SHA**。
- **测试不写系统盘**：临时数据一律落项目内 `.tmp/`（跟随仓库所在盘）；e2e 用 `JUJIA_DATA_BASE_DIR` + 唯一运行目录。
- **C 盘只有 `%APPDATA%\JujiaAgent`、`%LOCALAPPDATA%\electron-builder` 等少量产物**；清理前备份并只删确切路径。

### 5.3 Shell 写文件的铁律（本项目踩了 7 次的坑，**最高优先级注意事项**）

**任何含反引号或 `${}` 的内容，一律用编辑工具写文件（Write/Edit），绝不用 `node -e "…"` 或 heredoc。**
最近一次事故：用 `node -e` 写复核记录，正文里 `` `http:///path` `` 被 shell 当命令替换，**内容在写入前就损坏**
（URL 片段被吞），事后逐句修复。宁可多敲几次工具调用，不要赌 shell 转义。

**同类坑**：提交信息正文里**不能出现 `cmd.exe` 字样**（会被沙箱当成从 Bash 调 cmd 直接拦下）——
长提交信息用编辑工具写进临时文件再 `git commit -F`，用完删除。

### 5.4 文档治理规则（机器在管，别硬扛）

- **状态唯一权威 = `docs/PROGRESS.md`**；`PRODUCT-GOAL`/`COVERAGE-MATRIX` 已指针化，不再写状态。
- **数字只写一处**（测试数/步数/门禁清单等），写在多处必被 `check:docs` 判漂移。
- `check:docs` 的检查项**以它自己的输出为准，文档不写数字**（写数字必漂 —— 本轮就抓到"文档说 13 项、实际输出 14 项"）：
  npm 脚本存在性、README 链接、docs 导航、孤儿文档（docs/review/knowledge 三处）、**悬空引用**、钩子事件数、
  权限模式数、e2e 步数（README+PROGRESS）、测试文件数、门禁清单、"N件套"只许 PROGRESS 一处、
  **应用版本 = 最新变更记录版本**、**IPC 通道数（文档若写数字必须与 `channels.ts` 一致）**、
  **能力表交叉断言（README 的 ✅ 能力 ↔ `createDefaultRegistry()` 实际工具 ↔ `channels.ts` 实际通道）**、
  **对标产品名 0 命中（活文档与源码注释不得出现；归档豁免。判据用 SHA-256 摘要，脚本里不出现原名）**、
  **代码与配置无本机绝对路径（运行时算出仓库根与用户主目录再比对，检查器自身不含任何本机路径字面量）**。
- 改了检查器规则必须跑 `npm run check:docs:selftest`（逐条注入漂移证明它真的会咬；**用例数以脚本为准**，文档不写数字）。
- **归档文件不受"N件套"规则约束**（历史记录不算漂移）；**绝不改写已推送的 git 历史与标签**。
- **里程碑编号规范**（唯一权威 `docs/TRACK-ROADMAP.md` §一）：连续的 **M1–M23，分三段来源**
  （M1–M12 核心模块 · M13–M18 新增交付物 · M19–M23 扩展架构）。
  **废弃写法（全仓不得再出现）**：`M0` · `M5a` · `M5b` · `M6b` · 把阶段号 `P5` 当模块号 · "钩子四类"（现为七类）；
  `W0–W23` 只是周次，不承载依赖与验收语义。
- **删文件/改引用前先看谁在索引它**：悬空引用检查（`check:docs`）就是为 `findings/F8.md` 事故加的
  —— 该文件被 `knowledge/README.md` 索引引用，而**仓库里没有它**。
  **更正一处表述**：F8 的调研内容确实存在，是内部调研材料，在"仓库去参考化"那一轮移出了仓库 ——
  准确说法是「**未随仓库交付**」，不是此前写的「从未存在」。"点不开的链接"比缺文档更坏。
- 记录命名：CHANGELOG 标题 `[vX.Y.Z-轨道简称N]`，正文首行写轨道归属；十条轨道定义见 `docs/TRACK-PLANS.md`。

### 5.5 变异测试的操作禁忌

- 只在**已提交的干净基线**上做；**禁止 `git checkout -- <file>` 还原变异**（会连带丢未提交修复）——脚本用内存备份写回。
- 变异定义里 `find` 锚点**必须恰好命中 1 次**，否则显式失败。
- 写测试防"假拦截"：**测试数据要让输入顺序与期望顺序相反**（排序类，复核 015 连续两轮栽在同一盲区）；
  **被测差异必须在所选取值上真实存在**（变异 M4 逃逸的教训：用"可写键+undefined"测不出"undefined 不算写入"）。
- **源码扫描类断言两条铁律**（复核 009/017 各栽一次）：① **先剥注释**再扫；
  ② 断言字符串要含**足以区分"赋值/比较/注释"的完整上下文**（踩过：`toContain('X =')` 被紧邻的 `X === undefined` 满足）。
- 抽出纯函数后，**必须再加一条"真的在用它"的接线锁**，否则单测测的是死代码（双份真相）。

### 5.6 需要谨慎修改的代码区域（改动前先读注释与对应测试）

1. **`ipc.ts` 统一入口的发送方校验**：`handle` 定义必须在任何 `handle(...)` 调用之前（`const` 暂时性死区，实测踩过）。
2. **`policy.ts` 权限门**：硬/软 ask 语义 + `PERMISSION_MODES` 与 `shared-ipc` 的一致性锁——**改一边必改另一边**。
3. **`config-write.ts` 白名单**：白名单外必须报错；`workspace` 永远不可由渲染层写；有接线锁盯着 `ipc.ts` 必须真调它。
4. **`path-guard.ts`**：不要"优化"成字符串前缀匹配。
5. **`browser/policy.ts`**：先原始输入结构校验再 URL 解析（顺序有实测依据，见测试注释）。
6. **`json-store.ts`**：原子写与自愈逻辑，改前跑并发写测试。
7. **`e2e-ui.mjs` / `run-electron.mjs` 的路径解析**：一律按**脚本自身位置**（`import.meta.url`）解析，不要用相对 cwd。
8. **渲染层只允许引用无 node 依赖的纯逻辑模块**：`import type` 编译后消失所以不会暴露问题；
   一旦导入**运行时值**，包根的 node 内置依赖就会进浏览器包 → **rollup 构建失败**。用子路径导入 + vite 别名。
9. **`scripts/check-docs.mjs` / `verify-docs-check.mjs`**：改规则必须配自检用例（注入漂移证明会咬）；
   自检在**基线为红时会拒绝运行**（这是故意的）。

### 5.7 技术债清单（已登记、未还）

- `ipc.ts` 已由 R-12 拆成装配根（45 行）+ `ipc/` 下 11 个模块（最大 142 行）；新增能力 = 加一个模块 + 在装配根加一行，通道覆盖由接线锁机器看住。
- Agent runtime 在 main 进程而非 `utilityProcess`（PLAN 的 ADR 未兑现，已在 PLAN 就地标注"未实现"）—— 待评估。
- 首屏 chunk 体积超标（目标 <400KB gzip；**当前实测值与增长原因见 `docs/PERF-BUDGET.md` §二/§四**）；长会话 fps 未实测（需 DevTools 录制）—— PERF-BUDGET 待办。
- `as never` / `as unknown as` 断言集中在工具入参与 provider 解析处（有注释说明，属类型边界妥协）。
- PLAN 选型表里的 React 18 / Fluent UI / zustand / xyflow **与实际不符**（实际 React 19 + 自研组件）——已按事实修正一部分，选型表仍待清理。

### 5.8 定位冲突与设计律（需要产品决策，不是 bug）

`docs/ARCH-CLOUD-IDE.md` 的 M20/M21（远程接入/云端 worker）与 PRODUCT-GOAL 的"数据不出本机"、
README 的"无服务器中转"存在**表述冲突**（SECURITY 的出站表也没有对应类别）。
**在解决这个冲突之前不要动工 M20/M21**；SECURITY.md 的出站清单必须先扩展并如实标注。

扩展架构若将来落地，**三条设计律不可破**（`docs/ARCH-CLOUD-IDE.md`）：
**会话状态归 host** · **远端连接一律出站**（本机不做入站监听）· **绝不允许匿名可达**；
且 **权限门永远在本机**（远端 worker 无放行权）、样式包拒绝任意 CSS/JS。

### 5.9 账号与密钥（**仓库里没有任何密钥**）

- 仓库：`https://github.com/Zhang-jx00/jujia-agent`（**当前私有**；计划是**发布第一个正式版本时切公开**）。**交接不涉及任何账号转移**。
  > **口径更正（2026-09-24）**：本文档与 CHANGELOG / PROGRESS / 复核台账的若干旧条目都写着"公开仓库"，
  > **那是错的** —— GitHub API 实测 `private: true`（匿名访问 `api.github.com/repos/...` 返回 404，已独立旁证）。
  > 凡历史条目里的"公开仓库"，一律读作"**本仓库（当前私有，发布第一版时切公开）**"。
  > 影响：此前被评为"隐私泄漏"的几项（Windows 用户名进过仓库、账号名在历史里），**风险在私有期间是冻结的**；
  > 它们真正的到期时点是**切公开那一刻**，所以下面这份清单是"开源前置"而不是"立即处置"。
- ✅ **GitHub PAT 已闭环**（所有者于 2026-09-24 完成撤销重签）：新 token 为 fine-grained、单仓库、
  仅 `Contents: Read and write`，**90 天轮换制**，到期 `2026-12-23`；**到期后 push 报 401 属正常轮换**。
  接手方**不得**代读任何凭据文件。

#### 开源前置检查清单（切 Public **之前**必须逐条做完并留证据）

| # | 检查项 | 怎么做（命令级） | 底数与状态 |
|---|--------|------------------|------------|
| 1 | **账号名底数（已核定，留档）** | `git log --all -G'<正则>' --oneline \| wc -l`（内容命中）＋ `git log --all --format='%an\|%ae\|%cn\|%ce' \| sort -u`（**元数据**命中）＋ 全跟踪文件的家目录比对 | **GitHub 账号名**：全历史内容 **8 个提交**、当前树 **14 行 / 8 个文件**（11 行 = 仓库自身的 GitHub URL，3 行 = LICENSE 版权行与两处 author 署名）。**提交元数据 0 命中**（全仓仅 1 个身份）。**真实家目录全路径 0 命中** |
| 2 | ~~若决定改写历史（`git filter-repo --replace-text` → 强推）~~ | — | **不适用（所有者 2026-09-24 裁决）**：底数核定"无本机路径、无第二身份，14 行均为开源必需项"→ **原样保留，不改写历史**。LICENSE / author 保留现署名（与 GitHub 账号一致）；若将来改用笔名由所有者另行提出。**留下的教训**：拍板前必须先摸底 —— "归零"这个动作的前提（存在本机路径泄漏）当时已不成立 |
| 3 | **去参考化与一致性断言复跑** | `npm run check:docs` + `npm run check:docs:selftest` | 当前 **19 项全绿**、**9 处**注入漂移全部被拦住（项数以脚本自己的输出为准）；对标产品名检查只存摘要，源码与文档都不含原名字面量 |
| 4 | **本机信息扫尾已升级为机器断言** | `check:docs` 第 **9** 条（代码与配置：禁仓库路径与家目录）+ 第 **9b** 条（**活文档 .md：禁家目录**，仓库路径作证据引用不受此限） | 两条均在岗且经注入自检证明会咬。**剩余一处可改写项**：`docs/TEST-POLICY.md` §五 引到一个本机 checkout 的**父目录**路径（属证据引用、非隐私，9b 不判红）—— 切 Public 前建议改写成"仓库同级目录下的备份位置" |
| 5 | **切 Public 后立刻复查一次** | 匿名 `curl -o /dev/null -w "%{http_code}" https://api.github.com/repos/<owner>/<repo>` 应为 **200**；再跑第 1 项的三条检索 | 现在返回 **404**（= 仍为私有，符合预期） |

> **敏感信息扫描的方法论（三条，都是本轮踩出来的 —— 下次照做，别再凭直觉）**
> 1. **不信任环境变量做判据**：`$USERNAME` 在这台机器上**只有 1 个字符**，拿它当检索词会把海量正常汉字全部命中、
>    并把脱敏结果变成乱码。判据要用**运行时算出的完整路径形态**（`homedir()` 归一化后比对）。
> 2. **大小写不敏感 + 变体串**：邮箱里的 `zhangjx00`（无连字符、全小写）与 `Zhang-jx00` 是两个不同串；
>    第一遍用大小写敏感检索**漏了 1 行**。要按"去分隔符 + 全小写"的变体再扫一遍。
> 3. **报告数量与文件清单，不回显敏感值本身**；且区分**三类不同对象**（GitHub 账号名 / 本机账户名 / 仓库路径）——
>    它们的处置方式完全不同，混在一起谈就会得出"用户名泄漏了"这种既吓人又没根据的结论。
- 模型 API Key 属用户本地数据（safeStorage 加密存储），不随仓库走；接手方开发用自己的 Key，别提交。

### 5.10 用户固定约定（**逐条核对过，接手方必须继续遵守**）

> 这些是项目所有者在此前开发过程中**明确提出并反复强调**的要求，不是建议。

1. **用户不做任何人工测试**：所有开发与测试由开发流程（AI/脚本）完成；**界面操作也必须自动化**
   （`npm run e2e`，真 Electron + 真点击）。**不要以"请用户手动验证一下"收尾。**
2. **验证 = 门禁全绿**（清单见 `docs/PROGRESS.md`）；四项全绿才允许打标签；**未跑成的项如实标注，绝不假称完成**。
3. **每轮开发前先联网核实最新信息**（模型版本、API、依赖版本）——不依赖记忆里的版本号；
   回答与文档须注明**来源 URL + 核实时间**；发现项目内记录过时立即修正留痕。
4. **来源宁缺勿滥**：缺合格来源就留空并写明原因，**绝不编造** URL / 论文编号 / 课程名（所有者会抽查）。
5. **统计一律用脚本**（`count_coverage.py` / `gen_matrix.py` / `check:docs`），**不采信任何文件的口头汇总数字**。
6. **提交说明一律中文**（不用 feat/chore/fix 等英文前缀）；提交说明正文不得含 `cmd.exe` 字样（见 §5.3）。
7. **对外文档不写"参考/借鉴 XX 项目"字样**（不列举同类开源产品）；学到的东西**内化成自己的做法**，
   只在内部私有目录留痕；对外表述一律写"我们为什么这样做"。
8. **涉及第三方项目/信息先联网查最新**：先查公开最新版与更新日志；查不到就说搜不到，**绝不拿旧信息冒充最新**。
9. **必须持续接触新技术**：选型要说明"为什么用现在这个做法"并记录被替代的旧做法；新技术要落到**代码或文档**。
10. **收尾清理**：任务结束跑 `python scripts/cleanup.py` 预览 → `--apply`（移入 `.trash/`，30 天可反悔，绝不直接删）。
11. **知识统一进 `knowledge/`**，规划进 `docs/`，复盘/排查进 `review/`；不另起散乱目录。
12. **版本控制流程**：每完成一个阶段 **先写 CHANGELOG 条目**（并把 `apps/desktop/package.json` 的版本号一并改到位 ——
    **必须在跑图形类门禁之前改**，见 §5.11 与复核 025 的教训），再把 CHANGELOG 与代码一起 `git add`、提交；
    **接着在"已提交的干净基线"上补跑 `npm run mut`**（变异测试的禁忌要求基线已提交，见 §5.5）；
    **全绿之后才打标签（`vX.Y.Z-轨道N`）并 push**，推送后用 `git ls-remote` 核对远端 SHA；最后汇报（当前进度/本次范围/验证方式）。
    > **顺序为什么是这样（2026-09-24 更正）**：此前这条写的是"提交 → 打标签 → 推送 → 再补跑变异"，
    > 那会把标签打在变异验证**之前** —— 与 §5.10 第 2 条"全绿才允许打标签"自相矛盾。
    > 标签一旦推上去就撤不回（"绝不改写已推送的历史与标签"），所以正确顺序只能是**先验证、后打标签**。
    > **标签落点的口径（2026-09-28 补，前几轮已按此执行但一直没写下来）**：变异只能在"已提交的干净基线"上跑，
    > 而跑完要回填的哈希只能进**下一个**提交 —— 于是标签必然停在**功能提交**上，`main` 则比它多一个回填提交。
    > 这不是失误，也不去改写：`git checkout <标签>` 回到的是"代码 + 文档 + 版本号"完整可用的那一份，
    > 回填提交里只多了一行"本轮变异基线 = `xxxxxxx`"。汇报与台账里两处 SHA 都要如实写出，不写成同一个。
13. **十条轨道**（命名规则，定义见 `docs/TRACK-PLANS.md`）：**回归**（用户发起的整体审查+大修复）· **铺设**（agent 核心能力）· **扩容**（画布/IDE/浏览器/远程等新形态）· **拓展**（技能/钩子/插件/外观）· **加固**（安全/边界/存储）· **升级**（依赖与做法替换）· **优化**（性能与资源）· **规整**（结构/规范/记录）· **排查**（系统找问题，产出 `review/TRACK-SWEEP-N.md`）· **接驳**（功能间对接，产出 `docs/LINKAGE-N.md`）。

### 5.11 历史问题速查表（项目执行中出现过的问题 → 原因 / 处理 / 现状）

> 完整证据在 `review/REVIEW-LOG.md`（复核 001–024）与 `review/TRACK-SWEEP-1.md`。此处按主题归并。

| 问题 | 原因 | 处理 | 现状 |
|------|------|------|------|
| **权限模式切换"假动作"**（S1，严重） | `CONFIG_SET` 白名单外字段**静默丢弃**，UI 却提示成功 | 白名单外**显式报错**；`permissionMode` 允许写入；e2e 加"切换后必须读回新值"断言 | ✅ 已修（e2e 证明） |
| README 把已交付能力写成"未开始"（S2） | 文档状态分散、无唯一权威 | 能力表按事实重写；确立 PROGRESS 为状态权威 | ✅ 已修 |
| 状态三足鼎立互相打脸（S3） | 5 份文档各写进度，无唯一权威 | PRODUCT-GOAL/COVERAGE 指针化；**数字只写一处**并被机器检查 | ✅ 已修（机器管） |
| PLAN 两条 ADR 未兑现未标注（S4） | utilityProcess 未实现、main≤300 行未落地，文档却称"一致" | PLAN 就地标注"未实现"；评估列入队列 | 🔶 已如实标注；评估未做 |
| 里程碑编号三套语义（S5） | M3/M4/M5 在不同文档指不同物，还有 M5a/M5b 别名 | 定死 M1–M23（`TRACK-ROADMAP` §一）；全仓清别名 | ✅ 已修（机器管） |
| PERF-BUDGET 整篇重复两套（S6） | 追加时未删旧版 | 合并为单一权威版 + 采样铁律 | ✅ 已修 |
| **check:docs 盲区**（S7） | 不扫 PROGRESS 数量、不扫 CHANGELOG/review | 扩充检查项（**项数以它自己的输出为准**）；自检注入的漂移全部被拦住；归档合理豁免 | ✅ 已修 |
| **spawnSync 全部 EBUSY**，变异"十项齐刷刷被拦住" | 本机同步 spawn 不可用；脚本把"没跑起来"当成"测试失败" | 全改异步 spawn；"无法运行"单独成类、不计入被拦住 | ✅ 已修（工具层） |
| 变异 M4 逃逸 | 用例取值让变异不可观测（可写键+undefined） | 改用"不可写键+undefined"；记录教训 | ✅ 已修 |
| `findings/F8.md` 悬空引用 | 被索引引用，但**未随仓库交付**（内部调研材料，去参考化时移出仓库；此前记为"从未存在"，表述不准，**已更正**） | 索引按事实改写；加**悬空引用检查** | ✅ 已修（机器管） |
| CHANGELOG 拆分方向搞反 | 该文件"新的在前"，脚本却保留了最老的 | `git checkout HEAD --` 还原重做（已提交文件本身是保险） | ✅ 已修 |
| **Shell 反引号坑（7 次）** | 用 `node -e`/heredoc 写含反引号内容 | 铁律：一律编辑工具写文件（§5.3）；事故均已修复 | ⚠️ **靠纪律维持**，接手方继续遵守 |
| 权限模式/文案双份定义 | 两个包各自定义（分包边界使然） | 不合并；**跨包一致性锁** 4 例 | ✅ 已锁 |
| 死代码（MODE_LABEL/fatigueHint） | 从未接线却留着，让人以为功能存在 | 删除；想法登记 roadmap（要做就真做+测试） | ✅ 已删 |
| 知识库领域数口径不一（89+ vs 108） | 扩领域后旧口径未更新 | 统一为 **108**；口头数字一律不信，用脚本 | ✅ 已修 |
| e2e 步数/测试数漂移（12 vs 13/14；34 vs 37/38） | 数字散写多处 | 机器检查（README+PROGRESS 两处与脚本比对） | ✅ 已修（机器管） |
| **GitHub PAT 曾暴露** | ——（外部原因） | **只能由账号持有人撤销重签** | ✅ **已闭环（2026-09-24 所有者执行）**：旧的两个永久 token（WorkBuddy / TRAE）已纳入撤销范围；新 token 为 fine-grained、**只授权 `jujia-agent` 单仓库的 Contents: Read and write**，**90 天轮换制**，到期日 `2026-12-23`。⚠️ **到期后 `git push` 报 401 属正常轮换，不是仓库坏了** —— 处置方式是所有者重签，接手方不得代读凭据文件 |

---

## 6. 其他信息

### 6.1 文档地图（按用途）

| 想知道什么 | 看 |
|------------|-----|
| 项目定位与取舍 | `docs/PRODUCT-GOAL.md` |
| 现在做完什么了 | `docs/PROGRESS.md`（**状态权威**） |
| 下一步做什么、编号规范 | `docs/TRACK-ROADMAP.md` |
| 工作怎么分类/记录（十条轨道） | `docs/TRACK-PLANS.md` |
| 架构与模块职责 | `docs/PLAN.md`（§4 模块表、§5 阶段表） |
| 全项目问题清单 | `review/TRACK-SWEEP-1.md`（轨道排查计划 1） |
| 每轮复核与变异记录 | `review/REVIEW-LOG.md`（更早的在 ARCHIVE） |
| 历史变更 | `CHANGELOG.md`（**最近若干条**，条数以文件为准 —— 文档不写数字）+ `docs/CHANGELOG-ARCHIVE.md`（更早的原文归档） |
| 安全承诺与边界 | `SECURITY.md` |
| 怎么装终端依赖、常见报错 | `docs/SETUP-TERMINAL.md` |
| 性能预算与采样铁律 | `docs/PERF-BUDGET.md` |
| 钩子/技能/插件用法 | `docs/HOOKS.md` / `docs/SKILLS.md` / `docs/PLUGINS.md` |
| 领域覆盖（60+ 领域落点） | `docs/COVERAGE-MATRIX.md`（只管落点映射） |
| 知识库（108 领域） | `knowledge/README.md`（四层体系导航） |

### 6.2 常用命令速查

```bash
npm install                # 安装（workspace monorepo）
npm run dev                # 开发模式（经 run-electron 启动器）
npm run typecheck          # 类型检查
npm run lint               # 静态检查
npm test                   # 单元 + 集成测试
npm run smoke              # 真实启动 Electron 冒烟
npm run e2e                # 界面级端到端（真 Electron + 真点击；步数以脚本为准）
npm run perf               # 启动性能预算判定
npm run mut                # 变异测试（按 review/mutations.json）
npm run check:docs         # 文档一致性（项数以它自己的输出为准）
npm run check:docs:selftest# 检查器自检（证明它会咬）
npm run license:check      # 依赖许可证合规
python scripts/cleanup.py  # 收尾清理（预览→--apply）
npm run dist               # 打 Windows 安装包（根目录代理到 apps/desktop；内含 build）
```

### 6.3 部署 / 发布流程

1. 确认**门禁全绿**（清单见 `docs/PROGRESS.md`；本地跑）。
2. `npm run dist` → 产物在 `apps/desktop/release/`（安装包 + portable）。
3. **打包后的 exe 也要跑 `--smoke`**（`env -u ELECTRON_RUN_AS_NODE ./JujiaAgent.exe --smoke`，退出码 0 才算过）。
4. 在 GitHub 发 Release、传产物、打标签（`vX.Y.Z-轨道N`）。
5. **版本号规则**：`apps/desktop/package.json` 的版本必须等于最新 CHANGELOG 条目版本（有机器检查）。
6. 收尾：`python scripts/cleanup.py --apply`。

### 6.4 给接手方的最后叮嘱

- 这个项目的可信度建立在**"说了没做就是没做"**上：测试没过就写没过，跑不成就写跑不成，**绝不假称完成**。
- 改任何安全相关代码前，先读对应测试与 `review/REVIEW-LOG.md` 里相关的复核记录 —— 大部分坑已经踩过并写下来了。
- 有疑问先查文档与台账；**文档与代码冲突时，以代码为准并修文档**（然后用 `check:docs` 钉住）。
