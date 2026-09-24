# 知识卡 002 · 权限请求禁止自动拒绝

## 结论

权限 UI 闪退/并发覆盖 **不得** 被模型侧解释为「用户点击了拒绝」。

- 新权限请求不得 `silent deny` 旧请求 → 使用 **队列**  
- 面板 DOM 缺失 → 错误态，可重试，不是 deny  
- 超时 → `timeout_exhausted` 文案，策略默认拒绝时事件字段必须区分 `user_rejected`  

## 代码落点

- `renderer/features/permission/permissionQueue.ts`  
- `runtime/` 将 decision 传回 loop；未响应不发送「用户拒绝」谎言字段  
- e2e：弹出权限后不操作 10 分钟，断言状态码与文案  

## 风险

审批条闪退（渲染异常、窗口被销毁）后 Agent 任务被误终止，是这类 UI 最典型的连带故障：
用户既没批准也没拒绝，任务却已经死了。

来源：findings F1 权限模式 + F7 权限 UI 文案规范
