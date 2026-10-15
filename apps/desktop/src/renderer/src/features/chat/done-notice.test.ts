import { DONE_END_REASONS, type DoneEndReason } from '@jujia/shared-ipc';
import { describe, expect, it } from 'vitest';
import { DONE_REASON_NOTICE, truncationNotice } from './done-notice';

/**
 * "这一轮到底是怎么结束的"在界面上的一句话（外部审查 T26 的后半）。
 *
 * 判据本身在 provider 与循环里，这里只管**说出来**：
 * 截断不是"正常写完"，也不是"出错了" —— 三句话必须能分开，否则用户会把半截答案当成完整答案。
 */
describe('truncationNotice', () => {
  it('length：说清是长度上限掐的，并给出下一步能做什么', () => {
    const notice = truncationNotice('length');
    expect(notice).not.toBeNull();
    expect(notice).toContain('长度上限');
    expect(notice).toContain('max_tokens');
  });

  it('content_filter：说清是上游拦的，不是模型写完了', () => {
    const notice = truncationNotice('content_filter');
    expect(notice).not.toBeNull();
    expect(notice).toContain('内容过滤');
    expect(notice).toContain('不完整');
  });

  it('stop / aborted / error 不在这里说话（各有各的显示，重复说会互相盖）', () => {
    for (const reason of ['stop', 'aborted', 'error'] satisfies DoneEndReason[]) {
      expect(truncationNotice(reason), reason).toBeNull();
    }
  });

  /**
   * T58：界面这张表与契约**必须一字不差地对上**。
   *
   * 这条断言是双向的，两个方向各治一种漂移：
   * - 表里有、契约里没有 = 界面在编一个上游不会发的说法（旧 `tool_calls` 分支就是这一类）；
   * - 契约里有、表里没有 = 编译期先拦（缺键的 `Record` 是类型错误），这条再钉一遍运行期，
   *   因为"用 `as` 绕过类型"也是人写得出来的。
   */
  it('说明表的键集合 == 契约的结束原因集合（新增成员不补表就编译不过，这里再对一次账）', () => {
    expect(Object.keys(DONE_REASON_NOTICE).sort()).toEqual([...DONE_END_REASONS].sort());
  });

  it('契约之外的值说不出话也不崩（兜底是 null，不是另一条原因的说法）', () => {
    expect(truncationNotice('tool_calls' as DoneEndReason)).toBeNull();
    expect(truncationNotice('没见过的东西' as DoneEndReason)).toBeNull();
  });

  /**
   * T55（R31）新增的那一态。这句话是整条修复的**落点**：
   * provider 分得出 `no_end_marker`、循环带得出 `truncated`、契约传得过来，
   * 而如果这里给 `null`，界面上半截回答与完整回答**还是一模一样** —— 前面四环全白做。
   * 所以这里不只要"有话说"，还要钉住它说了三件具体的事：
   * ① 上游没给结束标记（**是谁没说清**，不是模型的错）；② 可能不完整（**别当写完用**）；
   * ③ 已经吐出来的内容都还在（**不是报错、内容没丢** —— 少了这句，用户会以为这一轮白跑）。
   */
  it('no_end_marker：说清"没给结束标记 + 可能不完整 + 内容还在"（T55 的落点）', () => {
    const notice = truncationNotice('no_end_marker');
    expect(notice).not.toBeNull();
    expect(notice).toContain('结束标记');
    expect(notice).toContain('可能不完整');
    expect(notice).toContain('已经吐出来的内容都还在');
  });

  it('三种"没完整交出来"各有各的说法（共用一句就等于没分：截断 / 被拦 / 没交代）', () => {
    const three = ['length', 'content_filter', 'no_end_marker'] satisfies DoneEndReason[];
    const texts = three.map((r) => truncationNotice(r));
    expect(new Set(texts).size, '三种"没完整交出来"共用一句话就等于没分').toBe(3);
    expect(truncationNotice('length')).not.toBe(truncationNotice('content_filter'));
  });
});
