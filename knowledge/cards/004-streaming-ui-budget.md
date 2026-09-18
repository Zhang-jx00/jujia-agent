# 知识卡 004 · 流式 UI 性能预算

## 结论

桌面 Agent 卡顿主要来自「每个 token 触发全文重排」：

| 禁止 | 改为 |
|------|------|
| 每次 delta 重写整个 message 的 textContent | 文本节点 `appendData` 增量 |
| 每次滚动算会话 turn 全文 textContent | 缓存 preview；导航不可见不更新 |
| 工具结果全文 innerHTML 重建 | 状态条就地更新 + 展开时懒渲染 + 截断 |
| IPC 每 token 发全量历史 | `{delta, seq}` 小事件 |
| main 同步 fs / sendSync | async + utilityProcess |

批处理：rAF 或 ~32–50ms 合并 delta。

## 代码落点

- `renderer/features/chat/streamRenderer.ts`  
- `packages/agent-core` 只发事件，不碰 DOM  
- Playwright：长流式会话下输入框仍可键入  

## 风险

Yan 1.6 发行说明反复「卡顿」与开源树中 turn-scale/审阅全量 diff 同源。

来源：findings F6 + F7 + Yan 渲染层审阅
