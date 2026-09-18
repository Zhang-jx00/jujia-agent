# 知识卡 003 · JSON 状态原子写

## 结论

`config.json` / `sessions/*` / `memory/*` 一律 **tmp + rename** 写入；解析失败：

1. 备份坏文件（`*.bak.<ts>`）  
2. **禁止** 静默清空后当默认配置保存（会毁掉 API Key/会话）  
3. UI 提示「配置损坏，已备份，是否从备份恢复」  

## 代码落点

```ts
// packages/shared/json-store
atomicWriteJSON(path, value) // write tmp → fsync → rename
readJSONSafe(path) // { ok, data, raw?, error? }
```

Harness/skill-store 已有正确范例（Yan `continual-harness.js`）；config/session/memory 是反例。

## 风险

Issue #4 同类：坏 state + 启动重放 → 崩溃/卸载无效。

来源：findings F4 + Yan 优化报告 S1–S3
