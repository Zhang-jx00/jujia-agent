---
topic: 流式工具调用（tool_calls）的拼装规则 —— W4 前必读
date: 2026-09-18
phase: W4 前置核实
sources: 见文末来源；均为 2026-09-18 联网检索所得
---

# 011 · 流式 tool_calls 拼装：四个「想当然就会错」的点

> 核实时间：**2026-09-18**（联网检索）。以下规则在多份独立资料中一致出现，
> 是本项目 W4（Agent Loop + 工具调用）实现前必须先锁定的契约。

## 必须遵守的规则

1. **按 `index` 归位，不能按到达顺序 append。**
   `delta.tool_calls` 是一个数组，每项带 `index`。
   正确做法：用 `index` 作为 key 建映射，缺位先补空槽（`{id:'', name:'', arguments:''}`），
   之后再把片段累加进去。若用 append 实现，一旦模型交错返回多个调用就会参数错位。

2. **`function.name` 也要「串接」（`+=`），不能直接赋值。**
   这一点最反直觉——name 在某些端点上同样会被切成多片返回。
   两份资料都把它列为「猜错要花一整个下午」的坑之一。

3. **`arguments` 是分片拼出来的 JSON 字符串，只有在 `finish_reason === 'tool_calls'` 之后才合法。**
   提前 `JSON.parse` 必然抛 `JSONDecodeError`（对象还没闭合）。
   本项目对应做法：累积期间只做字符串拼接，收到结束信号后再统一解析；
   解析失败要作为**可回传模型的错误**（让它自我纠正），而不是崩掉整轮对话。

4. **首帧通常只有 `role`、没有 `content`。**
   「假设每帧都有 content」的朴素写法会在第一帧就出问题（拿不到就跳过即可）。

## 回传消息的三条协议硬约束

来自协议层的约束，违反会被 API 直接拒绝：

- 带 `tool_calls` 的 assistant 消息之后，**必须**为每个 `tool_call_id` 跟一条 `role: 'tool'` 消息；
- `tool` 消息的 `tool_call_id` 必须与 assistant 消息里的 `id` 对上；
- **第二轮请求仍要带 `tools` 参数**，否则模型不知道还能继续调函数。

## 用量统计

- `stream_options: { include_usage: true }` 会在最后一帧返回 `usage`（该帧 `choices` 为空）。
- 它**不是所有兼容端点都支持**：有的网关会忽略，有的对未知顶层字段直接返回 400。
  本项目做法：把它当作「可选增强」，失败不影响主流程；同时兼容部分厂商在普通帧里带 `usage` 的写法。

## 对 W4 的直接结论

- Agent Loop 必须有**迭代上界**（maxTurns）：多份示例都用 `for _ in range(N)` 形式，
  无界循环会在模型反复调工具时把余额烧光。
- 工具参数解析失败 → 生成一条「参数不合法」的工具结果回给模型，让它重试（而不是中止）。
- `finish_reason` 的三种取值必须区分处理：`tool_calls`（继续循环）、`stop`（结束）、
  `length`（被截断，需如实告知用户）。

## 来源（2026-09-18 检索）

- OpenAI 流式工具调用完整示例与常见错误：https://ossaihub.com/code/openai-streaming-tool-calls
- 流式 delta 字段逐项说明（含「name 需串接」「arguments 需等 finish_reason」）：
  https://dev.to/multigrid/streaming-a-response-without-blocking-your-app-2ic4
- 流式 best practices 与工具调用累积示例：
  https://dev.to/shashank_ms_6a35baa4be138/streaming-with-llm-best-practices-and-implementation-guide-2o6l
- 多轮工具调用协议约束（tool_call_id 配对、每轮都要带 tools）：
  https://blog.csdn.net/2401_82819240/article/details/162830378

> 注：以上为工程实践类资料，**官方规范请以各厂商 API 文档为准**；
> 若与官方文档冲突，以官方为准并回来修正本卡片。
