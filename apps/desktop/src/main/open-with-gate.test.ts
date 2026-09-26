import { describe, expect, it } from 'vitest';
import type { PermissionMode, PermissionRule } from '@jujia/agent-core';
import {
  OPEN_TARGETS,
  assertOpenHardAskInert,
  decideOpenTarget,
  openAskClass,
  openRequestSummary,
  openToolName,
  type OpenTarget,
} from './open-with-gate';

/**
 * 「打开方式」判档的验收（M10 收尾 · 所有者批复的直译）。
 *
 * 一句话概括这一轮要守住的东西：**地址交给外部程序 = 本机外发动作 = 每次硬 ask**。
 * 内置那一档不问，是因为地址是用户自己敲的（G-6 口径）；
 * 而"交给谁"这一步改变了信任边界 —— 外部程序不受我们的导航策略约束。
 */

const rule = (pattern: string, action: 'allow' | 'deny' | 'ask'): PermissionRule => ({
  id: `r-${pattern}-${action}`,
  pattern,
  action,
  enabled: true,
  createdAt: '2026-09-26T00:00:00.000Z',
  updatedAt: '2026-09-26T00:00:00.000Z',
});

const ALL_MODES: ReadonlyArray<PermissionMode> = [
  'default',
  'acceptEdits',
  'plan',
  'dontAsk',
  'bypassPermissions',
];

describe('三档清单（一处定义，与契约层的枚举一一对应）', () => {
  it.each([
    ['internal', 'none'],
    ['system', 'hard'],
    ['custom', 'hard'],
  ] as const)('%s → %s', (target, expected) => {
    expect(openAskClass(target)).toBe(expected);
  });

  it('清单就是这三档，没有第四档漏网', () => {
    expect([...OPEN_TARGETS]).toEqual(['internal', 'system', 'custom']);
    for (const t of OPEN_TARGETS) expect(() => openAskClass(t)).not.toThrow();
  });

  it('不在清单里的目标**直接抛**，不"默认不问"', () => {
    // 变异或后续改动若把这里改成 `?? 'none'` 式的宽容兜底，这一条会红
    expect(() => openAskClass('everything' as OpenTarget)).toThrow(/按最严格处理/);
  });

  it('工具名可被用户的规则表匹配（open_with_*）', () => {
    expect(openToolName('internal')).toBe('open_internal');
    expect(openToolName('system')).toBe('open_with_system');
    expect(openToolName('custom')).toBe('open_with_custom');
  });
});

describe('判档：外部两档永远是要人亲手批的那一档', () => {
  it('内置那一档不打扰（default 模式下直接放行）', () => {
    expect(decideOpenTarget({ target: 'internal', mode: 'default' }).action).toBe('allow');
  });

  it.each(['system', 'custom'] as const)('%s 在 default 模式下是 ask，且**不可被"总是允许"压掉**', (target) => {
    const gate = decideOpenTarget({ target, mode: 'default' });
    expect(gate.action).toBe('ask');
    // 这一行是 M17 的靶子：把 bypassable 改 true，这里立刻红
    if (gate.action === 'ask') expect(gate.bypassable).toBe(false);
  });

  it('acceptEdits 不算"编辑一下"—— 外发动作照样要问', () => {
    // 与 git 的 commit 同一口径：acceptEdits 的字面范围是"工作区内的文件编辑"
    for (const target of ['system', 'custom'] as const) {
      const gate = decideOpenTarget({ target, mode: 'acceptEdits' });
      expect(gate.action).toBe('ask');
      if (gate.action === 'ask') expect(gate.bypassable).toBe(false);
    }
  });

  it('plan / dontAsk 这类"别自己动手"的模式：外部两档一律 deny', () => {
    for (const mode of ['plan', 'dontAsk'] as PermissionMode[]) {
      for (const target of ['system', 'custom'] as const) {
        expect(decideOpenTarget({ target, mode }).action).toBe('deny');
      }
    }
  });

  it('高危清单命中时给出硬 ask（配置里写 open_with_system 也会每次问）', () => {
    const gate = decideOpenTarget({ target: 'system', mode: 'default', alwaysAsk: ['open_with_system'] });
    expect(gate.action).toBe('ask');
    if (gate.action === 'ask') expect(gate.bypassable).toBe(false);
  });
});

describe('用户规则优先（与工具执行、git 走同一个引擎，不搞第二套语义）', () => {
  it('deny 规则绝对生效，连 bypassPermissions 也让路', () => {
    const rules = [rule('open_with_*', 'deny')];
    for (const mode of ALL_MODES) {
      for (const target of ['system', 'custom'] as const) {
        expect(decideOpenTarget({ target, mode, rules }).action).toBe('deny');
      }
    }
  });

  it('allow 规则是"用户自己写下来的决定"，可以不打扰', () => {
    const gate = decideOpenTarget({ target: 'system', mode: 'default', rules: [rule('open_with_system', 'allow')] });
    expect(gate.action).toBe('allow');
  });

  it('ask 规则同样是硬 ask', () => {
    const gate = decideOpenTarget({ target: 'custom', mode: 'acceptEdits', rules: [rule('open_with_custom', 'ask')] });
    expect(gate.action).toBe('ask');
    if (gate.action === 'ask') expect(gate.bypassable).toBe(false);
  });
});

describe('自证：档位说是硬 ask，结果却是可压掉的 —— 宁可抛', () => {
  it('外部两档拿到可压掉的 ask 时抛错', () => {
    for (const target of ['system', 'custom'] as const) {
      expect(() =>
        assertOpenHardAskInert(target, { action: 'ask', reason: 'x', risk: 'high', bypassable: true }),
      ).toThrow(/已中止/);
    }
  });

  it('内置那一档与"本来就不用问"的结果不抛', () => {
    expect(() => assertOpenHardAskInert('internal', { action: 'allow', reason: 'x', risk: 'low' })).not.toThrow();
    expect(() =>
      assertOpenHardAskInert('system', { action: 'ask', reason: 'x', risk: 'high', bypassable: false }),
    ).not.toThrow();
  });
});

describe('弹窗文案：说清"这一步会把地址交给外部"', () => {
  it.each(['system', 'custom'] as const)('%s 的摘要里同时有安全边界说明和网址本身', (target) => {
    const text = openRequestSummary(target, { url: 'https://example.com/a?b=1', exePath: '/opt/browser/browser.exe' });
    expect(text).toContain('离开本应用的安全边界');
    expect(text).toContain('https://example.com/a?b=1');
  });

  it('自选程序那一档必须把**程序路径**摊开给人看（只看网址是不够的）', () => {
    const text = openRequestSummary('custom', { url: 'https://example.com', exePath: '/opt/browser/browser.exe' });
    expect(text).toContain('/opt/browser/browser.exe');
  });

  it('超长网址截断并如实标注，不假装看全了', () => {
    const text = openRequestSummary('system', { url: `https://example.com/${'x'.repeat(400)}` });
    expect(text).toContain('已截断');
    expect(text.length).toBeLessThan(300);
  });
});
