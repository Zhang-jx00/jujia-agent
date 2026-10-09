import { describe, expect, it } from 'vitest';
import { olderPageNotice, toHistoryBubbles } from './history-bubbles';

/**
 * 历史气泡的 key（外部审查 T34）。
 *
 * 为什么要抽成纯函数：`ChatPanel` 依赖 electron 桥，界面级测试要整壳起；
 * 而"这一页的 key 落不落得进自己那一页"是**一条可以算清楚的规则**，
 * 就该由单测与变异看着，不该靠 e2e 里那一次点击。
 */

const msgs = (list: Array<[string, string]>): Array<{ role: string; content: string }> =>
  list.map(([role, content]) => ({ role, content }));

const seq = (bubbles: Array<{ id: string }>): number[] =>
  bubbles.map((b) => Number(b.id.match(/\d+/)?.[0] ?? -1));

describe('toHistoryBubbles', () => {
  it('只留 user / assistant 两类（其余不进气泡，与既有行为一致）', () => {
    const out = toHistoryBubbles(msgs([['user', 'a'], ['tool', 'b'], ['assistant', 'c'], ['system', 'd']]), 0);
    expect(out.map((b) => b.content)).toEqual(['a', 'c']);
    expect(out.map((b) => b.role)).toEqual(['user', 'assistant']);
  });

  it('第二页前插时 key 不许和第一页撞车（页内下标会，带偏移不会）', () => {
    const older = toHistoryBubbles(msgs([['user', 'u1'], ['assistant', 'a1']]), 0);
    const newer = toHistoryBubbles(msgs([['user', 'u2'], ['assistant', 'a2']]), 2);
    const ids = [...older, ...newer].map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('key 里的序号必须落在这一页自己的区间内（跨页因此不可能撞车）', () => {
    // 原始 4 条里只有 2 条成气泡：序号按**原始下标**给，被过滤掉的条目照样占一格
    const page = toHistoryBubbles(msgs([['tool', 't'], ['user', 'u'], ['tool', 't'], ['assistant', 'a']]), 10);
    expect(seq(page)).toEqual([11, 13]);
  });

  it('同一页重取两次，key 必须一模一样（React 靠它复用 DOM，不重挂、不闪）', () => {
    const page = msgs([['user', 'u1'], ['assistant', 'a1']]);
    expect(toHistoryBubbles(page, 5)).toEqual(toHistoryBubbles(page, 5));
  });

  it('空页给空数组（不是 undefined 或抛错）', () => {
    expect(toHistoryBubbles([], 0)).toEqual([]);
  });
});

describe('olderPageNotice：往前翻这一页取到了什么，要能说出来', () => {
  it('整页都是工具输出（一条气泡都没有）→ 必须给一句人看得见的说明', () => {
    const notice = olderPageNotice({ fetched: 12, bubbles: 0, hasMore: 30 });
    expect(notice).not.toBeNull();
    expect(notice).toContain('12');
    expect(notice).toContain('还能继续往前翻');
  });

  it('正常翻到有内容的页 → 不打扰', () => {
    expect(olderPageNotice({ fetched: 10, bubbles: 6, hasMore: 20 })).toBeNull();
  });

  it('一条都没取到（已经读到底）→ 说的是另一句实话，不与上面混成一句', () => {
    const notice = olderPageNotice({ fetched: 0, bubbles: 0, hasMore: 0 });
    expect(notice).toContain('到底');
    expect(notice).not.toContain('12');
  });

  it('最后一页全是不可显示内容 → 说"这是最早的一页"，不许说"还能往前翻"', () => {
    const notice = olderPageNotice({ fetched: 4, bubbles: 0, hasMore: 0 });
    expect(notice).toContain('最早的一页');
    expect(notice).not.toContain('还能继续往前翻');
  });
});
