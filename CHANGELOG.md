# 变更记录（CHANGELOG）

> 约定：每个阶段或关键改动一条记录，含**时间戳 / 范围 / 改动内容 / 验证方式 / 回退点**。
> 回退点 = git tag 或 commit 短哈希；任何时候可用 `git checkout <tag>` 回到指定版本。
> 阶段划分见 `docs/PLAN.md` §5–6。

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
