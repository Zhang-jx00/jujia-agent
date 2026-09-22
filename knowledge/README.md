# 俱佳Agent · 统一知识库

> 一个文件夹收拢所有「检索到的知识、方案与计划」的**知识部分**；
> 「怎么做」的规划与开发计划在 `../docs/`，需求达成度评估在 `../review/`。

## 目录导览

| 路径 | 内容 | 怎么读 |
|------|------|--------|
| `BRIEF.md` | 调研任务书（问题定义、范围、8 个研究角度） | 想了解调研边界时读 |
| `REPORT.md` | **综合调研报告**（12 条核心结论 + 架构建议 + 来源清单） | **先读这个** |
| `SOURCE-MATRIX.md` | **89+ 领域 × 5 类来源的逐格矩阵**（脚本自动生成） | 查某个领域有哪些权威来源 |
| `sources/` | 五类来源补齐 S1–S11（每领域 T1–T5 五类权威来源） | 按簇找课程 / 社区讨论 / 源码 |
| `cards/` | 知识卡片（对俱佳Agent 的落地决定，编号递增） | 开发前按编号速览 |

## 知识簇 → 文件对照

| 簇 | 知识簇 | findings | sources |
|----|--------|----------|---------|
| A | Agent 核心机制与设计模式（#1–10） | `findings/F1.md` | `sources/S1-agent-core.md §1–10` |
| B | 多 Agent / 子代理 / 编排（#11–18） | `findings/F2.md` | `sources/S1-agent-core.md §11–18` |
| C | 技能 / 钩子 / 定时 / 连接 / MCP（#19–30） | `findings/F3.md` | `sources/S2-extensions.md §1–12` |
| D | 记忆与上下文管理（#31–40） | `findings/F4.md` | `sources/S3-memory.md §1–10` |
| E | 系统架构与 Electron 工程（#41–52） | `findings/F5.md` | `sources/S4-architecture.md §1–12` |
| F | 性能 / 缓存 / 预加载 / 流畅（#53–62） | `findings/F6.md` | `sources/S5-performance.md §1–10` |
| G | UI / UX / 视觉 / 动效 / 组件卡片（#63–74） | `findings/F7.md` | `sources/S6-uiux.md §1–12` |
| H | 模型适配与产品工程（#75–84） | `findings/F8.md` | `sources/S7-model.md §1–10` |
| I | 预加载 / 启动 / 体积 / 内存 / 功耗（#85–89） | — | `sources/S8-preload-appopt.md` |
| J | 无限画布与工作流节点编排（#86–94） | — | `sources/S9-canvas-workflow.md` |
| K | 内置浏览器与文档查看（#95–99） | — | `sources/S10-browser-docs.md` |
| L | 多模态能力适配与视频生成（#100–104） | — | `sources/S11-multimodal-video.md` |

## 五类权威信息来源（T1–T5）

每个知识领域要求覆盖：

1. **T1 权威官方文档 / 官方规范**
2. **T2 开源项目源码或仓库**（指到具体目录/文件）
3. **T3 论文 / 权威技术报告 / 官方工程博客**
4. **T4 在线课程 / 系统教程 / 交互式教学**
5. **T5 技术社区讨论**（GitHub Issues、Stack Overflow、Reddit、HN、掘金/知乎）

找不到合格来源的格子**留空并写明原因**，绝不编造——这是本知识库的第一纪律。

## 真实性保障

- 所有 URL 均来自实际检索或实际打开的页面；`canonical` = 高度稳定的经典权威资源。
- 全量 URL 曾用脚本逐一做 HTTP 状态校验；GitHub 在本环境被整体阻断（curl 返回 000，连首页亦然），
  属环境限制而非链接失效，已在评估报告中说明。
- 已修复的问题：26 处「URL 后粘连中文注释」导致链接不可点击；4 处已核实 404 的错误路径
  （openai-agents-python 文档下划线、agentskills.io 快速上手页）。
- 修复脚本：`../scripts/fix_source_urls.py`；覆盖度统计：`../scripts/count_coverage.py`；
  矩阵生成：`../scripts/gen_matrix.py`。

## 维护约定

1. 新增知识 → 先在 `sources/` 补来源，再在 `cards/` 写落地决定，卡片编号递增。
2. 修改任何「覆盖度自评」表后，重跑 `../scripts/gen_matrix.py` 重新生成 `SOURCE-MATRIX.md`。
3. **每次任务收尾必须执行 `python ../scripts/cleanup.py`** 清理临时文件与陈旧记录（用户约定，已记入项目记忆）。
