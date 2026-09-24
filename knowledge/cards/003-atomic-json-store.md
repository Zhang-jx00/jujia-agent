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

正确做法是「写临时文件 → fsync → rename」；反例是原地覆写 config/session/memory —— 一旦中途中断就留下半截 JSON。

## 风险

坏 state + 启动时重放 → 崩溃或卸载无效，是持久化最典型的连带故障。

来源：findings F4（另有内部调研，未随仓库交付）
