import { describe, expect, it } from 'vitest';
import { chatSendSchema } from './contracts';

/**
 * T30：`CHAT_SEND` 的**入参**契约。
 *
 * 此前只有出参（`chatSendResultSchema`），入参在主进程用一句句 `typeof` 手写校验，
 * 三个字段**都没有长度上限** —— 一次超长粘贴会原样进 IPC、原样发给 provider。
 * 同族字段其实都有上限（历史查询的 `sessionId ≤ 64`、连接那组的 64/300/128/500），
 * 所以这是**漏了一处**，不是全局口径。
 *
 * 这里钉三件事：① 上限存在且**理由可读**；② 超限是**拒绝**不是截断（截断 = 静默改用户输入）；
 * ③ 两条既有文案（"请先选择一个连接"、"消息不能为空"）一字不改 —— 它们已经在界面与测试里出现过。
 */

describe('chatSendSchema', () => {
  it('正常一条消息通过（带与不带 sessionId 都行）', () => {
    expect(chatSendSchema.safeParse({ connectionId: 'c1', text: '你好' }).success).toBe(true);
    expect(
      chatSendSchema.safeParse({ connectionId: 'c1', text: '你好', sessionId: 's-123' }).success,
    ).toBe(true);
  });

  it('两条既有文案原样保留（界面与既有测试都依赖它们）', () => {
    const noConn = chatSendSchema.safeParse({ connectionId: '', text: 'x' });
    expect(noConn.success).toBe(false);
    if (!noConn.success) expect(noConn.error.issues[0]?.message).toBe('请先选择一个连接');

    const empty = chatSendSchema.safeParse({ connectionId: 'c1', text: '' });
    expect(empty.success).toBe(false);
    if (!empty.success) expect(empty.error.issues[0]?.message).toBe('消息不能为空');
  });

  it('超长文本被**拒绝**并把上限写进理由（不截断、不静默）', () => {
    const r = chatSendSchema.safeParse({ connectionId: 'c1', text: 'x'.repeat(200_001) });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toContain('20 万');
      expect(r.error.issues[0]?.path).toEqual(['text']);
    }
    // 恰好到顶要放行（否则等于把上限偷偷降了一格）
    expect(chatSendSchema.safeParse({ connectionId: 'c1', text: 'x'.repeat(200_000) }).success).toBe(true);
  });

  it('连接 id 与会话 id 各有上限，且理由里带数字', () => {
    const longConn = chatSendSchema.safeParse({ connectionId: 'c'.repeat(129), text: 'x' });
    expect(longConn.success).toBe(false);
    if (!longConn.success) expect(longConn.error.issues[0]?.message).toContain('128');

    const longSession = chatSendSchema.safeParse({
      connectionId: 'c1',
      text: 'x',
      sessionId: 's'.repeat(65),
    });
    expect(longSession.success).toBe(false);
    if (!longSession.success) expect(longSession.error.issues[0]?.message).toContain('64');
  });

  it('拒绝时不产出"被改写过的数据"（解析失败的返回里没有 data）', () => {
    const r = chatSendSchema.safeParse({ connectionId: 'c1', text: 'x'.repeat(300_000) });
    expect(r.success).toBe(false);
    expect('data' in r).toBe(false);
  });
});
