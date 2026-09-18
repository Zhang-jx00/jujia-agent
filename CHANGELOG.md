# 变更记录（CHANGELOG）

> 约定：每个阶段或关键改动一条记录，含**时间戳 / 范围 / 改动内容 / 验证方式 / 回退点**。
> 回退点 = git tag 或 commit 短哈希；任何时候可用 `git checkout <tag>` 回到指定版本。
> 阶段划分见 `docs/PLAN.md` §5–6。

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
