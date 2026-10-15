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

  it('两条说法不共用文案（"截断"与"被拦"是两件不同的事）', () => {
    expect(truncationNotice('length')).not.toBe(truncationNotice('content_filter'));
  });
});
