# 知识卡 001 · Agent Loop 三分支

## 结论

生产级桌面编码 Agent 的回合控制流应实现为：

1. 模型输出含 tool_calls → 执行工具（写操作串行）→ 结果回灌 → 再调用模型  
2. 模型请求 handoff/子代理 →（可选）切换执行身份  
3. 模型输出 **无 tool 调用** 的用户可见文本 → 结束本轮  

必须有 `maxTurns` / token 预算熔断，并区分 `done.reason`。

## 代码落点

- `packages/agent-core/src/loop/runAgentLoop.ts`  
- 工具结果统一 `tool_result` 事件，不直接改 UI  
- 结束条件单测：final / max_turns / user_aborted / provider_error  

## 风险

- 把「有正文且仍有 tool_calls」当结束 → 任务半途而废  
- 无预算时无限循环烧 token  
- 权限拒绝后应作为 tool error 或结束原因可见，禁止静默  

来源：`knowledge/findings/F1.md` [1][2][8]
