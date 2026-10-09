/**
 * 历史气泡的 key（外部审查 T34）。
 *
 * 抽成纯函数的理由：`ChatPanel` 起界面才能测，而"这一页的 key 落不落得进自己那一页"
 * 是一条**算得清楚**的规则 —— 该由单测与变异看着，不该只靠 e2e 里那一次点击。
 *
 * 原先的 key 是 `h-<页内下标>-<role>`，而第二页是**前插**的：两页都从 `h-0-user` 起，
 * React 把它们当成同一个节点复用，翻页时就会出现"内容换了但 DOM 没换"的错位。
 */

export interface HistoryBubble {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

/**
 * @param messages 这一页的原始条目（含不成气泡的那些）
 * @param offset   这一页在**可见历史数组**里的起始下标（服务端给的 `hasMore` 就是它）
 *
 * 序号取的是**原始下标**（被过滤掉的条目照样占一格），所以每一条 key 都必然落在
 * `[offset, offset + messages.length)` 这个区间里 —— 只要两页的区间不重叠，key 就不可能撞车。
 */
export function toHistoryBubbles(
  messages: ReadonlyArray<{ role: string; content: string }>,
  offset: number,
): HistoryBubble[] {
  const out: HistoryBubble[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    out.push({ id: `h-${String(offset + i)}-${m.role}`, role: m.role, content: m.content });
  }
  return out;
}

/**
 * "往前翻这一页到底取到了什么"该怎么说话（外部审查 T33 的后半：口径对齐之后仍会遇到的情况）。
 *
 * 静默是这里的头号风险：一次翻页在界面上看不见任何新气泡，用户分不清"卡了 / 到底了 /
 * 这一页本来就没有对话"，只会反复点。三种情况是三种实话，不合成一句。
 */
export function olderPageNotice(args: { fetched: number; bubbles: number; hasMore: number }): string | null {
  if (args.fetched === 0) return '更早的历史已经读到底了（这一页一条都没有）';
  if (args.bubbles === 0) {
    const tail = args.hasMore > 0 ? '还能继续往前翻' : '这已经是最早的一页';
    return `这一页的 ${String(args.fetched)} 条都不是对话消息（工具输出之类），界面不单独显示 —— ${tail}`;
  }
  return null;
}
