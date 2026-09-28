import { describe, expect, it } from 'vitest';
import {
  COMPACT_MIN_BYTES,
  COMPACT_MIN_ROUNDS,
  RECENT_TAIL_K,
  SUMMARY_MAX_CHARS,
  buildCompactPrompt,
  buildNotePrompt,
  buildSummarySection,
  capSummary,
  decideCompactPrompt,
  measureContext,
  selectHistoryForModel,
  type Turn,
} from './compaction';

/**
 * 上下文压缩的**纯决策层**（铺设计划 6b · 报备 `docs/DESIGN-COMPACT.md` 已批）。
 *
 * 为什么单独成模块、且全部可测：`chat-service` 依赖 electron，vitest 里根本加载不了
 * （这就是 6a 把记账逻辑抽成 `session-journal.ts` 的同一个理由）。
 * 阈值、水印、注入段这些"决定模型看到什么"的 judgement 必须能被单测与变异钉死，
 * 不能留在只有 e2e 才碰得到的地方。
 *
 * 坐标系（批复②）：`compactedThrough` 是**落盘序列的行号**，不是内存数组下标 ——
 * 内存里第 0 条是 system（不落盘、每轮重装配），用下标必然在重启后错位。
 */

const turn = (role: Turn['role'], content: string): Turn => ({ role, content });

/** 造 n 轮问答（user + assistant 各 n 条），内容长度可控 */
function makeTurns(n: number, charsEach = 10): Turn[] {
  const out: Turn[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push(turn('user', `问题${String(i)}_${'x'.repeat(Math.max(0, charsEach - 4))}`));
    out.push(turn('assistant', `回答${String(i)}_${'y'.repeat(Math.max(0, charsEach - 4))}`));
  }
  return out;
}

describe('measureContext：一切按水印之后的未压缩部分算', () => {
  it('轮数 = 未压缩部分里的用户消息条数（不是总条数、也不是内存下标）', () => {
    const msgs = makeTurns(3);
    const shape = measureContext(msgs, 0);
    expect(shape.rounds).toBe(3);
    expect(shape.uncompressedMessages).toBe(6);
  });

  it('有水印时只数水印之后的轮数', () => {
    const msgs = makeTurns(10);
    // 水印压掉了前 4 条（= 2 轮）
    const shape = measureContext(msgs, 4);
    expect(shape.rounds).toBe(8);
    expect(shape.uncompressedMessages).toBe(16);
  });

  it('字节数按 UTF-8 算，中文不是一字符一节', () => {
    const msgs = [turn('user', '中'.repeat(10))];
    const shape = measureContext(msgs, 0);
    expect(shape.uncompressedBytes).toBe(30);
  });

  it('水印超过总条数（数据被手工改过）不该让计数变负', () => {
    const msgs = makeTurns(2);
    const shape = measureContext(msgs, 9999);
    expect(shape.rounds).toBe(0);
    expect(shape.uncompressedBytes).toBe(0);
    expect(shape.uncompressedMessages).toBe(0);
  });
});

describe('decideCompactPrompt：双阈值"或"，且只提示不动手', () => {
  it('轮数到 24 就提示，即使字节远未到', () => {
    const shape = measureContext(makeTurns(COMPACT_MIN_ROUNDS, 4), 0);
    expect(shape.rounds).toBe(COMPACT_MIN_ROUNDS);
    expect(shape.uncompressedBytes).toBeLessThan(COMPACT_MIN_BYTES);
    const d = decideCompactPrompt(shape);
    expect(d.shouldPrompt).toBe(true);
    expect(d.reason).toContain('24 轮');
  });

  it('字节到 64KB 就提示，即使轮数远未到', () => {
    const big = [turn('user', 'z'.repeat(COMPACT_MIN_BYTES))];
    const shape = measureContext(big, 0);
    const d = decideCompactPrompt(shape);
    expect(d.shouldPrompt).toBe(true);
    expect(d.reason).toContain('KB');
  });

  it('两个都没到就不提示（这是"不打扰"的那一半）', () => {
    const d = decideCompactPrompt(measureContext(makeTurns(3, 20), 0));
    expect(d.shouldPrompt).toBe(false);
    expect(d.reason).toBe('');
  });

  it('压缩过之后要**再攒够 24 轮**才提示 —— 否则长会话会被无限追问', () => {
    const already = makeTurns(COMPACT_MIN_ROUNDS + 6, 4); // 30 轮 = 60 条
    // 压掉前 25 轮（50 条）：还剩 5 轮未压缩，不该再提示
    const d = decideCompactPrompt(measureContext(already, 50));
    expect(d.shouldPrompt).toBe(false);
    // 只压掉 5 轮（10 条）：还剩 25 轮未压缩，应该提示
    const d2 = decideCompactPrompt(measureContext(already, 10));
    expect(d2.shouldPrompt).toBe(true);
  });

  it('一条都没压过时也不能因为"总共很长"就重复提示同一批内容', () => {
    const d = decideCompactPrompt(measureContext(makeTurns(COMPACT_MIN_ROUNDS, 4), 0));
    expect(d.shouldPrompt).toBe(true);
    expect(d.reason).toContain('要不要');
  });

  /**
   * 提示语里只许有**一个**问句：界面在这句话后面紧跟「压缩此会话」按钮，
   * 文本里再问一次就是两个人在问同一件事（报备 §二的原文也只问一次）。
   */
  it('提示语只问一次，两个阈值分支都是', () => {
    const byRounds = decideCompactPrompt(measureContext(makeTurns(COMPACT_MIN_ROUNDS, 4), 0)).reason;
    const byBytes = decideCompactPrompt(
      measureContext([turn('user', 'z'.repeat(COMPACT_MIN_BYTES))], 0),
    ).reason;
    for (const reason of [byRounds, byBytes]) {
      expect(reason.match(/要不要/g)).toHaveLength(1);
      expect(reason).toContain('原始记录不会删除');
    }
  });
});

describe('selectHistoryForModel：system 全留，其余按水印 + K 条', () => {
  it('system 消息一条都不能被剪掉（它们本来就不落盘）', () => {
    const msgs = [
      turn('system', '基础人格'),
      ...makeTurns(20, 4),
      turn('system', '尚未选择工作区…'),
    ];
    const out = selectHistoryForModel(msgs, 10, RECENT_TAIL_K);
    const systems = out.filter((m) => m.role === 'system');
    expect(systems.length).toBe(2);
  });

  it('只保留水印之后的最近 K 条非 system 消息', () => {
    const msgs = makeTurns(30, 4); // 60 条非 system：问题i 在 2i，回答i 在 2i+1
    const out = selectHistoryForModel(msgs, 0, 12);
    expect(out.length).toBe(12);
    // 最近 12 条 = 下标 48..59 = 问题24 … 回答29
    expect(out[out.length - 1]?.content).toContain('回答29');
    expect(out[0]?.content).toContain('问题24');
  });

  it('不足 K 条时全给，不做四舍五入', () => {
    const msgs = makeTurns(2, 4);
    expect(selectHistoryForModel(msgs, 0, RECENT_TAIL_K).length).toBe(4);
  });

  it('水印落在中间时，水印之前的原文一条都不许再发给模型', () => {
    const msgs = makeTurns(10, 4); // 问题i 在 2i，回答i 在 2i+1
    const out = selectHistoryForModel(msgs, 14, 12); // 压掉前 7 轮（下标 0..13）
    for (const m of out) expect(m.content).not.toMatch(/(问题|回答)[0-6]_/);
    expect(out.some((m) => m.content.includes('问题7'))).toBe(true);
    expect(out.some((m) => m.content.includes('回答9'))).toBe(true);
    expect(out.length).toBe(6);
  });

  it('K 是上限：调用方给个巨大的 K 也不会把整个历史灌回去', () => {
    const msgs = makeTurns(40, 4);
    expect(selectHistoryForModel(msgs, 0, 10_000).length).toBe(RECENT_TAIL_K);
  });
});

describe('capSummary：超上限截断并如实标注，且不切断多字节字符', () => {
  it('不超时原样返回、truncated=false', () => {
    const r = capSummary('很短的一段摘要');
    expect(r.text).toBe('很短的一段摘要');
    expect(r.truncated).toBe(false);
  });

  it('超长时截到上限以内并标注 truncated', () => {
    const r = capSummary('呀'.repeat(SUMMARY_MAX_CHARS + 500));
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
  });

  it('用代理对（emoji）填充时不能截出半个字符', () => {
    const r = capSummary('🐣'.repeat(SUMMARY_MAX_CHARS + 1));
    expect(r.truncated).toBe(true);
    // 半个代理对会变成替换符或乱码
    expect(r.text).not.toContain('\uFFFD');
    expect([...r.text].every((c) => c === '🐣')).toBe(true);
  });
});

describe('buildSummarySection：注入段的原文必须和报备一致（漂移就是语义漂移）', () => {
  it('段头点明"由模型生成，非用户亲述"与冲突时以原文为准', () => {
    const s = buildSummarySection({ summary: '- 决定：用 A 方案', through: 48, sessionId: 'abc' });
    expect(s).toContain('会话早先内容的要点摘要（由模型生成，非用户亲述）');
    expect(s).toContain('一律以原始对话为准');
    expect(s).toContain('sessions/abc/summary.md');
    expect(s).toContain('覆盖到第 48 条为止');
    expect(s).toContain('## 摘要之后的原始对话');
    expect(s).toContain('- 决定：用 A 方案');
  });

  it('摘要为空时不产出这一段（空摘要绝不能进上下文）', () => {
    expect(buildSummarySection({ summary: '   ', through: 48, sessionId: 'abc' })).toBe('');
  });
});

/**
 * 摘要 prompt（批复⑤点名的产物之二）。
 *
 * 为什么它也要单测：prompt 里"必须保留哪四类事实"与 §七 的验收清单是**同一套四类** ——
 * 两边各写一次迟早漂成两套。所以这段文本由代码产出、被测试逐条钉住，e2e 再问真值。
 */
describe('buildCompactPrompt：要点清单的问法', () => {
  it('四类必保事实都在，且与验收清单一一对应', () => {
    const p = buildCompactPrompt(makeTurns(3, 8), 0);
    for (const key of ['人名与称呼', '文件与目录路径', '数字与阈值', '已做出的决定与被否决的方案']) {
      expect(p).toContain(key);
    }
  });

  it('带条数上限、带"原文里没有的不要编"、带"未确认"这个兜底', () => {
    const p = buildCompactPrompt(makeTurns(2, 8), 0);
    expect(p).toContain(String(SUMMARY_MAX_CHARS));
    expect(p).toContain('原文里没有的不要编');
    expect(p).toContain('未确认');
  });

  it('每条原文前标出它的**落盘行号**，水印之后从 1 开始数不对、要接着全局编号', () => {
    const msgs = makeTurns(3, 8); // 6 条：问题0..回答2
    const p = buildCompactPrompt(msgs, 2); // 已压掉前 2 条 → 待压的从第 3 条开始
    expect(p).toContain('[3]');
    expect(p).toContain('[6]');
    expect(p).not.toContain('[2] ');
  });

  it('没有未压缩内容时返回空串 —— 不该为一段空历史去调模型（花用户的钱）', () => {
    const msgs = makeTurns(2, 8);
    expect(buildCompactPrompt(msgs, 4)).toBe('');
    expect(buildCompactPrompt([], 0)).toBe('');
  });

  it('单条过长时截断并如实标注，不静默吞掉', () => {
    const long = [turn('user', 'L'.repeat(30_000))];
    const p = buildCompactPrompt(long, 0);
    expect(p).toContain('已截断');
    expect(p.length).toBeLessThan(30_000);
  });
});

describe('buildNotePrompt：结束会话时那条"记一句话"的问法', () => {
  it('要求压成一条、限长、并明确要求保留未决事项', () => {
    const p = buildNotePrompt(makeTurns(2, 8));
    expect(p).toContain('一条');
    expect(p).toContain('未决');
    expect(p).toContain('不要写成功陈述');
  });

  it('空历史同样不调模型', () => {
    expect(buildNotePrompt([])).toBe('');
  });
});
