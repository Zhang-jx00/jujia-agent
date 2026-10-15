# 设计口径 · 流是怎么结束的（T55 / T56 · R31）

> **这一页管什么**：上游"没说完"与"说完了"这两件事，我们到底凭什么判、判了之后谁该说什么话。
> 涉及三层：provider（`streamChat`）→ 循环（`agent-loop`）→ 界面（`done-notice` 那张穷举表）。
> 加进本轮的原因：2026-10-09 深度审计的 T55 / T56 两条一直挂着，卡点都是"要先定兼容口径"。
> **口径由我在 R31 定**（不动安全语义，不属四类停牌），这一页就是那份定稿。

---

## 一、病根：把"没听说结束"当成"说完了"

`openai-compat.ts` 里原来是这样开头的：

```ts
let finishReason: FinishReason = 'stop';
```

而**全文件没有任何一处记录"到底有没有收到过 finish_reason"**。于是两条收尾路径
（收到 `[DONE]` / 服务端直接把流关了）都拿这个**初值**当结论：

- 代理的 `proxy_read_timeout` 到点 `res.end()` —— 上游一个字都没交代；
- 我们的 `done` 事件却报 `reason: 'stop'`；
- 循环看 `reason === 'stop'` 且 `truncated === null`，`chat-service` 把 `resolved` 定成 `'stop'`；
- 界面一句都不说。**半截回答与完整回答在界面上长得一模一样。**

这是本项目最忌讳的那一类的**加强版**：不是静默失败（至少还报错），而是**静默成功**。
T26 那套 `length` / `content_filter` 的区分全程不触发 —— 因为那些需要上游**说话**，
而这里上游什么都没说。

同一枚硬币的另一面是 **T56**：`ToolCallAccumulator.finish()` 以前**不知道流是怎么结束的**，
看见 `arguments` 为空就当"无参工具的合法空对象"。网关发了
`{"name":"write_file","arguments":""}` 之后断流 ⇒ `parseError` 为 null ⇒ `{}` 交给 `run_tool`
⇒ 用户看见"工具执行成功"，而**参数从未被传过来**。

---

## 二、口径：结束证据有**两种**，有一种就算写完

判"写完"不能靠猜上游的习惯，只能靠**看到的标记**。OpenAI 兼容协议里有两条独立的收尾约定：

| 证据 | 谁会给 | 单独出现算不算写完 |
| --- | --- | --- |
| `data: [DONE]` | 协议规定的收尾帧，几乎所有端点都给 | **算** |
| 任何 `finish_reason`（含厂商自造的未知值） | 最后一帧的 `choices[0].finish_reason` | **算**（未知值按 `stop` 收尾，T26 的口径不推翻） |
| 两条都没有，流自己结束了 | 代理超时 `res.end()` / 网关崩了 / 服务端硬关 | **不算** —— 新增一态 `no_end_marker` |

**为什么不选"一律判截断"**（这是更简单的那条路）：有一批自建端点与网关
**从不发 `finish_reason`、只在最后给一个 `[DONE]`**。把它们一律打成"回答不完整"，
用户看到的是一条没必要的警告，代价是这批厂商直接不可用。
**兼容面因此被写成三条正面用例**（`openai-compat.test.ts` 的"结束标记的可信度"那一组）：
只给 `[DONE]` / 只给 `finish_reason` / 给未知原因 —— 三种都**不许**报警。

**为什么不选"照旧算写完"**：那等于承认"我们区分不了"，然后替上游撒一个谎。

取舍说到底是：**能判定时才说，判不出时把"判不出"本身说出来。**

### T56 的取值

空参数只在**有结束证据**时才当零参。没有结束证据时，"这个工具本来无参"与
"参数还没送到"这两种情况**分不出来** —— 于是选副作用小的那边：**拒绝执行并说清原因**，
而不是猜一个空参数去写文件。代价如实写在这里：
一个"从不发结束标记、且调用无参工具时省略 `arguments`"的网关，这一轮会被拒一次
（模型收到 `[invalid_args]` 后会重试）。这是刻意偏向保守的那一侧。

---

## 三、判定只写在一处，两条收尾路径共用

```ts
const endOfStream = (): StreamEnd => {
  if (!sawFinishReason && !sawDoneMarker) return 'no_end_marker';  // 先问证据
  if (toolCalls.hasCalls()) return 'tool_calls';
  return finishReason;
};
```

**顺序是这条设计里最容易写错的一格**：先问 `hasCalls()` 的话，"空参数的调用 + 断流"
会拿到 `tool_calls` 这个结论，拼装器据此认为"有结束标记"，把 `{}` 放行 ——
T56 的洞原样留着。`openai-compat.test.ts` 里那条"空参数的工具调用 + 没有任何结束标记"
就是专门钉这个顺序的闸（红证：把两行调换，它当场红）。

`endOfStream()` 只有一处定义，`[DONE]` 那条路与"流自己结束"那条路都调它 ——
与 T25 的 `assertProduced` 同一条纪律：**两条收尾路径不许各写一份"算不算成功"**。

---

## 四、新增一态要动的五处（缺一处就是静默）

| 环 | 落点 | 掉出去的后果 |
| --- | --- | --- |
| provider 判据 | `openai-compat.ts` 的 `sawFinishReason` / `sawDoneMarker` / `endOfStream()` | 半截回答报 `stop` |
| 类型 | `types.ts` 的 `StreamEnd` 与 `TruncationReason = Exclude<StreamEnd, 'stop' \| 'tool_calls' \| 'aborted'>` | 循环与界面各抄一份字面量，将来加第三种原因就分叉 |
| 循环 | `agent-loop.ts`：`ev.reason !== 'stop' && ev.reason !== 'tool_calls'` → `truncated` | 新态被归并进"正常写完" |
| 契约 | `contracts.ts` 的 `DONE_END_REASONS` 增员 | 主进程的话传不到界面（`preload` 会 `safeParse` 掉） |
| 界面 | `done-notice.ts` 的穷举表 `DONE_REASON_NOTICE` | **编译不过**（缺键的 `Record` 是类型错误）—— T58 那张表的价值就在这里 |

`truncated` 而不是 `reason`：这一格是"文本没完整交出来"的**独立事实**，
挤进 `reason` 会把"用户中止 / 出错 / 停在工具处"那几格挤糊（T26 的原话）。

---

## 五、锁与证据（谁盯着这条线）

- **单测**：`openai-compat.test.ts`（T55 三条兼容 + 一条新态 + 顺序闸；T56 两态对照）、
  `tool-call-accumulator.test.ts`（`finish(end)` 的拒与放）、
  `agent-loop.test.ts`（`truncated` 独立成格）、`done-notice.test.ts`（键集合与契约双向对账）。
- **界面级**：e2e 第 **[65]** 步 —— 真窗口里发 `E2E_NOMARKER`（服务只吐半句就 `res.end()`），
  界面上必须出现"没有给出结束标记"那句，且**半截内容不许被丢**；
  再发 `E2E_EMPTYARGS`（空参数调用 + 无标记），必须出现 `[invalid_args]` 那句拒执行。
- **源锁**：`truncation-wiring.test.ts` 这一轮**换了判据**（旧写法抄字面量清单，
  合法新增一态时当堂红两次）：现在钉的是"循环按除两种之外判"与
  "循环能带出的每种原因，契约里都得有那一格（现扫 `StreamEnd` ∪ `FinishReason` 对账）"；
  `stream-event.test.ts` 那条 T58 的"成员清单就是那五个"也换成了**出处对账**
  （每个契约成员必须能在源码里指出谁会发它，说不出出处 = 死成员）。
- **变异**：M298 起（见 `review/mutations.json`），盯 `sawDoneMarker` 被删、
  `endOfStream()` 顺序被换、`finish()` 的拒绝分支被放宽、穷举表那格的文案被抹、
  `DONE_END_REASONS` 里那一格被摘。

---

## 六、随批清掉的两条（同属"话说了一半"）

1. **T57①**：三条早退路径只 `releaseLock()` 不 `cancel()` —— `releaseLock` 只是"我不再读了"，
   `cancel()` 才是"这条流我不要了"。改成 `finally` 一处 `await reader.cancel().catch(...)`，
   清理动作自己报错不许盖掉真正的退出原因。
2. **T57②**：`network_error` 的文案只取 `err.message`。undici 给的是 `TypeError: fetch failed`，
   真原因（`ECONNREFUSED` / `CERT_HAS_EXPIRED` / `SocketError`）在 `cause` 上 ——
   判定链早就沿 `cause` 走四层，**文案却没走**，于是五种故障在界面上是同一句话。
   新增 `causeText()`：原话一个字不丢，真原因**追加**在括号里，仍过 `presentable`（剔密 + 截上界）。

**T57③ 没做，也不该在这轮做**：全仓没有 `child-process-gone` 处理器。
这与"utilityProcess 迁移评估"是同一题 —— 今天工具与钩子都在主进程/子 shell 里，
没有 utilityProcess 子进程可退场。加处理器不是修缺陷，是替一个架构决定先动代码，
因此登记为**评估项**（见 `docs/TRACK-ROADMAP.md` §4.1 T57 行），不动代码。
