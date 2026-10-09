import { describe, expect, it } from 'vitest';
import { truncationNotice } from './done-notice';

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

  it('stop / aborted / error / tool_calls 不在这里说话（各有各的显示，重复说会互相盖）', () => {
    for (const reason of ['stop', 'aborted', 'error', 'tool_calls', '别的什么']) {
      expect(truncationNotice(reason), reason).toBeNull();
    }
  });

  it('两条说法不共用文案（"截断"与"被拦"是两件不同的事）', () => {
    expect(truncationNotice('length')).not.toBe(truncationNotice('content_filter'));
  });
});
