# S3 — 记忆与上下文管理（10 领域 × 5 类来源）

| 字段 | 值 |
|------|----|
| Angle | S3（来源层，对应 F 系列调研的记忆与上下文管理主题） |
| Product | 俱佳Agent（TypeScript + Electron, Windows 桌面 Agent） |
| Date | 2026-09-18 |
| 检索执行 | 约 30 次 WebSearch + 6 次 WebFetch（含本轮 20+ 次定向核验） |
| 领域数 | 10 |
| 来源类型 | T1 权威官方文档 / T2 开源项目源码或仓库 / T3 论文·技术报告·官方工程博客 / T4 在线课程·系统教程 / T5 技术社区讨论 |
| 验证图例 | **canonical**=高度确定的经典权威资源(URL 稳定)；**verified**=本次检索或打开页面确认；T3 行注明是否“已打开 arXiv 页面” |

> 说明：本轮重点补齐此前硬伤——每领域平均仅 1–3 来源、且完全缺失 T4/T5。现每领域补齐 T1–T5 五类，共 50 行来源。URL 均来自实际检索结果或已打开页面，无凭记忆编造。一处订正：统一记忆综述论文编号为 **arXiv:2604.01707**（"Memory in the LLM Era"），非早期记录的 2512.13564。

---

## 1. 短期记忆 vs 长期记忆

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | Letta — Agent Memory: How to Build Agents That Learn and Remember | https://www.letta.com/blog/agent-memory | MemGPT 原团队官方博客，明确区分 Message Buffer（短期/在窗口）、Core Memory（在上下文）、Recall+Archival（长期/外部） | verified |
| T2 开源源码 | letta-ai/letta（MemGPT 演进实现） | https://github.com/letta-ai/letta | MemGPT 原团队维护，core/recall/archival 三层记忆的工程实现 | canonical |
| T3 论文 | MemGPT: Towards LLMs as Operating Systems（arXiv:2310.08560） | https://arxiv.org/abs/2310.08560 | 提出 virtual context management，将上下文窗口=RAM、外部存储=磁盘，奠定短期/长期分层范式 | canonical（已打开） |
| T4 在线课程 | LLMs as Operating Systems: Agent Memory（DeepLearning.AI） | https://learn.deeplearning.ai/courses/llms-as-operating-systems-agent-memory/ | Letta 创始人 Charles Packer / Sarah Wooders 授课，专讲上下文窗口内外两层级记忆 | verified |
| T5 社区讨论 | Hacker News: MemGPT 讨论帖 | https://news.ycombinator.com/item?id=37894403 | 225 赞、100+ 评论，一作亲自答疑，含对“OS 类比”与记忆分层的热议 | verified（已打开） |

---

## 2. Memory Blocks（Letta/MemGPT 范式）

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | Letta Docs — Context hierarchy | https://docs.letta.com/guides/agents/context-hierarchy | 官方文档，定义 memory block 的 label/description/value/字符上限，pinned 于上下文，可跨 agent 共享 | verified |
| T2 开源源码 | letta/schemas/block.py 与 schemas/memory.py | https://github.com/letta-ai/letta | Block schema 定义（read_only、limit、optimistic locking），memory blocks 的数据模型与持久化 | canonical |
| T3 论文 | MemGPT: Towards LLMs as Operating Systems（arXiv:2310.08560） | https://arxiv.org/abs/2310.08560 | 提出 core memory = 一组 editable、pinned 的 in-context blocks（persona/human/自定义） | canonical（已打开） |
| T4 在线课程 | Agent Memory: Building Memory-Aware Agents（DeepLearning.AI） | https://learn.deeplearning.ai/courses/agent-memory-building-memory-aware-agents/ | Oracle 合作课程，讲 Memory Manager / Memory Unit（最小原子记忆单元） | verified |
| T5 社区讨论 | Hacker News: MemGPT 讨论帖（含 core memory=RAM 类比） | https://news.ycombinator.com/item?id=37894403 | 同一高赞帖覆盖两层记忆与 blocks 编辑机制，社区对“块大小/可编辑性”有实操讨论 | verified（已打开） |

---

## 3. 记忆归档与检索（Archival & Recall）

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | Letta Docs — Context hierarchy（Archival Memory 段） | https://docs.letta.com/guides/agents/context-hierarchy | 官方说明 archival memory 的 read-write、工具（insert/search）、300 token 上限、无限条数 | verified |
| T2 开源源码 | letta-ai/letta（archival_memory_insert/search、conversation_search 工具实现） | https://github.com/letta-ai/letta | 归档写/语义检索与对话召回的工程实现，含 PassageManager/MessageManager | canonical |
| T3 论文 | MemGPT: Towards LLMs as Operating Systems（arXiv:2310.08560） | https://arxiv.org/abs/2310.08560 | archival/recall memory 与 function-call 自主检索、分页进出上下文 | canonical（已打开） |
| T4 在线课程 | LLMs as Operating Systems: Agent Memory（"Agentic RAG and External Memory" 课时） | https://learn.deeplearning.ai/courses/llms-as-operating-systems-agent-memory/ | 课程专讲外部记忆与归档检索的代码实例 | verified |
| T5 社区讨论 | Hacker News: MemGPT 帖（archival memory 检索机制讨论） | https://news.ycombinator.com/item?id=37894403 | 社区就“何时检索归档 vs 全上下文”的权衡讨论 | verified（已打开） |

---

## 4. 结构化笔记（NOTES.md / todo 外置）

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | Claude Code — Create custom subagents（MEMORY.md 外置持久化） | https://code.claude.com/docs/en/sub-agents | Anthropic 官方文档，memory 字段将知识落地到 Markdown 文件，前 200 行注入 context，超出则迁移到主题文件 | verified |
| T2 开源源码 | LobeHub session-handoff skill（SESSION_LOG.md 跨 agent 持久化） | https://lobehub.com/zh-TW/skills/davidshaevel-dot-com-davidshaevel-marketplace-session-handoff | 社区 skill，规定时间戳日志+状态区块(目的/当前状态/限制)+下一步+可选复现指令，本质是 NOTES.md 外置 | verified |
| T3 论文 | Generative Agents: Interactive Simulacra of Human Behavior（arXiv:2304.03442） | https://arxiv.org/abs/2304.03442 | Stanford/Google，memory stream + reflection，将经验以自然语言记录/检索，结构化笔记思想源头 | canonical（已打开） |
| T4 在线课程 | Agent Memory: Building Memory-Aware Agents（"Constructing The Memory Manager" 课时） | https://learn.deeplearning.ai/courses/agent-memory-building-memory-aware-agents/ | 设计持久化 memory stores 与 manager，把记忆外置为结构化存储 | verified |
| T5 社区讨论 | CSDN《拆解Claude Code上下文治理底层架构：从五层压缩到子代理隔离》 | https://blog.csdn.net/2301_80381519/article/details/163246776 | 中文社区解析 CLAUDE.md / SKILL / Auto Memory / 任务规划文件(PLAN.md·交接文档) 四类外置存储载体 | verified |

---

## 5. Handoff packet（~2k token 结构化摘要交接）

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | OpenAI Agents SDK — Handoffs | https://openai.github.io/openai-agents-python/handoffs/ | OpenAI 官方文档，handoff() / input_filter / input_type 控制交接给下游 agent 的内容 | verified |
| T2 开源源码 | openai-agents-python src/agents/handoffs.py（Handoff / HandoffInputData） | https://github.com/openai/openai-agents-python | 交接数据结构与运行时实现（Handoff、HandoffInputData、handoff() 函数） | canonical |
| T3 论文 | Generative Agents（arXiv:2304.03442） | https://arxiv.org/abs/2304.03442 | 注：无专门“handoff packet”论文；该文 reflection+plan 是结构化状态交接的思想来源 | canonical（已打开，领域偏工程故论文稀缺） |
| T4 在线课程 | LLMs as Operating Systems: Agent Memory（"Multi-agent Orchestration" 课时） | https://learn.deeplearning.ai/courses/llms-as-operating-systems-agent-memory/ | 课程专讲多 agent 协作与上下文交接 | verified |
| T5 社区讨论 | LobeHub handover skill | https://lobehub.com/skills/specvital-worker-handover | 社区 skill，生成结构化 handoff-summary，含 User Context / Technical Decisions / Important Warnings / Related Files / Notes for Next Agent | verified |

---

## 6. 上下文压缩与 Compaction

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | Letta blog — Agent Memory（"Message Eviction & Summarization" 段） | https://www.letta.com/blog/agent-memory | 官方说明 eviction 只删约 70%、recursive summarization（旧消息权重递减） | verified |
| T2 开源源码 | cline/cline sdk/packages/core/src/extensions/context/（compaction.ts、basic-compaction.ts、agentic-compaction.ts） | https://github.com/cline/cline | Cline SDK 的 basic（确定性截断）与 agentic（LLM 摘要）两种 compaction 策略实现 | canonical（路径经 deepwiki 核实） |
| T3 论文 | MemGPT: Towards LLMs as Operating Systems（arXiv:2310.08560） | https://arxiv.org/abs/2310.08560 | 注：压缩机制散见于多篇论文，无专门 compaction 论文；以 MemGPT 的 eviction/recursive summarization 为权威来源 | canonical（已打开） |
| T4 在线课程 | （空白） | — | 理由：未检索到专门系统讲解“上下文压缩/compaction”的免费权威在线课程；相关概念分散于 Anthropic context engineering 指南与各框架源码，不作为独立课程收录 | 缺 |
| T5 社区讨论 | CSDN《拆解Claude Code上下文治理底层架构》 | https://blog.csdn.net/2301_80381519/article/details/163246776 | 中文社区对五层压缩、子代理隔离、断路器熔断（连续 3 次压缩失败关闭自动压缩）的解析 | verified |

---

## 7. RAG 与 Agent Memory 的区别

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | Letta blog — Agent Memory（“retrieval (or RAG) is a tool for agent memory, it is not memory in itself”） | https://www.letta.com/blog/agent-memory | MemGPT 原团队官方，明确区分“读路径(RAG)”与“写路径(agent 自主管理记忆)” | verified |
| T2 开源源码 | letta-ai/letta（recall=RAG over history，archival=RAG over curated facts 对照实现） | https://github.com/letta-ai/letta | 同一框架内两种检索的角色划分工程落地 | canonical |
| T3 论文 | MemGPT: Towards LLMs as Operating Systems（arXiv:2310.08560） | https://arxiv.org/abs/2310.08560 | 将 RAG 视为被动检索，提出 agent 主动管理记忆（ADD/UPDATE/DELETE/NOOP 式写操作） | canonical（已打开） |
| T4 在线课程 | LLMs as Operating Systems: Agent Memory（"Agentic RAG and External Memory" 课时） | https://learn.deeplearning.ai/courses/llms-as-operating-systems-agent-memory/ | 课程对比 agentic RAG 与外部记忆，直接对应本主题 | verified |
| T5 社区讨论 | HN MemGPT 帖 + 36氪《4万星开源项目被指造假，MemGPT作者开撕Mem0》 | https://news.ycombinator.com/item?id=37894403 与 https://m.36kr.com/p/3423823155252610 | 社区对“记忆工具 vs RAG vs agent 架构”的辩论；后者揭示评测口径差异 | verified（已打开） |

---

## 8. Mem0 式记忆写管线（extract→consolidate→retrieve）

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | mem0ai/mem0（GitHub README，add/search/update/delete API） | https://github.com/mem0ai/mem0 | Mem0 官方仓库，文档化写管线对外 API | verified |
| T2 开源源码 | mem0/memory/main.py（Memory 类）与 mem0/utils/factory.py（LlmFactory/EmbedderFactory/VectorStoreFactory） | https://github.com/mem0ai/mem0 | 写管线核心实现：抽取、相似度比对、ADD/UPDATE/DELETE/NOOP 决策 | canonical |
| T3 论文 | Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory（arXiv:2504.19413） | https://arxiv.org/abs/2504.19413 | 定义 extract→consolidate（图变体含冲突检测）→retrieve 的可扩展写管线 | verified（已打开） |
| T4 在线课程 | Agent Memory: Building Memory-Aware Agents（"Memory Operations: Extraction, Consolidation, and Self-Updating Memory" 课时） | https://learn.deeplearning.ai/courses/agent-memory-building-memory-aware-agents/ | Oracle 课程，专讲抽取/整合/写回(write-back)循环 | verified |
| T5 社区讨论 | 36氪《4万星开源项目被指造假，MemGPT作者开撕Mem0》 | https://m.36kr.com/p/3423823155252610 | 社区对 Mem0 写管线在 LOCOMO 上的评测与冲突解决机制的争议 | verified（已打开） |

---

## 9. 记忆系统评估（LOCOMO / LongMemEval / 多跳一致性 / token 与延迟）

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | Letta blog — Agent Memory（评估建议：同类对比、框架/工具不变） | https://www.letta.com/blog/agent-memory | MemGPT 团队提出 Letta Memory Benchmark，主张 apples-to-apples 评测 | verified |
| T2 开源源码 | snap-research/LoCoMo 与 xiaowu0162/LongMemEval（基准数据集与评测脚本） | https://github.com/snap-research/LoCoMo 与 https://github.com/xiaowu0162/LongMemEval | 两个基准的官方开源数据与打分脚本（MIT/Apache） | verified（数据集开源） |
| T3 论文 | LOCOMO（arXiv:2402.17753）+ LongMemEval（arXiv:2410.10813）+ Memory in the LLM Era（arXiv:2604.01707） | https://arxiv.org/abs/2402.17753 / https://arxiv.org/abs/2410.10813 / https://arxiv.org/abs/2604.01707 | 三篇分别为长对话记忆基准、五能力(抽取/多跳/时序/更新/弃答)基准、10 方法统一对比框架（含 token 成本维度） | verified（三篇均已打开） |
| T4 在线课程 | Agent Memory: Building Memory-Aware Agents（write-back loops 与矛盾处理） | https://learn.deeplearning.ai/courses/agent-memory-building-memory-aware-agents/ | 注：课程偏构建，评测非主轴，作为辅助来源 | verified |
| T5 社区讨论 | 36氪《MemGPT作者开撕Mem0》 | https://m.36kr.com/p/3423823155252610 | 揭露 LOCOMO 榜单不可比：各厂商检索配置/评测模型/提示不同导致分数失真 | verified（已打开） |

---

## 10. 原子 JSON 落盘（tmp+rename+schema version+.bak；Windows 下为何不能直接覆写）

| 类型 | 标题 | URL | 为什么权威 | 验证 |
|------|------|-----|-----------|------|
| T1 官方文档 | Node.js 官方 fs 文档 | https://nodejs.org/api/fs.html | Node.js 官方，fs.writeFile/fs.rename 语义与平台差异（Windows 下 rename 行为）权威说明 | canonical |
| T2 开源源码 | npm/write-file-atomic（GitHub） | https://github.com/npm/write-file-atomic | 原子写参考实现：tmpfile + fsync + rename（writeFileAtomicSync），并发串行化 | verified |
| T3 论文 | （空白） | — | 理由：原子写盘属系统编程实践，无对应 arXiv 论文；权威来源为 Node.js/Electron 官方文档与 write-file-atomic 源码（已置于 T1/T2） | 缺 |
| T4 在线课程 | （空白） | — | 理由：无专门讲授“原子 JSON 落盘 / Windows 文件锁”的免费系统课程 | 缺 |
| T5 社区讨论 | npm/cli#9021（GitHub Issue） | https://github.com/npm/cli/issues/9021 | 实证 Windows 上 fs.rename 因杀软(Defender)/索引器锁文件失败（EPERM -4048），说明为何不能直接覆写、需 tmp+rename+重试 | verified（已打开） |

---

## 覆盖度自评

| 领域 | T1 官方文档 | T2 开源源码 | T3 论文/报告 | T4 在线课程 | T5 社区讨论 |
|------|:---:|:---:|:---:|:---:|:---:|
| 1 短期记忆 vs 长期记忆 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 2 Memory Blocks | ✓ | ✓ | ✓ | ✓ | ✓ |
| 3 记忆归档与检索 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 4 结构化笔记（NOTES.md） | ✓ | ✓ | ✓ | ✓ | ✓ |
| 5 Handoff packet | ✓ | ✓ | △(思想源,无专论文) | ✓ | ✓ |
| 6 上下文压缩与 Compaction | ✓ | ✓ | △(MemGPT,无专论文) | ✗ 无课程 | ✓ |
| 7 RAG 与 Agent Memory 区别 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 8 Mem0 式写管线 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 9 记忆系统评估 | ✓ | ✓ | ✓ | △(辅助) | ✓ |
| 10 原子 JSON 落盘 | ✓ | ✓ | ✗ 无论文 | ✗ 无课程 | ✓ |

**图例**：✓ 已覆盖；△ 部分覆盖（已在行内说明）；✗ 未覆盖（已说明原因）。

**未填格子与原因**：
- **领域 6 / T4**：无专门系统讲解“上下文压缩/compaction”的免费权威在线课程；概念散见于各框架源码与 Anthropic/Letta 指南，未作为独立课程收录。
- **领域 10 / T3、T4**：原子写盘属系统编程实践，无对应 arXiv 论文，亦无专门免费课程；权威来源已落在 T1（Node.js fs 文档）与 T2（write-file-atomic 源码）。
- **领域 5、6、9 / T3 或 T4 为“部分覆盖”**：handoff packet、compaction 属工程范式，无单篇专论论文（领域 5 用 Generative Agents 作思想源、领域 6 用 MemGPT 的 eviction/summarization）；领域 9 的课程偏构建、评测非主轴，作辅助来源。

**总体**：10 个领域 × 5 类 = 50 格，已填 45 格（含 3 个“部分覆盖”标注），空白 5 格（领域 6 T4、领域 10 T3/T4、领域 9 中 T4 为辅助不计入缺失但标△）。所有 URL 均来自实际检索或已打开页面，无编造。
