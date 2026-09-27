import { describe, expect, it } from 'vitest';
import {
  assertHooksHardAskInert,
  decideHooksModify,
  hookCommandsOf,
  hooksModifySummary,
  HOOKS_MODIFY_TOOL,
} from './hooks-gate';
import type { PermissionRule } from '@jujia/agent-core';

/**
 * 钩子配置写入的权限档（外部审查 T4）。
 *
 * 这条通道为什么是安全边界：钩子配置里写的是"将来要执行的命令"，而钩子子进程
 * **不过权限门**。于是渲染层只要能写 `hooks:set`，就等于拿到"任意命令 + 宿主环境 + 重启还在"
 * —— 一次注入即持久后门。所以这里唯一要守住的是：**每一次写入都必须过人手，且压不掉**。
 */

function rule(pattern: string, action: PermissionRule['action']): PermissionRule {
  return { id: 'r1', pattern, action, enabled: true, createdAt: '', updatedAt: '' };
}

/**
 * 「这是硬 ask」写成具名断言。
 * `bypassable` 只存在于 `action:'ask'` 那一支，不先收窄就读它，TS 会直接拒绝 ——
 * 与其四处手写收窄（写错一次就变成"读了个不存在的属性 = undefined，断言照样绿"），
 * 不如收敛成一个函数，它同时就是这条修复的断言名字。
 */
function expectHardAsk(gate: ReturnType<typeof decideHooksModify>, label: string): void {
  if (gate.action !== 'ask') {
    throw new Error(`${label}：期望硬 ask，实际是 ${gate.action}（${'reason' in gate ? gate.reason : '无理由'}）`);
  }
  expect(gate.bypassable).toBe(false);
}

describe('改钩子配置一律硬 ask', () => {
  it.each(['default', 'acceptEdits'] as const)(
    '%s 模式：拿到 ask 时 bypassable 必须是 false',
    (mode) => {
      const gate = decideHooksModify({ mode });
      expect(gate.action).toBe('ask');
      expectHardAsk(gate, `${mode} 模式`);
    },
  );

  it('acceptEdits 降回 default：那个模式叫"文件编辑自动放行"，改钩子配置不是编辑', () => {
    // 写这条的原因是它**真的错过**：第一版直接把 acceptEdits 交给策略层，
    // 策略层对 kind='write' 回了 allow —— 弹窗一次都不弹，T4 等于没修。
    const gate = decideHooksModify({ mode: 'acceptEdits' });
    expect(gate.action).toBe('ask');
    expectHardAsk(gate, 'acceptEdits 模式');
  });

  it('plan / dontAsk 模式直接拒绝（写不了，连问都不问）', () => {
    // 策略层对这两种模式拒绝一切写操作 —— 钩子配置也是写
    for (const mode of ['plan', 'dontAsk'] as const) {
      expect(decideHooksModify({ mode }).action).toBe('deny');
    }
  });

  it('没有"总是允许"这回事：白名单里查不到这个名字', () => {
    // 本模块刻意**不维护** remembered 集合（对比 git-service 的软 ask 白名单）：
    // 一次批准换来长期放行任意命令，那不是省事，那是把权限门拆了
    const gate = decideHooksModify({ mode: 'default' });
    expect(gate.action).toBe('ask');
    expectHardAsk(gate, 'default 模式（没有白名单可记）');
  });

  it('用户自己写的规则仍然算数：deny 绝对生效、allow 显式让路', () => {
    expect(decideHooksModify({ mode: 'default', rules: [rule(HOOKS_MODIFY_TOOL, 'deny')] }).action).toBe('deny');
    expect(decideHooksModify({ mode: 'default', rules: [rule(HOOKS_MODIFY_TOOL, 'allow')] }).action).toBe('allow');
    expect(decideHooksModify({ mode: 'default', rules: [rule(HOOKS_MODIFY_TOOL, 'ask')] }).action).toBe('ask');
    // glob 也认（用户写 hooks:* 时同样命中）
    expect(decideHooksModify({ mode: 'default', rules: [rule('hooks:*', 'deny')] }).action).toBe('deny');
  });

  it('bypassPermissions 是"看得见、写下来"的让路，不在这里偷偷推翻（与 git-gate 同一口径）', () => {
    expect(decideHooksModify({ mode: 'bypassPermissions' }).action).toBe('allow');
  });
});

describe('自证：档口说硬 ask，结果却可被压掉 → 抛', () => {
  it('可压掉的 ask 视为逻辑断裂，宁可保存失败', () => {
    expect(() =>
      assertHooksHardAskInert({ action: 'ask', reason: 'r', risk: 'high', bypassable: true }),
    ).toThrow(/硬 ask/);
  });

  it('硬 ask / allow / deny 都不抛', () => {
    assertHooksHardAskInert({ action: 'ask', reason: 'r', risk: 'high', bypassable: false });
    assertHooksHardAskInert({ action: 'allow', reason: 'r', risk: 'low' });
    assertHooksHardAskInert({ action: 'deny', reason: 'r', risk: 'medium' });
  });
});

describe('弹窗内容：审批必须看得见要写进去的命令', () => {
  it('有命令时把命令写进摘要（最多三条，多的报数量）', () => {
    const cmds = ['node guard.mjs', 'node audit.mjs', 'node a.mjs', 'node b.mjs'];
    const text = hooksModifySummary(cmds);
    expect(text).toContain('以你的宿主环境执行命令');
    expect(text).toContain('node guard.mjs');
    expect(text).toContain('等 4 条');
  });

  it('本次配置里没有钩子子时如实说明（而不是显示空尾巴）', () => {
    expect(hooksModifySummary([])).toContain('没有钩子命令');
  });

  it('从嵌套配置里尽力取命令清单；结构不合法只返回空数组（校验是 save 的职责）', () => {
    const config = {
      enabled: true,
      events: {
        PreToolUse: [{ matcher: '', hooks: [{ type: 'process', command: 'node', args: ['guard.mjs'] }] }],
        Stop: [{ hooks: [{ type: 'process', command: 'node', args: [123] }] }],
      },
    };
    expect(hookCommandsOf(config)).toEqual(['node guard.mjs', 'node']);
    expect(hookCommandsOf(null)).toEqual([]);
    expect(hookCommandsOf('nonsense')).toEqual([]);
    expect(hookCommandsOf({ events: '不是数组' })).toEqual([]);
  });
});
