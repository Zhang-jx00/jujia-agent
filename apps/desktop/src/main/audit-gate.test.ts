import { describe, expect, it } from 'vitest';
import type { GateDecision } from '@jujia/agent-core';
import type { AuditGateInput, AuditService } from './audit-service';
import { auditedGateRun } from './audit-gate';

/**
 * 非工具门的审计出口（R8.6）。
 *
 * 这一层要盯住的还是铺设11 立下的那两件事，只是换了三个门：
 * ① **问过 ≠ 做过**：`asked` 与人答的是什么是两格，`executed` 只看这件事最后成没成；
 * ② **一条判定只记一次，且不可能漏**：记账写在 `finally` 里，
 *    所以"判定发生过"（标记过 gate）的路径全覆盖，"还没判定就失败"的路径一条都不该冒出来。
 * 把记账放在每条 return 之前 = 迟早漏一条 —— 这条在工具侧已经被变异验证过一次。
 */

function gate(over: Partial<GateDecision> & { action: GateDecision['action'] }): GateDecision {
  return over.action === 'ask'
    ? { action: 'ask', reason: over.reason ?? '需要确认', risk: 'high', bypassable: over.bypassable ?? false }
    : { action: over.action, reason: over.reason ?? '按策略处置', risk: 'low' };
}

function stubAudit(): { svc: AuditService; calls: AuditGateInput[] } {
  const calls: AuditGateInput[] = [];
  const svc = {
    async recordTool() {},
    async recordGate(input: AuditGateInput) {
      calls.push(input);
    },
    async tail() {
      return { records: [], total: 0, unparsed: 0, dropped: 0, notice: '', file: '', workspaceRoot: '' };
    },
    async status() {
      return { file: '', lines: 0, dropped: 0, writeFailures: 0, lastError: '' };
    },
    async exportTo() {
      return { lines: 0, file: '' };
    },
    dir: () => 'x',
  } satisfies AuditService;
  return { svc, calls };
}

/** 「这次应该恰好记了一条账」本身就是要断言的事，所以取用前先钉住条数 */
function only(calls: AuditGateInput[]): AuditGateInput {
  expect(calls.length).toBe(1);
  const rec = calls[0];
  if (rec === undefined) throw new Error('审计出口没有记进账');
  return rec;
}

type Result = { ok: boolean };

describe('auditedGateRun（判定事实的唯一记账出口）', () => {
  it('没有判定就没有账：闸门之前失败（没选工作区 / URL 不合法）不许凭空冒出一条判定', async () => {
    const { svc, calls } = stubAudit();
    const r = await auditedGateRun<Result>(svc, 'git_commit', async () => ({ ok: false }));
    expect(r.ok).toBe(false);
    expect(calls.length).toBe(0);
  });

  it('只读放行：账上写 allow、没问过、事做了', async () => {
    const { svc, calls } = stubAudit();
    await auditedGateRun<Result>(svc, 'git_commit', async (mark) => {
      mark({ gate: gate({ action: 'allow' }) });
      return { ok: true };
    });
    const rec = only(calls);
    expect(rec.outcome).toBe('allow');
    expect(rec.asked).toBe(false);
    expect(rec.answer).toBeUndefined();
    expect(rec.executed).toBe(true);
  });

  it('策略拒绝：deny、没问过、事没做，理由原样进账', async () => {
    const { svc, calls } = stubAudit();
    await auditedGateRun<Result>(svc, 'hooks:modify', async (mark) => {
      mark({ gate: gate({ action: 'deny', reason: '命中你的规则 → 拒绝' }) });
      return { ok: false };
    });
    const rec = only(calls);
    expect(rec.outcome).toBe('deny');
    expect(rec.asked).toBe(false);
    expect(rec.executed).toBe(false);
    expect(rec.reason).toContain('命中你的规则');
  });

  it('硬 ask 被用户拒掉：判定仍是 ask、确实问过、答复 deny、事没做（问过与做过分两格）', async () => {
    const { svc, calls } = stubAudit();
    await auditedGateRun<Result>(svc, 'open_with_system', async (mark) => {
      mark({ gate: gate({ action: 'ask' }) });
      mark({ asked: true, answer: 'deny' });
      return { ok: false };
    });
    const rec = only(calls);
    expect(rec.outcome).toBe('ask');
    expect(rec.asked).toBe(true);
    expect(rec.answer).toBe('deny');
    expect(rec.executed).toBe(false);
  });

  it('批准后做事：ask + allow_once + 成功 → executed true', async () => {
    const { svc, calls } = stubAudit();
    await auditedGateRun<Result>(svc, 'git_push', async (mark) => {
      mark({ gate: gate({ action: 'ask' }) });
      mark({ asked: true, answer: 'allow_once' });
      return { ok: true };
    });
    const rec = only(calls);
    expect(rec.answer).toBe('allow_once');
    expect(rec.executed).toBe(true);
  });

  it('软 ask 被「总是允许」压掉：asked false 且不许有 answer（不许伪装成问过）', async () => {
    const { svc, calls } = stubAudit();
    await auditedGateRun<Result>(svc, 'git_stage', async (mark) => {
      mark({ gate: gate({ action: 'ask', bypassable: true }) });
      return { ok: true };
    });
    const rec = only(calls);
    expect(rec.outcome).toBe('ask');
    expect(rec.asked).toBe(false);
    expect(rec.answer).toBeUndefined();
    expect(rec.executed).toBe(true);
  });

  it('批了但事没成（git 命令失败 / 交给外部程序时抛错）：executed false —— 不许把"批过"记成"做过"', async () => {
    const { svc, calls } = stubAudit();
    await auditedGateRun<Result>(svc, 'git_commit', async (mark) => {
      mark({ gate: gate({ action: 'ask' }) });
      mark({ asked: true, answer: 'allow_once' });
      return { ok: false };
    });
    const rec = only(calls);
    expect(rec.asked).toBe(true);
    expect(rec.executed).toBe(false);
  });

  it('自证失败抛异常时仍然留一条账（executed false），且异常原样抛出、不被记账吞掉', async () => {
    const { svc, calls } = stubAudit();
    await expect(
      auditedGateRun<Result>(svc, 'git_commit', async (mark) => {
        mark({ gate: gate({ action: 'ask', bypassable: true }) });
        throw new Error('应为硬 ask，但拿到了可被「总是允许」压掉的判定');
      }),
    ).rejects.toThrow(/应为硬 ask/);
    const rec = only(calls);
    expect(rec.executed).toBe(false);
    expect(rec.asked).toBe(false);
  });

  it('参数与可读形态透传给服务（去猜哪个键是正文不是这一层的事）', async () => {
    const { svc, calls } = stubAudit();
    await auditedGateRun<Result>(svc, 'open_with_custom', async (mark) => {
      mark({ gate: gate({ action: 'ask' }), args: { url: 'https://example.com' }, commandKey: 'url' });
      mark({ asked: true, answer: 'allow_once' });
      return { ok: true };
    });
    const rec = only(calls);
    expect(rec.args).toEqual({ url: 'https://example.com' });
    expect(rec.commandKey).toBe('url');
  });

  it('会话号默认 manual（这三个门都是人驱动的，没有对话会话）', async () => {
    const { svc, calls } = stubAudit();
    await auditedGateRun<Result>(svc, 'hooks:modify', async (mark) => {
      mark({ gate: gate({ action: 'allow' }) });
      return { ok: true };
    });
    expect(only(calls).sessionId).toBe('manual');
  });

  it('多次 mark 累加，后面的覆盖前面的（同一场判定里的两次事实要合进一条账）', async () => {
    const { svc, calls } = stubAudit();
    await auditedGateRun<Result>(svc, 'git_commit', async (mark) => {
      mark({ gate: gate({ action: 'ask' }) });
      mark({ asked: true, answer: 'deny' });
      mark({ asked: true, answer: 'timeout' });
      return { ok: false };
    });
    expect(only(calls).answer).toBe('timeout');
  });

  it('耗时随判定一起交出去（不自己造时间基准）', async () => {
    const { svc, calls } = stubAudit();
    await auditedGateRun<Result>(svc, 'git_commit', async (mark) => {
      mark({ gate: gate({ action: 'allow' }) });
      return { ok: true };
    });
    const rec = only(calls);
    expect(typeof rec.durationMs).toBe('number');
    expect(rec.durationMs).toBeGreaterThanOrEqual(0);
  });
});
