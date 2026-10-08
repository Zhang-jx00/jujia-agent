import { describe, expect, it } from 'vitest';
import type { PermissionMode, PermissionRule } from '@jujia/agent-core';
import {
  GIT_ACTIONS,
  assertHardAskInert,
  decideGitAction,
  gitAskClass,
  gitRequestSummary,
  gitToolName,
  shouldRememberAlwaysAllow,
} from './git-gate';

const rule = (pattern: string, action: 'allow' | 'deny' | 'ask'): PermissionRule => ({
  id: `r-${pattern}-${action}`,
  pattern,
  action,
  enabled: true,
  createdAt: '2026-09-24T00:00:00.000Z',
  updatedAt: '2026-09-24T00:00:00.000Z',
});

const ALL_MODES: ReadonlyArray<PermissionMode> = [
  'default',
  'acceptEdits',
  'plan',
  'dontAsk',
  'bypassPermissions',
];

describe('git 动作的档位清单（所有者给定的映射，一处定义）', () => {
  it.each([
    ['status', 'none'],
    ['diff', 'none'],
    ['log', 'none'],
    ['stage', 'soft'],
    ['unstage', 'soft'],
    ['commit', 'hard'],
    ['push', 'hard'],
  ] as const)('%s → %s', (action, expected) => {
    expect(gitAskClass(action)).toBe(expected);
  });

  it('清单覆盖七个动作，没有漏网的', () => {
    expect([...GIT_ACTIONS]).toEqual(['status', 'diff', 'log', 'stage', 'unstage', 'commit', 'push']);
    for (const a of GIT_ACTIONS) expect(() => gitAskClass(a)).not.toThrow();
  });

  it('未知动作不"默认不问"，而是直接抛（fail-closed）', () => {
    expect(() => gitAskClass('reset' as never)).toThrow(/未知动作/);
  });

  it('工具名带 git_ 前缀 —— 用户才能在规则表里按名字写规则', () => {
    expect(gitToolName('commit')).toBe('git_commit');
    expect(gitToolName('status')).toBe('git_status');
  });
});

describe('只读动作不打扰', () => {
  it.each(ALL_MODES)('mode=%s 时 status/diff/log 一律放行不问', (mode) => {
    for (const action of ['status', 'diff', 'log'] as const) {
      expect(decideGitAction({ action, mode }).action).toBe('allow');
    }
  });
});

describe('commit 是硬 ask：任何"总是允许"都压不掉', () => {
  it('default 模式下就是 ask，而且 bypassable 必须是 false', () => {
    const gate = decideGitAction({ action: 'commit', mode: 'default' });
    expect(gate.action).toBe('ask');
    if (gate.action === 'ask') {
      // 这条断言是变异 M10 的靶子：把 bypassable:false 改回 true，这里必须红
      expect(gate.bypassable).toBe(false);
    }
  });

  it('acceptEdits 只自动放行"编辑文件"，不自动放行写仓库历史', () => {
    const gate = decideGitAction({ action: 'commit', mode: 'acceptEdits' });
    expect(gate.action).toBe('ask');
    if (gate.action === 'ask') expect(gate.bypassable).toBe(false);
  });

  it('plan / dontAsk 下 commit 被拒（连问都不问）', () => {
    for (const mode of ['plan', 'dontAsk'] as const) {
      expect(decideGitAction({ action: 'commit', mode }).action).toBe('deny');
    }
  });

  it('bypassPermissions 是**显式写下来的**全放行，仍然生效', () => {
    expect(decideGitAction({ action: 'commit', mode: 'bypassPermissions' }).action).toBe('allow');
  });

  it('硬 ask 的判定不会被误记进"总是允许"', () => {
    const gate = decideGitAction({ action: 'commit', mode: 'default' });
    expect(shouldRememberAlwaysAllow('commit', gate, 'allow_always')).toBe(false);
  });
});

describe('stage / unstage 是软 ask：可逆操作，允许"本次会话总是允许"', () => {
  it.each(['stage', 'unstage'] as const)('%s 在 default 下是 bypassable 的 ask', (action) => {
    const gate = decideGitAction({ action, mode: 'default' });
    expect(gate.action).toBe('ask');
    if (gate.action === 'ask') expect(gate.bypassable).toBe(true);
    expect(shouldRememberAlwaysAllow(action, gate, 'allow_always')).toBe(true);
  });

  it('acceptEdits 模式下暂存被视为"编辑级"操作，自动放行', () => {
    expect(decideGitAction({ action: 'stage', mode: 'acceptEdits' }).action).toBe('allow');
  });

  it('回答不是「总是允许」时不记白名单', () => {
    const gate = decideGitAction({ action: 'stage', mode: 'default' });
    expect(shouldRememberAlwaysAllow('stage', gate, 'allow_once')).toBe(false);
    expect(shouldRememberAlwaysAllow('stage', gate, 'deny')).toBe(false);
  });
});

describe('用户规则优先（与工具执行走同一个引擎，不搞第二套语义）', () => {
  it('deny 规则绝对生效，连 bypassPermissions 也让路', () => {
    const rules = [rule('git_*', 'deny')];
    for (const mode of ALL_MODES) {
      expect(decideGitAction({ action: 'commit', mode, rules }).action).toBe('deny');
    }
  });

  it('ask 规则是硬 ask（不被"总是允许"抑制）', () => {
    const gate = decideGitAction({ action: 'stage', mode: 'default', rules: [rule('git_stage', 'ask')] });
    expect(gate.action).toBe('ask');
    if (gate.action === 'ask') expect(gate.bypassable).toBe(false);
    expect(shouldRememberAlwaysAllow('stage', gate, 'allow_always')).toBe(false);
  });

  it('allow 规则是显式写下来的决定，acceptEdits 下也能放行 commit', () => {
    const gate = decideGitAction({ action: 'commit', mode: 'acceptEdits', rules: [rule('git_commit', 'allow')] });
    expect(gate.action).toBe('allow');
  });

  it('高危清单命中 commit 时给出硬 ask', () => {
    const gate = decideGitAction({
      action: 'commit',
      mode: 'default',
      alwaysAsk: ['git_commit'],
    });
    expect(gate.action).toBe('ask');
    if (gate.action === 'ask') expect(gate.bypassable).toBe(false);
  });
});

describe('自证断言：档位说是硬 ask，结果却可被压掉 → 中止而不是静默放行', () => {
  it('可压掉的硬 ask 判定会抛', () => {
    expect(() =>
      assertHardAskInert('commit', { action: 'ask', reason: 'r', risk: 'high', bypassable: true }),
    ).toThrow(/应为硬 ask/);
  });

  it('正常的硬 ask / 软 ask / allow / deny 都不抛', () => {
    assertHardAskInert('commit', { action: 'ask', reason: 'r', risk: 'high', bypassable: false });
    assertHardAskInert('stage', { action: 'ask', reason: 'r', risk: 'low', bypassable: true });
    assertHardAskInert('commit', { action: 'allow', reason: 'r', risk: 'low' });
    assertHardAskInert('commit', { action: 'deny', reason: 'r', risk: 'medium' });
  });
});

describe('push（M8 收口）：外发远端 = 硬 ask，且**永远不可被「总是允许」压掉**', () => {
  /**
   * 这组断言的口径来自所有者（`docs/HANDOVER.md` §3.2 / `WORK-PROTOCOL` 速查表）：
   * `push` 把提交发到远端，**别人看得见、撤回需要远端配合**，所以与 `commit` 同级甚至更严 ——
   * 而且刻意**不给**"本次会话总是允许"这条捷径（commit 都不给，push 更不给）。
   */
  it('default 下是 ask 且 bypassable=false（变异 M100 的靶子：改回 true 必须红）', () => {
    const gate = decideGitAction({ action: 'push', mode: 'default' });
    expect(gate.action).toBe('ask');
    if (gate.action === 'ask') expect(gate.bypassable).toBe(false);
  });

  it('acceptEdits 不自动放行外发（它说的是"编辑文件"，不是"发到远端"）', () => {
    const gate = decideGitAction({ action: 'push', mode: 'acceptEdits' });
    expect(gate.action).toBe('ask');
    if (gate.action === 'ask') expect(gate.bypassable).toBe(false);
  });

  it('plan / dontAsk 下 push 直接被拒（连问都不问）', () => {
    for (const mode of ['plan', 'dontAsk'] as const) {
      expect(decideGitAction({ action: 'push', mode }).action).toBe('deny');
    }
  });

  it('用户自己写了 allow 规则才算显式让路（与 commit 同一口径，不搞第二套）', () => {
    expect(decideGitAction({ action: 'push', mode: 'default', rules: [rule('git_push', 'allow')] }).action).toBe('allow');
    expect(decideGitAction({ action: 'push', mode: 'default', rules: [rule('git_push', 'deny')] }).action).toBe('deny');
  });

  it('硬 ask 的判定不会被误记进"总是允许"', () => {
    const gate = decideGitAction({ action: 'push', mode: 'default' });
    expect(shouldRememberAlwaysAllow('push', gate, 'allow_always')).toBe(false);
  });

  it('自证：说好的硬 ask 变成可压掉时，宁可抛也不静默放行', () => {
    const good = decideGitAction({ action: 'push', mode: 'default' });
    expect(() => assertHardAskInert('push', good)).not.toThrow();
    if (good.action === 'ask') {
      expect(() => assertHardAskInert('push', { ...good, bypassable: true })).toThrow(/git_push 应为硬 ask/);
    }
  });

  it('弹窗文案点明"发到远端、别人看得见"，而不是复用 commit 那句"写入仓库历史"', () => {
    const s = gitRequestSummary('push', { remote: 'origin', branch: 'main' });
    expect(s).toContain('origin');
    expect(s).toContain('main');
    expect(s).toMatch(/远端|外发/);
    // commit 专用那句不能出现在 push 上（两个动作的后果不一样，文案不能一份通用）
    expect(s).not.toContain('revert');
  });
});

describe('弹窗文案：commit 必须写清"会写入仓库历史"', () => {
  it('commit 的摘要点明写历史', () => {
    expect(gitRequestSummary('commit', { message: '做一轮接线' })).toContain('会写入仓库历史');
  });

  it('暂存/取消暂存的摘要给出数量与前几个路径', () => {
    expect(gitRequestSummary('stage', { paths: ['a.ts', 'b.ts'] })).toContain('2 个文件');
    expect(gitRequestSummary('unstage', { paths: ['a.ts'] })).toContain('取消暂存 1 个文件');
  });

  it('只读动作的摘要说明不需要确认', () => {
    expect(gitRequestSummary('status', {})).toContain('只读');
  });
});
