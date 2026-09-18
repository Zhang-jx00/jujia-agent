# 变更记录（CHANGELOG）

> 约定：每个阶段或关键改动一条记录，含**时间戳 / 范围 / 改动内容 / 验证方式 / 回退点**。
> 回退点 = git tag 或 commit 短哈希；任何时候可用 `git checkout <tag>` 回到指定版本。
> 阶段划分见 `docs/PLAN.md` §5–6。

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
