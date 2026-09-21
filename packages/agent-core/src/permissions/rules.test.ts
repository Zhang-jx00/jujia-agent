import { describe, expect, it } from 'vitest';
import {
  checkRuleInput,
  globToRegExp,
  isDenyAllPattern,
  matchRules,
  ruleMatches,
  type PermissionRule,
} from './rules';

function rule(over: Partial<PermissionRule> = {}): PermissionRule {
  return {
    id: 'r1',
    pattern: 'mcp__*',
    action: 'deny',
    enabled: true,
    createdAt: '2026-09-21T00:00:00.000Z',
    updatedAt: '2026-09-21T00:00:00.000Z',
    ...over,
  };
}

describe('globToRegExp（用户输入直接进正则是注入面）', () => {
  it('`*` 不跨路径分隔符，`**` 全匹配，`?` 单个非分隔符字符', () => {
    expect(globToRegExp('mcp__*').test('mcp__read_file')).toBe(true);
    expect(globToRegExp('mcp__*').test('mcp__a/b')).toBe(false);
    expect(globToRegExp('**').test('a/b/c')).toBe(true);
    expect(globToRegExp('read_?ile').test('read_file')).toBe(true);
    expect(globToRegExp('read_?ile').test('read__file')).toBe(false);
  });

  it('正则元字符被转义（`(` `.` `+` 都按字面匹配）', () => {
    expect(globToRegExp('a(b).c+').test('a(b).c+')).toBe(true);
    expect(globToRegExp('a(b).c+').test('aabcc')).toBe(false);
  });

  it('锚定整串（不是"包含"）', () => {
    expect(globToRegExp('read').test('read_file')).toBe(false);
    expect(globToRegExp('*read*').test('read_file')).toBe(true);
  });

  it('空模式只匹配空串（因此 ruleMatches 会直接判不命中）', () => {
    expect(globToRegExp('').test('')).toBe(true);
    expect(ruleMatches(rule({ pattern: '  ' }), 'read_file')).toBe(false);
  });
});

describe('matchRules（跨类取最严格，同类取列表顺序第一个）', () => {
  it('命中单条启用规则', () => {
    const m = matchRules([rule({ pattern: 'read_file', action: 'deny', note: '不想让它读' })], 'read_file');
    expect(m?.action).toBe('deny');
    expect(m?.reason).toContain('read_file');
    expect(m?.reason).toContain('不想让它读');
  });

  it('deny 压过 ask 与 allow（最严格一侧胜出）', () => {
    const m = matchRules(
      [rule({ id: 'a', pattern: '*', action: 'allow' }), rule({ id: 'b', pattern: '*', action: 'deny' })],
      'write_file',
    );
    expect(m?.action).toBe('deny');
  });

  it('ask 压过 allow', () => {
    const m = matchRules(
      [rule({ id: 'a', pattern: '*', action: 'allow' }), rule({ id: 'b', pattern: '*', action: 'ask' })],
      'write_file',
    );
    expect(m?.action).toBe('ask');
  });

  it('禁用的规则不参与判定', () => {
    expect(matchRules([rule({ enabled: false, action: 'deny' })], 'read_file')).toBeNull();
  });

  it('没有命中 → null（交给模式判定）', () => {
    expect(matchRules([rule({ pattern: 'git_*' })], 'read_file')).toBeNull();
    expect(matchRules([], 'read_file')).toBeNull();
  });

  it('同类规则取列表顺序第一个（列表顺序即语义顺序）', () => {
    const rules = [
      rule({ id: 'first', pattern: 'mcp__*', action: 'deny', note: '第一条' }),
      rule({ id: 'second', pattern: 'mcp__read*', action: 'allow', note: '第二条' }),
    ];
    // first(deny) 在前且命中 → 生效的是它（同为命中，deny 更严格）
    expect(matchRules(rules, 'mcp__read_file')?.rule.id).toBe('first');
  });
});

describe('checkRuleInput（在落盘之前把住）', () => {
  it('合法输入通过', () => {
    const c = checkRuleInput({ pattern: 'mcp__*', action: 'deny' });
    expect(c.ok).toBe(true);
    expect(c.errors).toEqual([]);
  });

  it('空模式 / 过长 / 换行 / 非法动作 / 超长备注都被拒绝', () => {
    expect(checkRuleInput({ pattern: '   ', action: 'deny' }).ok).toBe(false);
    expect(checkRuleInput({ pattern: 'x'.repeat(201), action: 'deny' }).ok).toBe(false);
    expect(checkRuleInput({ pattern: 'a\nb', action: 'deny' }).ok).toBe(false);
    expect(checkRuleInput({ pattern: 'a', action: '随便' }).ok).toBe(false);
    expect(checkRuleInput({ pattern: 'a', action: 'deny', note: 'x'.repeat(201) }).ok).toBe(false);
  });

  it('deny 所有工具 → 合法但给醒目警告（不静默接受也不武断拒绝）', () => {
    const c = checkRuleInput({ pattern: '*', action: 'deny' });
    expect(c.ok).toBe(true);
    expect(c.warnings.join('|')).toContain('拒绝所有工具');
    expect(checkRuleInput({ pattern: '**', action: 'deny' }).warnings.length).toBe(1);
    // 窄模式不该误报
    expect(checkRuleInput({ pattern: 'mcp__*', action: 'deny' }).warnings).toEqual([]);
  });

  it('allow/ask 全匹配不给"拒绝所有"警告（语义不同）', () => {
    expect(checkRuleInput({ pattern: '*', action: 'allow' }).warnings).toEqual([]);
    expect(checkRuleInput({ pattern: '*', action: 'ask' }).warnings).toEqual([]);
  });
});

describe('isDenyAllPattern', () => {
  it('识别一刀切模式，放过窄模式', () => {
    expect(isDenyAllPattern('*')).toBe(true);
    expect(isDenyAllPattern('**')).toBe(true);
    // `?` 只匹配单字符工具名，不是一刀切
    expect(isDenyAllPattern('?')).toBe(false);
    expect(isDenyAllPattern('mcp__*')).toBe(false);
    expect(isDenyAllPattern('*_file')).toBe(false);
    expect(isDenyAllPattern('a*')).toBe(false);
  });
});
