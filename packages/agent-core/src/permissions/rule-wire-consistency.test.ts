import { describe, expect, it } from 'vitest';
import { permissionRuleInputSchema, permissionRuleViewSchema } from '@jujia/shared-ipc';
import { checkRuleInput, MAX_ARG_PREFIX_LENGTH, MAX_PATTERN_LENGTH, type PermissionRule } from './rules';

/**
 * 权限规则的**跨包一致性锁**（M4 收尾 · 其一）。
 *
 * 与 `policy-consistency.test.ts` 同一条理由：`shared-ipc` 刻意不依赖 `agent-core`，
 * 于是"界面能填什么"和"引擎认什么"天然长成两份，可以悄悄漂移。
 * 规则表这次要加 `argPrefix`，漂移的后果不是报错而是**规则不生效**，所以先钉住再改。
 */

/** 存储里的一条真实记录长什么样（`note` / `argPrefix` 都是可选属性，可能整个不存在） */
function stored(over: Partial<PermissionRule> = {}): PermissionRule {
  return {
    id: 'r1',
    pattern: 'run_command',
    action: 'deny',
    enabled: true,
    createdAt: '2026-10-09T00:00:00.000Z',
    updatedAt: '2026-10-09T00:00:00.000Z',
    ...over,
  };
}

describe('规则存储 → 视图契约：没填的格子不能被当成非法', () => {
  it('不写备注的规则必须能过视图（否则权限页从此打不开）', () => {
    const parsed = permissionRuleViewSchema.safeParse(stored());
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.note).toBeNull();
  });

  it('不写命令前缀的规则同样能过视图，且前缀是 null 而不是缺失', () => {
    const parsed = permissionRuleViewSchema.safeParse(stored({ note: '写了备注' }));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.argPrefix).toBeNull();
  });

  it('写了前缀的规则，视图要把它原样带回去（界面上看不见=用户以为没生效）', () => {
    const parsed = permissionRuleViewSchema.safeParse(stored({ argPrefix: 'rm -rf' }));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.argPrefix).toBe('rm -rf');
  });

  it('显式 undefined 与整个字段缺失是同一件事（存储两种写法都能读回来）', () => {
    for (const rule of [stored({ note: undefined }), { ...stored(), note: undefined }]) {
      expect(permissionRuleViewSchema.safeParse(rule).success).toBe(true);
    }
  });
});

describe('长度上限：两个包必须写同一个数', () => {
  it('契约接受 checkRuleInput 接受的每一种长度', () => {
    const okPattern = 'a'.repeat(MAX_PATTERN_LENGTH);
    const okPrefix = 'a'.repeat(MAX_ARG_PREFIX_LENGTH);
    expect(permissionRuleInputSchema.safeParse({ pattern: okPattern, action: 'deny' }).success).toBe(true);
    expect(
      permissionRuleInputSchema.safeParse({ pattern: 'run_command', action: 'deny', argPrefix: okPrefix })
        .success,
    ).toBe(true);
  });

  it('契约拒掉的长度，checkRuleInput 也必须拒（不能只有界面拦得住）', () => {
    const tooLong = { pattern: 'a'.repeat(MAX_PATTERN_LENGTH + 1), action: 'deny' };
    expect(permissionRuleInputSchema.safeParse(tooLong).success).toBe(false);
    expect(checkRuleInput(tooLong).ok).toBe(false);

    const longPrefix = {
      pattern: 'run_command',
      action: 'deny',
      argPrefix: 'a'.repeat(MAX_ARG_PREFIX_LENGTH + 1),
    };
    expect(permissionRuleInputSchema.safeParse(longPrefix).success).toBe(false);
    expect(checkRuleInput(longPrefix).ok).toBe(false);
  });
});

describe('动作集合：两个包说的是同一件事', () => {
  it('契约枚举里的每个动作都能进 checkRuleInput，且 allow+前缀被引擎拒', () => {
    for (const action of permissionRuleInputSchema.shape.action.options) {
      expect(checkRuleInput({ pattern: 'run_command', action }).ok).toBe(true);
      const withPrefix = checkRuleInput({ pattern: 'run_command', action, argPrefix: 'git status' });
      expect(withPrefix.ok).toBe(action !== 'allow');
    }
  });
});
