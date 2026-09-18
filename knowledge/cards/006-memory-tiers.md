# 知识卡 006 · 记忆分层与压缩

## 结论

1. **core blocks**：身份/偏好/规则，常驻系统提示，原子写  
2. **session transcript**：append-only jsonl，先落盘再谈压缩  
3. **notes / handoff**：跨回合任务状态 ~2k token  
4. **压缩**：优先清旧 tool_result → 再 LLM 摘要；约 70% 窗口软压缩（经验值，可配）  
5. MVP 不做向量；关键词/标签检索足够学习路径  

淘汰出上下文 ≠ 删除磁盘数据。

## 代码落点

- `packages/agent-core/memory/`  
- `assembleContext({ core, notes, recentTurns, retrieved, toolsSchema, headroom })`  
- 评估脚本：重启后能否回忆「偏好/工作区/未完成任务」  

## 风险

非原子写导致记忆「静默清空」；压缩吞掉未决 bug 与文件路径。

来源：findings F4（MemGPT/Letta、Mem0、Anthropic context engineering）
