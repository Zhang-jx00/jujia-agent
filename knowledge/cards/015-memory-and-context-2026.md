---
topic: 2026 记忆与上下文管理：压缩光谱与 AGENTS.md 的正确用法
date: 2026-09-20
phase: W8
sources: 见文末（2026-09-20 联网核实）
---

# 015 · 记忆管理：AGENTS.md 只写「不可见的逻辑」

> 核实时间 **2026-09-20**。以下结论已落进 `packages/agent-core/src/memory/memory.ts`。

## 一、最重要的反直觉结论

**自动生成的上下文文件会降低效果。**
2026 年 ETH Zurich 的研究（Kocetkov et al.）指出：自动生成的项目上下文文件
**使任务成功率下降 2–3%，同时把成本推高 20%+**。
原因是「冗余循环」：如果 agent 自己就能读 `package.json` 和目录结构，
再告诉它「这是一个 React 项目」只是**噪声**——重复的信息不是强化，而是**稀释注意力**。

**推论（本项目的做法）**：
- `AGENTS.md` **由人写**，只写**沉默约束**（例：「`/legacy` 被 CI 依赖，看着没用也别删」）；
- 我们**只读不改**用户的 `AGENTS.md`，绝不自动生成/补全；
- 发现「技术栈介绍」类内容时**给出提示**（`projectContextHints`），但不擅自删改。

## 二、压缩光谱：memory → skills → rules

| 层 | 密度 | 例子 | 用错的代价 |
|----|------|------|-----------|
| Memory（日记） | 事件性、带日期 | 「2026-07-14：选了模拟优先」 | 当小说读 → 噪声 |
| Skills（技能） | 程序性 how-to | 「本仓库怎么开 PR」 | 不验证 → 会腐烂 |
| Rules（规则） | 硬约束、少而锋利 | 「绝不加载主网密钥」 | 什么都是规则 → agent 全忽略 |

**升级梯子**：做过一次 → 写进日记；**同样方式做过三次 → 升为 skill（必须带 verify）**；
**破坏它总会受伤 → 升为规则**（写进 `AGENTS.md`）。
> 反模式：把聊天记录当记忆（context sludge）；skill 没有 verify（仪式化）；
> 50 条规则（等于没有规则）。

## 三、长期记忆的工程形态

- **append-only + 带日期 bullet**（例 `- 2026-06-26: …`），**不是**随便一段总结；
- **硬上限**（业界实践取 200 行 / 25,000 字节），**超出丢最旧**——本项目已照此实现；
- 会话结束时用**一次便宜的模型调用**把整段会话压成**一句话**再追加；
- 定期「压缩重写」：合并重复/被取代的条目，但**保留带日期的 bullet**（保时间线）。

## 四、上下文不够用时，按有效性排序的三种压缩

1. **滚动摘要**（首选）：任务结束后把「改动内容 / 关键决策 / 遗留问题」压成约 200 字，
   **替代原始对话记录**进入长期记忆；
2. **关键代码块摘录**：不把整个 diff 回灌上下文，只留新增/修改的函数签名、注释、关键分支；
3. **检索增强注入**：新任务开始时**不把全部记忆塞回去**，只注入与当前任务最相关的 5–10 个块。
> 类比 LRU 缓存：常用的在眼前，次级的在磁盘，需要时才调回。

**触发阈值（业界实践）**：窗口用量的 **60%** 触发微压缩、**80%** 触发全量压缩；
压缩后用量回落到 **5–10%**，会话得以继续而不是崩掉。

⚠️ **不要做逐行历史压缩**——它会破坏隐藏推理痕迹并让缓存前缀失效。
本项目选择「滚动摘要 + 分层注入」，而不是「逐行砍历史」。

## 五、AGENTS.md 的工程细节

- **递归查找每一级** `AGENTS.md`（root-most first，**最近的优先**），并标注出处 `# From <path>`；
- 篇幅建议 **<300 行，护栏约 600 行**；超限**如实标注截断**，不静默丢；
- 每一行都应回应一个**实际观察到的错误**（Mitchell Hashimoto 的规则）；
- **单一巨型文件是结构缺陷** → 应做上下文**分片**：按任务/角色只给需要的部分
  （BMAD 按角色分片、Spec Kit 按任务分片）。

## 来源（2026-09-20 检索）

- 压缩光谱（memory/skills/rules、升级梯子、每周修剪、反模式）：
  https://www.nyk.dev/blog/memory-skills-rules-compression-spectrum
- 上下文工程实践（AGENTS.md vs 自动记忆、200 行/25KB 上限、skills 渐进披露、
  60%/80% 压缩阈值）：https://www.decodingai.com/p/context-engineering-for-coding-agents
- 上下文截断与工作区记忆锚点（AGENTS.md 每轮注入、行范围切片、token 对比数据）：
  https://www.praveentechworld.com/blog/why-ai-coding-agents-truncate-context-memory-token-optimization
- 长期记忆工程化（SQLite 决策日志 + 向量检索、滚动摘要/摘录/检索增强三种压缩）：
  https://blog.csdn.net/weixin_29237635/article/details/164662215
- **自动生成上下文反而有害**（ETH Zurich 2026：成功率 −2~3%、成本 +20%）与 AGENTS.md 只写沉默约束：
  https://practicaldev.herokuapp.com/aileenvl/stop-burning-tokens-on-redundant-context-why-your-agentsmd-is-failing-3cpn
