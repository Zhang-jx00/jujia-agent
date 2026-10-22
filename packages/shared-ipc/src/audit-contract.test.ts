import { describe, expect, it } from 'vitest';
import { auditEntrySchema, auditPageSchema } from './contracts';

/**
 * T75（2026-10-22）：审计账的「**这一格来自策略还是来自人**」这一格。
 *
 * 口径本体在 `packages/agent-core/src/audit/record.ts`：
 *   · `decidedBy:'person'` = **没有策略判定、只有当面答复**（内置终端新起会话那一类）；
 *   · 缺这一格 = **策略表判的**（旧账没有这一格 ⇒ 一律按策略那类读，**旧账的字节一字不改**）。
 *
 * 为什么这条锁存在（这是本条真正被修掉的洞）：
 *   `z.object()` **默认剥掉未知键** ⇒ 这一格虽然写进了账、也在契约里放着，
 *   却在 `ipc/audit.ts` 的 `auditPageSchema.parse(...)` 那里被**结构性地丢掉**
 *   ⇒ **盘上分得开、界面上分不开**（e2e 判的是原始 JSONL，所以那条绿是绿的）。
 *
 * ⇒ 所以这里钉的不是"字段存在"，而是「**它真的穿过了契约**」——
 *   只断言"契约里有这一行"会被注释喂饱（§11 假锁清单第 5 条的老坑）。
 */
const base = {
  ts: '2026-10-22T02:00:00.000Z',
  sessionId: 's-1',
  subject: 'terminal:new-session',
  kind: 'exec' as const,
  outcome: 'ask' as const,
  asked: true,
  executed: true,
  reason: '内置终端新起会话：每次都当面问一次',
  args: {
    keys: ['command'],
    lengths: { command: 3 },
    digests: { command: 'abc123def456' },
    paths: [],
    redacted: [],
    command: 'pwd',
  },
};

describe('审计契约的「这一格来自策略还是来自人」（T75）', () => {
  it('这一格必须**原样穿过**契约（z.object 默认剥未知键 ⇒ 以前就是在这里丢的）', () => {
    const parsed = auditEntrySchema.parse({ ...base, decidedBy: 'person' });
    expect(parsed.decidedBy).toBe('person');
  });

  it('整页（auditPageSchema）也必须带着它穿过去（界面读的就是这一页）', () => {
    const parsed = auditPageSchema.parse({
      records: [{ ...base, decidedBy: 'person' }],
      total: 1,
      unparsed: 0,
      dropped: 0,
      notice: '',
      file: 'audit/permissions-2026-10-22.jsonl',
      workspaceRoot: 'D:/work/demo',
    });
    expect(parsed.records[0]?.decidedBy).toBe('person');
  });

  it('缺这一格的旧账**按策略那类读**（契约不许凭空补一个出来）', () => {
    const parsed = auditEntrySchema.parse(base);
    expect('decidedBy' in parsed).toBe(false);
  });

  it('旧账的字节形状不许变（这一格是可选的 ⇒ 不给也过）', () => {
    expect(auditEntrySchema.safeParse(base).success).toBe(true);
  });
});
