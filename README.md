# 俱佳Agent

面向 Windows 的个人桌面编码/助手 Agent（学习项目）。

- **形态**：TypeScript + Electron
- **目标**：系统学习 Agent 全栈知识，并做出属于自己的可运行桌面 Agent

## 目录

| 路径 | 说明 |
|------|------|
| `CHANGELOG.md` | **变更与回退账本**：每阶段的时间戳、改动范围、验证方式、回退点 |
| `docs/PLAN.md` | **开发计划（唯一执行依据，v3）**：目标与范围、选型、架构、模块、阶段任务与验收、风险、设计稿 |
| `docs/LEARNING-MAP.md` | 108 个知识领域的地图与学习顺序 |
| `review/EVALUATION.md` | **需求达成度评估**：此前运行各项要求的达成/未达成明细 |
| `knowledge/` | ★ 统一知识库（索引见 `knowledge/README.md`） |
| `knowledge/SOURCE-MATRIX.md` | 108 领域 × 5 类来源的逐格矩阵（脚本自动生成） |
| `knowledge/sources/` | S1–S11：每领域 T1–T5 五类权威来源 |
| `knowledge/findings/` | 深调研原始证据 F1–F8 + FYAN（quote/URL/confidence） |
| `knowledge/cards/` | 知识卡片：对俱佳Agent 的落地决定 |
| `apps/desktop/` | Electron 桌面端（`src/main` · `src/preload` · `src/renderer`） |
| `packages/shared/` | 通用基础设施：原子 JSON 存储 `json-store`（tmp+fsync+rename+`.bak`+version 信封+损坏自愈） |
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
