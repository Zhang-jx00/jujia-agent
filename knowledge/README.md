# 俱佳Agent · 统一知识库

> 一个文件夹收拢所有「检索到的知识、方案」的**知识部分**。
> 「怎么做」的规划在 `../docs/`；当前进度以 `../docs/PROGRESS.md` 为准；排期见 `../docs/TRACK-ROADMAP.md`。

## 体系导航（四层，从"要学什么"到"我们决定怎么做"）

```
docs/LEARNING-MAP.md     ① 地图：108 个领域 + 学习顺序（先看这个知道范围）
        ↓
sources/S1–S11           ② 来源：每个领域 T1–T5 五类权威来源（要看证据时来这里）
        ↓
SOURCE-MATRIX.md         ③ 矩阵：108 领域 × 5 类来源的逐格覆盖（脚本生成，查缺口）
        ↓
findings/F1–F7           ④ 结论：按知识簇归纳的发现（含取舍与依据）
        ↓
REPORT.md                ⑤ 综合：12 条核心结论 + 架构建议（只有时间看一份时看它）
cards/001–016            ⑥ 落地：对俱佳Agent 的具体决定（开发前按编号速览）
```

**领域数口径**：当前 **108 个**，与 `SOURCE-MATRIX.md` 一致，且**由脚本产出**——
`python scripts/count_coverage.py` 与 `python scripts/gen_matrix.py` 都得
**108 领域 / 540 格 / 完全 492 / 部分 7 / 空缺 41**。

> **2026-09-24 的一段往返（留痕）**：本轮交接验收曾查出"文档写 108、脚本只数到 107"，
> 根因是 `sources/S4-architecture.md` 的「覆盖度自评」表被误删了第 8 行（Sidecar / 内核隔离）。
> 所有者拍板：**按证据补回该行凑回 108，不许悄悄把口径降成 107**。已补回。
> 但那行的 **T2 来源条目随原行一并丢失、无法在不编造的前提下恢复**（本矩阵只存 ✅ 符号、不存 URL），
> 故记 ⬜ —— 所以本版是 108 领域 / **完全 492（旧记 493）· 空缺 41（旧记 40）**。
> **少的那一格是真实的信息损失，不靠改数字抹平**；证据与推理见 `review/REVIEW-LOG.md` 复核 025 · F-17。
> （更早的"89+"是扩领域之前的旧口径，已作废。）

## 目录导览

| 路径 | 内容 | 什么时候读 |
|------|------|------------|
| `BRIEF.md` | 调研任务书（问题定义、范围、研究角度） | 想了解调研边界时 |
| `REPORT.md` | **综合调研报告**（核心结论 + 架构建议 + 来源清单） | 只看一份时读它 |
| `SOURCE-MATRIX.md` | **108 领域 × 5 类来源逐格矩阵**（`scripts/gen_matrix.py` 生成，勿手改） | 查某领域有哪些权威来源 / 查缺口 |
| `sources/S1–S11` | 五类来源补齐（每领域 T1–T5） | 按簇找官方文档 / 源码 / 论文 / 课程 / 社区 |
| `findings/F1–F7` | 按知识簇的发现（7 个簇） | 想知道"结论是什么、依据是什么" |
| `cards/` | 知识卡片：对俱佳Agent 的落地决定（清单见下） | 开发前速览（编号递增） |

## 知识卡片清单（开发前速览）

| 卡片 | 主题 |
|------|------|
| `cards/001-agent-loop.md` | Agent Loop 三分支 |
| `cards/002-permission-no-auto-reject.md` | 权限请求禁止自动拒绝 |
| `cards/003-atomic-json-store.md` | JSON 状态原子写 |
| `cards/004-streaming-ui-budget.md` | 流式 UI 性能预算 |
| `cards/005-skills-vs-mcp.md` | Skills ≠ MCP（职责分离） |
| `cards/006-memory-tiers.md` | 记忆分层与压缩 |
| `cards/007-electron-p0-gotchas.md` | P0 踩坑：`ELECTRON_RUN_AS_NODE` 与包外部化 |
| `cards/008-streaming-sse-pitfalls.md` | SSE 边界、尾包与「中止不是异常」 |
| `cards/009-vendor-api-verification-2026-09.md` | 厂商 API 核实记录（含废弃项） |
| `cards/010-path-sandbox-windows.md` | 路径沙箱：字符串前缀匹配一定会出事 |
| `cards/011-streaming-tool-calls-rules.md` | 流式 tool_calls 拼装的四个陷阱 |
| `cards/012-permission-tiering-2026.md` | 权限分级：处处都问 = 没问 |
| `cards/014-motion-and-fluidity-2026.md` | 动效铁律：加了动效反而更卡 |
| `cards/015-memory-and-context-2026.md` | 记忆管理：AGENTS.md 只写不可见的逻辑 |
| `cards/016-electron-terminal-selection.md` | 终端选型：直接用官方 `node-pty` |

> 编号 013 空缺：该卡片的内容已并入 `cards/015` 与 `review/REVIEW-LOG.md` 的对应复核记录，
> 不再单独存在（**编号不回收**，避免历史引用指向新内容）。

## 知识簇 → 文件对照

| 簇 | 知识簇 | 领域编号 | findings | sources |
|----|--------|----------|----------|---------|
| A | Agent 核心机制与设计模式 | #1–10 | `findings/F1.md` | `sources/S1-agent-core.md §1–10` |
| B | 多 Agent / 子代理 / 编排 | #11–18 | `findings/F2.md` | `sources/S1-agent-core.md §11–18` |
| C | 技能 / 钩子 / 定时 / 连接 / MCP | #19–30 | `findings/F3.md` | `sources/S2-extensions.md §1–12` |
| D | 记忆与上下文管理 | #31–40 | `findings/F4.md` | `sources/S3-memory.md §1–10` |
| E | 系统架构与 Electron 工程 | #41–52 | `findings/F5.md` | `sources/S4-architecture.md §1–12` |
| F | 性能 / 缓存 / 预加载 / 流畅 | #53–62 | `findings/F6.md` | `sources/S5-performance.md §1–10` |
| G | UI / UX / 视觉 / 动效 | #63–74 | `findings/F7.md` | `sources/S6-uiux.md §1–12` |
| H | 模型适配与产品工程 | #75–84 | —（**未单独成文**，结论并入 `REPORT.md`） | `sources/S7-model.md §1–10` |
| I | 预加载 / 启动 / 体积 / 内存 / 功耗 | #85–89 | — | `sources/S8-preload-appopt.md` |
| J | 无限画布与工作流节点编排 | #86–94 | — | `sources/S9-canvas-workflow.md` |
| K | 内置浏览器与文档查看 | #95–99 | — | `sources/S10-browser-docs.md` |
| L | 多模态能力适配与视频生成 | #100–104 | — | `sources/S11-multimodal-video.md` |

> H 簇此前在本表里指向一份 **F8** 文档（悬空引用，全项目排查时发现，编号 017）。
> **更正表述**：F8 的调研内容**确实存在**，但**未随仓库交付** —— 它是内部调研材料，
> 在"仓库去参考化"那一轮移出了本仓库。所以准确说法是「未随仓库交付」，而不是当时写的「从未存在」。
> 本表已按事实改写为"未单独成文，结论并入 `REPORT.md`"；在库来源见 `sources/S7-model.md`。
> **宁可写"没有"，也不留一个点不开的链接。**

## 五类权威信息来源（T1–T5）

每个知识领域要求覆盖：**T1 官方文档/规范** · **T2 开源项目源码（指到目录/文件）** ·
**T3 论文/权威报告/官方工程博客** · **T4 在线课程/系统教程** · **T5 技术社区讨论**。

**找不到合格来源的格子留空并写明原因，绝不编造** —— 这是本知识库的第一纪律。

## 维护约定

1. 新增知识 → 先在 `sources/` 补来源，再在 `cards/` 写落地决定（编号递增）；**不要新增没有来源的结论**。
2. 改过任何"覆盖度自评"表后，重跑 `python scripts/gen_matrix.py` 重新生成 `SOURCE-MATRIX.md`。
3. 统计一律用脚本（`scripts/count_coverage.py`），**不采信正文里的口头汇总数字**。
4. 任务收尾执行 `python scripts/cleanup.py`（项目约定）。
