import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@jujia/shared-ipc';
import { pickWritableConfig, WRITABLE_CONFIG_KEYS } from './config-write';

/**
 * 配置写入白名单（轨道回归计划 2 · R-03）。
 *
 * 背景：此前"白名单外字段被静默丢弃"，导致权限模式切换看起来成功、实际没变。
 * 现在**必须显式拒绝**，并且这条约束要有单测 —— 否则变异测试咬不到（这是 R-03 的目的）。
 */

describe('pickWritableConfig', () => {
  it('合法字段照常放行（三个键都要在）', () => {
    const { clean, rejected } = pickWritableConfig({
      theme: 'dark',
      appearance: { packId: 'default-dark', pack: null },
      permissionMode: 'plan',
    });
    expect(rejected).toEqual([]);
    expect(clean.theme).toBe('dark');
    expect(clean.appearance).toEqual({ packId: 'default-dark', pack: null });
    expect(clean.permissionMode).toBe('plan');
  });

  it('**白名单外字段必须被拒绝**（不再是静默丢弃 —— 这是 S1 的根因）', () => {
    const { clean, rejected } = pickWritableConfig({ theme: 'dark', workspace: 'D:/evil' });
    expect(rejected).toEqual(['workspace']);
    expect(Object.keys(clean)).toEqual(['theme']);
  });

  it('高危清单同样不可写（安全字段不接受界面写入）', () => {
    const { rejected } = pickWritableConfig({ alwaysAskTools: ['write_file'] });
    expect(rejected).toEqual(['alwaysAskTools']);
  });

  it('「打开方式默认档」同样不接受界面写入（M10 收尾）', () => {
    // 它记的只是"下拉框停在哪一档"，不是授权；但写入由**主进程在真的打开成功之后**完成。
    // 少开一个"界面能写安全相关字段"的口子，同时省掉一次读-改-写竞态。
    const { clean, rejected } = pickWritableConfig({ theme: 'dark', browserOpenWith: 'custom' });
    expect(rejected).toEqual(['browserOpenWith']);
    expect(clean.browserOpenWith).toBeUndefined();
    expect(Object.keys(clean)).toEqual(['theme']);
  });

  it('多个越权字段一次全部报出来（不是只报第一个）', () => {
    const { rejected } = pickWritableConfig({
      workspace: 'D:/x',
      alwaysAskTools: [],
      browserOpenWith: 'system',
      theme: 'light',
    });
    expect(rejected.sort()).toEqual(['alwaysAskTools', 'browserOpenWith', 'workspace']);
  });

  it('`permissionMode` 的任何合法取值都能写（**不能只放行某个特殊值**）', () => {
    for (const mode of ['default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions'] as const) {
      const { clean, rejected } = pickWritableConfig({ permissionMode: mode });
      expect(rejected).toEqual([]);
      expect(clean.permissionMode).toBe(mode);
    }
  });

  it('空 patch：什么都不写、什么都不拒（幂等，不产生副作用）', () => {
    const { clean, rejected } = pickWritableConfig({});
    expect(clean).toEqual({});
    expect(rejected).toEqual([]);
  });

  it('显式 undefined 不算一次写入（配合 exactOptionalPropertyTypes）', () => {
    // 需要断言：zod 的 parse 结果在 exactOptionalPropertyTypes 下可能带显式 undefined。
    // 这里必须断言绕过类型（该类型本身禁止显式 undefined），但**测的是真实运行时输入**。
    //
    // 注意（变异 M4 曾逃逸）：**必须用"不可写键 + undefined"来测**。
    // 用可写键（如 theme）测不出差异 —— 可写键本来就不会被拒，删掉守卫也看不出来。
    const withExplicitUndefined = {
      workspace: undefined,
      theme: undefined,
    } as unknown as Partial<AppConfig>;
    const { clean, rejected } = pickWritableConfig(withExplicitUndefined);
    expect(rejected).toEqual([]); // 关键：**不能**因为 undefined 值就报"不允许写入"
    expect(clean).toEqual({});
  });

  it('白名单可注入：注入后以注入的为准（便于将来调整而不改本文件）', () => {
    const { clean, rejected } = pickWritableConfig({ permissionMode: 'plan' }, ['theme']);
    expect(rejected).toEqual(['permissionMode']);
    expect(clean).toEqual({});
  });

  it('白名单常量本身就是"三个键"（防它被悄悄改宽）', () => {
    expect([...WRITABLE_CONFIG_KEYS]).toEqual(['theme', 'appearance', 'permissionMode']);
  });
});
