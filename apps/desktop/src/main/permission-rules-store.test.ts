import { describe, expect, it } from 'vitest';
import type { PermissionRule } from '@jujia/agent-core';
import { createMemoryPermissionRulesStore } from './permission-rules-store';

function existing(over: Partial<PermissionRule> = {}): PermissionRule {
  return {
    id: 'seed',
    pattern: 'git_*',
    action: 'allow',
    enabled: true,
    createdAt: '2026-09-21T00:00:00.000Z',
    updatedAt: '2026-09-21T00:00:00.000Z',
    ...over,
  };
}

describe('权限规则存储（校验走同一段代码）', () => {
  it('新增会落盘并带时间戳；列表能读回来', async () => {
    const store = createMemoryPermissionRulesStore();
    const record = await store.add({ pattern: 'mcp__*', action: 'deny', note: '不让外部工具跑' });
    expect(record.enabled).toBe(true);
    expect(record.pattern).toBe('mcp__*');
    expect(record.createdAt).not.toBe('');
    expect((await store.list())).toHaveLength(1);
  });

  it('非法输入被拒绝且不落盘（shell 注入面在 glob 转义处已收口）', async () => {
    const store = createMemoryPermissionRulesStore();
    await expect(store.add({ pattern: '', action: 'deny' })).rejects.toThrow(/被拒绝/);
    await expect(store.add({ pattern: 'a', action: '随便' as never })).rejects.toThrow(/被拒绝/);
    await expect(store.add({ pattern: 'x'.repeat(201), action: 'allow' })).rejects.toThrow(/被拒绝/);
    expect(await store.list()).toEqual([]);
  });

  it('同模式同动作的启用规则不允许重复（避免列表混乱）', async () => {
    const store = createMemoryPermissionRulesStore();
    await store.add({ pattern: 'mcp__*', action: 'deny' });
    await expect(store.add({ pattern: 'mcp__*', action: 'deny' })).rejects.toThrow(/已存在相同的启用规则/);
    // 不同动作可以并存（deny + ask 同 pattern 是有意义的：ask 被禁用后 deny 兜底）
    await store.add({ pattern: 'mcp__*', action: 'ask' });
    expect(await store.list()).toHaveLength(2);
  });

  it('pattern 会去掉首尾空白后再比较与落盘', async () => {
    const store = createMemoryPermissionRulesStore();
    const record = await store.add({ pattern: '  mcp__*  ', action: 'deny' });
    expect(record.pattern).toBe('mcp__*');
  });

  it('remove 返回是否真的删掉了', async () => {
    const store = createMemoryPermissionRulesStore([existing()]);
    expect(await store.remove('seed')).toBe(true);
    expect(await store.remove('seed')).toBe(false);
    expect(await store.list()).toEqual([]);
  });

  it('setEnabled 只改目标规则；不存在的 id 返回 null（不静默成功）', async () => {
    const store = createMemoryPermissionRulesStore([existing(), existing({ id: 'other' })]);
    const updated = await store.setEnabled('seed', false);
    expect(updated?.enabled).toBe(false);
    const all = await store.list();
    expect(all.find((r) => r.id === 'seed')?.enabled).toBe(false);
    expect(all.find((r) => r.id === 'other')?.enabled).toBe(true);
    expect(await store.setEnabled('不存在', true)).toBeNull();
  });

  it('deny 一切的规则能保存（合法），由 UI 负责醒目提示', async () => {
    const store = createMemoryPermissionRulesStore();
    const record = await store.add({ pattern: '*', action: 'deny' });
    expect(record.pattern).toBe('*');
  });
});

/**
 * 命令前缀（M4 收尾 · 其一）。
 *
 * 存储这一层要锁两件事：前缀**存得下来**（否则规则列表里看不见=以为没生效），
 * 以及"去重"要按三元组算 —— 同一个工具、同一个动作、不同的命令前缀，
 * 是两条都成立的规则（`rm -rf` 拒、`git push` 问），把它们判成重复就等于只允许一条。
 */
describe('命令前缀存取', () => {
  it('前缀会去掉首尾空白后存下来，并原样读回', async () => {
    const store = createMemoryPermissionRulesStore();
    const record = await store.add({ pattern: 'run_command', action: 'deny', argPrefix: '  rm -rf  ' });
    expect(record.argPrefix).toBe('rm -rf');
    expect((await store.list())[0]?.argPrefix).toBe('rm -rf');
  });

  it('不填前缀的规则保持没有这个字段（老规则不受影响）', async () => {
    const store = createMemoryPermissionRulesStore();
    const record = await store.add({ pattern: 'mcp__*', action: 'deny' });
    expect(record.argPrefix).toBeUndefined();
  });

  it('allow + 前缀在落盘之前就被拒（校验只有一处：agent-core 的 checkRuleInput）', async () => {
    const store = createMemoryPermissionRulesStore();
    await expect(
      store.add({ pattern: 'run_command', action: 'allow', argPrefix: 'git status' }),
    ).rejects.toThrow(/只能用来收紧/);
    expect(await store.list()).toEqual([]);
  });

  it('同工具同动作、不同前缀是两条规则；三者全同才算重复', async () => {
    const store = createMemoryPermissionRulesStore();
    await store.add({ pattern: 'run_command', action: 'deny', argPrefix: 'rm -rf' });
    await store.add({ pattern: 'run_command', action: 'deny', argPrefix: 'git push' });
    expect(await store.list()).toHaveLength(2);
    await expect(store.add({ pattern: 'run_command', action: 'deny', argPrefix: 'rm -rf' })).rejects.toThrow(
      /已存在相同的启用规则/,
    );
    // 无前缀与前缀版也不是一条规则：前者管全部命令，后者只管一段
    await store.add({ pattern: 'run_command', action: 'deny' });
    expect(await store.list()).toHaveLength(3);
  });
});
