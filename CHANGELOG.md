# 变更记录（CHANGELOG）

> 约定：每个阶段或关键改动一条记录，含**时间戳 / 范围 / 改动内容 / 验证方式 / 回退点**。
> 回退点 = git tag 或 commit 短哈希；任何时候可用 `git checkout <tag>` 回到指定版本。
> 阶段划分见 `docs/PLAN.md` §5–6。

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
