/**
 * 历史分页的**唯一口径**（外部审查 T33）。
 *
 * 为什么要有这个文件：`chat-service` 依赖 electron，vitest 里加载不了（同 6a 把
 * `session-journal.ts` 抽出去的理由）。而 T33 这条 bug 的形状是"同一个 sessionId 有两份
 * 共几条的答案"：驻留数组的 index 0 是每轮重装配的 system，磁盘数组没有它 ——
 * 于是 `total` / `hasMore` 差 1。实测两条后果：
 * ① 盘上整页数时 `hasMore = 1`，界面上"再读 1 条"点开只拿到那条 system、
 *    被气泡过滤掉 = **按钮没反应**；
 * ② 续聊按磁盘口径记下 `before`，发第一条消息触发 hydrate、system 被前插，
 *    `loadOlder` 拿**旧口径的下标**去查**新数组** → 有一条历史永远跳过、再也看不到。
 *
 * 修法不是给两处各补一个 `-1`（那是把同一个判断写两遍，正是这次的病根），
 * 而是**窗口与计数只在这一个地方按同一个数组算**：界面的历史 = 去掉开头那条 system。
 */

export const HISTORY_PAGE_DEFAULT_LIMIT = 120;
export const HISTORY_PAGE_MIN_LIMIT = 1;
export const HISTORY_PAGE_MAX_LIMIT = 400;

export interface HistoryPageResult<T> {
  messages: T[];
  /** 可见历史的条数（不含开头那条 system）—— 界面拿它当"共几条" */
  total: number;
  /** 这一页之前还有多少条没读；同时是下一次往前翻的 `before` */
  hasMore: number;
}

export function clampHistoryLimit(limit: number | undefined): number {
  const raw = limit ?? HISTORY_PAGE_DEFAULT_LIMIT;
  return Math.min(Math.max(raw, HISTORY_PAGE_MIN_LIMIT), HISTORY_PAGE_MAX_LIMIT);
}

/**
 * 剥掉的**只有开头那条** system。
 * 历史中间出现的 system（若哪天有）是对话内容的一部分，不许跟着一起少算一条。
 */
export function historyWindow<T extends { role: string }>(messages: readonly T[]): T[] {
  const first = messages[0];
  return first !== undefined && first.role === 'system' ? messages.slice(1) : messages.slice();
}

export function pickHistoryPage<T extends { role: string }>(
  raw: readonly T[],
  opts: { limit?: number | undefined; before?: number | undefined },
): HistoryPageResult<T> {
  const all = historyWindow(raw);
  const limit = clampHistoryLimit(opts.limit);
  const end = Math.min(opts.before ?? all.length, all.length);
  const start = Math.max(end - limit, 0);
  return { messages: all.slice(start, end), total: all.length, hasMore: start };
}
