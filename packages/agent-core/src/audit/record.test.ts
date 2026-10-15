import { describe, expect, it } from 'vitest';
import type { MakeRecordInput } from './record';
import { formatAuditLine, makeRecord, parseAuditLine } from './record';

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

/**
 * T41（终端与外部件批 · 2026-10-15）：**内置终端进账本要有自己的形状，而不是伪造一份策略判定**。
 *
 * 病：`terminal-service.ts` 直接调 `permission(...)` 而**不走 `decideGate`** ——
 * 它没有"策略判定"这一步（只有真的新起进程才当面问，`bypassable` 硬写 false），
 * 所以套不进 `auditedGateRun`：那条出口要的是一份 `GateDecision`，凭空造一份就是**伪造判定**
 * （与"参数校验没过不进审计"同一条口径）。后果是账本里看不见"谁起过一个终端"。
 *
 * 这一类账的定义（就是本轮要定死的"形状"）：
 * - `decidedBy:'person'` = 这一格的结论**来自人的当面答复**，本机策略表没有参与；
 * - `outcome` 只能是 `ask`（当面问就是它的形式），`asked` 必须 true，`answer` 必须真有其值；
 * - `bypassable` 必须 false —— 这一类没有"可被『总是允许』压掉"的档位，
 *   能压掉的那些永远来自策略表（T19 那条纪律的另一半）；
 * - 少了 `decidedBy` 的记录一律按策略表那类读，旧账的键序与字节**一字不改**（新增一类不许改动旧形状）。
 *
 * 注意本轮**没有动权限映射**：终端仍然每次当面问，用户在规则页写的 `terminal` 规则对它仍然无效 ——
 * 那一条属停牌①（改的是"这台机器的门怎么判"），界面上那句话同步改口径。
 */
describe('没有策略判定的当面批准（T41 新增的一类账）', () => {
  const person = (over: Partial<MakeRecordInput> = {}) =>
    makeRecord({
      clock: '2026-10-15T10:00:00.000Z',
      subject: 'terminal_start',
      kind: 'gate',
      outcome: 'ask',
      asked: true,
      answer: 'allow_once',
      bypassable: false,
      executed: true,
      reason: '内置终端：每次新起会话都当面问（这一步不查策略表）',
      sessionId: 'manual',
      decidedBy: 'person',
      ...over,
    });

  it('合法的一类：当面问过、人答了、这道门压不掉', () => {
    const line = formatAuditLine(person());

    expect(person().decidedBy).toBe('person');
    expect(line).toContain('"decidedBy":"person"');
    expect(line).toContain('"subject":"terminal_start"');
  });

  it('凭空造出 allow 判定要抛（这一类没有策略判定，outcome 只能是"当面问"）', () => {
    expect(() => person({ outcome: 'allow' })).toThrow(/当面/);
    expect(() => person({ outcome: 'deny' })).toThrow(/当面/);
  });

  it('没问过却记成有人批过 —— 抛（这是最坏的一种记法）', () => {
    expect(() => person({ asked: false })).toThrow(/当面/);
  });

  it('这一类不许长出"可被总是允许压掉"的档位', () => {
    expect(() => person({ bypassable: true })).toThrow(/压掉/);
  });

  it('反向对照：策略表那类不写这一格，账上的键序与从前一字不差', () => {
    const parsed = JSON.parse(formatAuditLine(record({ outcome: 'allow' }))) as Record<string, unknown>;

    expect('decidedBy' in parsed).toBe(false);
  });

  it('老行（没有这一格）照样读回来，且不会被兜底成"当面批准"', () => {
    const oldLine = formatAuditLine(record({ outcome: 'allow' }));
    const back = parseAuditLine(oldLine);

    expect(back).not.toBeNull();
    expect(back?.decidedBy).toBeUndefined();
  });

  it('新行读回来还是这一类（写与读必须认同同一个形状，否则账坏了没人信）', () => {
    const back = parseAuditLine(formatAuditLine(person()));

    expect(back?.decidedBy).toBe('person');
    expect(back?.subject).toBe('terminal_start');
  });
});
