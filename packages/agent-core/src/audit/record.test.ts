import { describe, expect, it } from 'vitest';
import type { MakeRecordInput } from './record';
import { formatAuditLine, makeRecord } from './record';

/**
 * 审计记录本身是纯逻辑（不碰磁盘）：**行格式**必须只有一处定义，
 * 否则"写入的形状"与"读出来给人看的形状"会分叉，而分叉的审计比没有审计更难查。
 */

function record(over: Partial<MakeRecordInput> = {}) {
  return makeRecord({
    clock: '2026-10-09T10:00:00.000Z',
    subject: 'run_command',
    kind: 'exec',
    outcome: 'deny',
    reason: '命中你的规则「run_command」（命令前缀：rm -rf）→ 拒绝',
    sessionId: 's-1',
    executed: true,
    args: { keys: [], lengths: {}, digests: {}, paths: [], redacted: [] },
    ...over,
  });
}

describe('makeRecord（同一输入两次必须逐字节相同）', () => {
  it('键序固定、必填项齐', () => {
    const a = formatAuditLine(record({ clock: '2026-10-09T10:00:00.000Z' }));
    const b = formatAuditLine(record({ clock: '2026-10-09T10:00:00.000Z' }));
    expect(a).toBe(b);
    expect(a.endsWith('\n')).toBe(false);
    const parsed = JSON.parse(a) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual([
      'ts',
      'sessionId',
      'subject',
      'kind',
      'outcome',
      'asked',
      'executed',
      'reason',
      'args',
    ]);
  });

  it('时间由调用方给（纯函数不取时钟），没给就报错而不是写一个假时间', () => {
    expect(() => makeRecord({ subject: 'x', kind: 'read', outcome: 'allow', reason: 'r', sessionId: 's' })).toThrow(
      /时间/,
    );
    // 少了 executed 也要抛：不许把"没写"当成"没做"
    expect(() =>
      makeRecord({ clock: '2026-10-09T10:00:00.000Z', subject: 'x', kind: 'read', outcome: 'allow', reason: 'r', sessionId: 's' }),
    ).toThrow(/做没做成/);
  });

  it('问过的要带 answer，没问的要带 asked=false（两者在账上必须是两件事）', () => {
    const asked = makeRecord({
      subject: 'write_file',
      kind: 'write',
      outcome: 'ask',
      executed: true,
      reason: '写入文件，需确认',
      sessionId: 's',
      asked: true,
      answer: 'allow_once',
      clock: '2026-10-09T10:00:00.000Z',
    });
    expect(asked.answer).toBe('allow_once');
    expect(asked.asked).toBe(true);

    const silent = makeRecord({
      subject: 'list_dir',
      kind: 'read',
      outcome: 'allow',
      executed: true,
      reason: '只读操作，不修改任何状态',
      sessionId: 's',
      clock: '2026-10-09T10:00:00.000Z',
    });
    expect(silent.asked).toBe(false);
    expect(silent.answer).toBeUndefined();
  });

  it('拒绝的判定不许被记成询问（把 deny 写成 ask = 把"没做"记成"问过了"）', () => {
    expect(() =>
      makeRecord({
        subject: 'run_command',
        kind: 'exec',
        outcome: 'deny' as 'ask',
        executed: false,
        asked: true,
        answer: 'deny',
        reason: 'r',
        sessionId: 's',
        clock: '2026-10-09T10:00:00.000Z',
      }),
    ).toThrow();
  });

  it('一行就是一条完整 JSON（JSONL：不许换行，多行会把读取器骗成两条）', () => {
    const line = formatAuditLine(record({ reason: '第一行\n第二行' }));
    expect(line.includes('\n')).toBe(false);
    expect(JSON.parse(line).reason).toBe('第一行第二行');
  });

  it('规则表健康度可以带进来（读坏了要看得见，T37 的那一面）', () => {
    const line = formatAuditLine(
      record({ rules: { source: 'default', count: 0, recovered: true } }),
    );
    const parsed = JSON.parse(line) as { rules: { source: string; count: number; degraded: boolean } };
    expect(parsed.rules.source).toBe('default');
    expect(parsed.rules.degraded).toBe(true);
    expect(parsed.rules.count).toBe(0);
  });

  it('没有健康度信息时**不写这一格**，而不是写一个看着正常的默认值', () => {
    const parsed = JSON.parse(formatAuditLine(record())) as Record<string, unknown>;
    expect('rules' in parsed).toBe(false);
  });
});
