# 生命周期钩子（Hooks）

钩子让你在关键时刻自动跑一次**你自己的程序**：读一个事件 JSON（stdin），回一个 JSON（stdout）。

> **默认关闭。** 钩子是给"知道自己要什么"的人用的自动化 —— 你没打开它，它一次都不会跑。

---

## 一、怎么开

配置在 `hooks.json`（界面「钩子」页可以直接编辑并保存；文件路径在页面上显示）：

```json
{
  "enabled": true,
  "timeoutMs": 60000,
  "maxOutputBytes": 32768,
  "events": {
    "PreToolUse": [
      {
        "matcher": "^write_",
        "hooks": [{ "type": "process", "command": "node", "args": ["D:/hooks/guard.mjs"] }]
      }
    ]
  }
}
```

- `matcher`：**JS 正则字符串**，省略即匹配该事件的全部输入。
- `hooks[].type`：目前只支持 `"process"`（外部命令）。
- `hooks[].timeoutMs`：可覆盖全局超时。
- 校验不通过时**不会落盘**，界面会逐条告诉你哪里错了。

---

## 二、事件

| 事件 | 何时触发 | matcher 的匹配目标 | 已接入运行路径 |
|------|----------|--------------------|----------------|
| `PreToolUse` | 工具执行前（**在权限门之前**） | 工具名 | ✅ |
| `PermissionRequest` | 工具需要你审批时（**在弹窗之前**） | 工具名 | ✅ |
| `PostToolUse` | 工具**成功**后、结果回给模型之前 | 工具名 | ✅ |
| `PostToolUseFailure` | 工具**失败**后 | 工具名 | ✅ |
| `SessionStart` | 会话首轮、首个提示词之前（**每个会话只跑一次**） | 会话来源（当前恒为 `startup`） | ✅ |
| `UserPromptSubmit` | 提示词发给模型之前（拦下时**一次模型调用都不会发生**） | 提示词原文 | ✅ |
| `Stop` | 一轮即将结束时（可要求再走一步，**最多 2 次**） | 会话 id | ✅ |

> **七类事件目前全部已接入运行路径**（界面里的"尚未接入"清单当前为空）。
> 这套标注机制**保留着**：将来新增事件时走「先上契约、后接路径」，未接入的会在界面上明确标出
> "尚未接入运行路径" —— 配了不会生效的事，不能让你自己猜。

> **`SessionStart` 与"续聊"的关系（口径已于 2026-09-27 定稿）**：只有**新会话的第一轮**跑 `SessionStart`。
> 从磁盘把历史会话读回来接着聊（`docs/DESIGN-SESSIONS.md` 的续聊）**不重跑** ——
> 那是**同一个逻辑会话被复活**，重跑会让钩子注入的内容在上下文里**叠加一遍**（同一份项目说明进两次）。
> 需要"每一轮都兜底"的检查请写在 `UserPromptSubmit` 或 `PreToolUse` 里，它们每轮都触发。
> 实现上的落点是 `chat-service` 里那句 `startedHookFired: true`，`session-wiring.test.ts` 有对应的文本锁，
> **改这条语义必须同时改测试与这一段文档**，不许只动代码。

---

## 三、你收到什么 / 你能回什么

**stdin（一个 JSON）**：

```json
{
  "hookEventName": "PreToolUse",
  "sessionId": "8f3c…",
  "cwd": "D:/work/my-project",
  "payload": { "toolName": "write_file", "kind": "write", "args": { "path": "a.txt" } }
}
```

> 大字段会被截断：`args` 里超长字符串截到 2000 字符、`PostToolUse` 的 `result` 截到 4000 字符
> （钩子多半只做判断，不需要完整内容；截断也会在 `resultTruncated` 里标出来）。

**stdout（一个 JSON，可空）**：

```json
{
  "continue": true,
  "reason": "给用户看的理由",
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": "追加给模型的上下文",
    "permissionDecision": "allow",
    "permissionDecisionReason": "为什么放行",
    "updatedInput": { "path": "改过的路径.txt" }
  }
}
```

- `additionalContext`：会被并入工具结果（模型看到的是**同一条**结果，不是另开一条消息）。
- `permissionDecision`：`allow` / `deny` / `ask`。`allow` 会**跳过弹窗**直接执行，
  `deny` 不弹窗直接拒绝。多个钩子给不同决定时**取最严格的一侧**（deny > ask > allow）。
- `updatedInput`：改写工具参数。**改写后会重新过一遍参数校验** —— 钩子不是绕过校验的后门；
  改坏了会被拒绝并说明原因。
- `continue: false`：与退出码 2 同义，请求阻止本次事件。

---

## 四、退出码（重要）

| 退出码 | 含义 |
|--------|------|
| `0` | 正常，按 stdout 的 JSON 处理（空 stdout = 什么都不做） |
| `2` | **显式拒绝**（唯一被赋予"阻断"语义的退出码） |
| 其它 | 记为**失败但**不阻断 |

超时、非 JSON、schema 非法、非 2 的非零退出都**不会阻断**，只会记诊断。

**为什么是 fail-open**：钩子是**附加**防线。写坏的钩子把整个应用变成砖的代价，远大于它拦不住某一次调用的代价 ——
何况主权限门仍然照常生效（该问的还是会问）。但"钩子没跑成"这件事必须**可见**：
诊断会进日志，界面上也能看到配置问题。

---

## 五、安全约束（不会放宽）

1. **以 argv 数组执行，绝不拼 shell 字符串**；
2. 命令与参数里出现 shell 元字符（`| & ; < > \` $` 与换行）**一律拒绝**；
   → 因此请把逻辑写进**脚本文件**（`node guard.mjs`），不要用 `node -e "…"`（分号会被拒）。
3. 钩子拿不到主进程的密钥（密钥不进渲染层、不进模型上下文，也不进钩子输入）；
4. 钩子的失败/超时会被终止（Windows 上 `taskkill /T` 带走整棵进程树），不留孤儿进程。

---

## 六、可复制的例子

**① 记录每次写操作**（`PostToolUse`，只产生副作用，不输出）

```js
let b = '';
process.stdin.on('data', (c) => (b += c));
process.stdin.on('end', () => {
  const i = JSON.parse(b);
  if (i.payload.toolName !== 'write_file') process.exit(0);
  require('node:fs').appendFileSync('D:/logs/writes.log', JSON.stringify(i.payload.args) + '\n');
});
```

**② 危险命令一律拦下**（`PreToolUse`，退出码 2 = 拒绝）

```js
let b = '';
process.stdin.on('data', (c) => (b += c));
process.stdin.on('end', () => {
  const i = JSON.parse(b);
  const target = String(i.payload.args?.path ?? '');
  if (/(^|[\\/])\.env/i.test(target)) {
    process.stdout.write(JSON.stringify({ reason: '.env 文件不许自动写' }));
    process.exit(2); // 显式拒绝
  }
});
```

**③ 把审批策略写成程序**（`PermissionRequest`）

```js
let b = '';
process.stdin.on('data', (c) => (b += c));
process.stdin.on('end', () => {
  const i = JSON.parse(b);
  // 只读且目标是工作区内的普通文件 → 放行（跳过弹窗）
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { permissionDecision: 'allow', permissionDecisionReason: '只读且在工作区内' } }),
  );
});
```
