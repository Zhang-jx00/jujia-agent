import { describe, expect, it } from 'vitest';
import { permissionModeSchema } from '@jujia/shared-ipc';
import { PERMISSION_MODES } from './policy';

/**
 * 权限模式的**跨包一致性锁**（轨道回归计划 2 · R-05）。
 *
 * 背景：`agent-core` 与 `shared-ipc` **各自独立定义**了一份权限模式
 * （shared-ipc 刻意不依赖 agent-core —— 那是它的设计约束，不是疏忽）。
 * 问题不是"有两份"，而是**两份可以悄悄漂移**：一边加了新模式，另一边不会编译报错。
 *
 * 处置：不强行合并（会破坏分包边界），而是用这条测试把两边**钉在一起**。
 * 谁增删模式而忘了另一边，这里立刻红。
 */

describe('权限模式：两个包的定义必须完全一致', () => {
  it('成员集合逐一相同（顺序也一致，便于人眼比对）', () => {
    const fromContract = permissionModeSchema.options;
    expect([...fromContract]).toEqual([...PERMISSION_MODES]);
  });

  it('数量相同，且都是 5 种（新增模式必须同时改两处 + 文档）', () => {
    expect(PERMISSION_MODES).toHaveLength(5);
    expect(permissionModeSchema.options).toHaveLength(5);
  });

  it('契约能接受 agent-core 的每一个合法值（防"能定义不能存"）', () => {
    for (const mode of PERMISSION_MODES) {
      expect(permissionModeSchema.safeParse(mode).success).toBe(true);
    }
  });

  it('危险模式 `bypassPermissions` 必须在两边都存在（不能被单侧悄悄删掉）', () => {
    expect(PERMISSION_MODES).toContain('bypassPermissions');
    expect(permissionModeSchema.options).toContain('bypassPermissions');
  });
});
