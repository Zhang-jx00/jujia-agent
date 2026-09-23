import { describe, expect, it } from 'vitest';
import { needsEviction, pickEvictionCandidate, type EvictableSession } from './session-lru';

/**
 * 会话淘汰策略（轨道回归计划 1 · M1）。
 * 背景：`sessions` 此前**只增不删**，长时间使用内存单调上涨。
 */

const s = (id: string, lastUsedAt: number, running = false): EvictableSession => ({
  id,
  lastUsedAt,
  running,
});

describe('pickEvictionCandidate', () => {
  it('未达上限时不淘汰', () => {
    expect(pickEvictionCandidate([s('a', 1)], 20)).toBeNull();
  });

  it('达到上限时淘汰**最久未使用**的（不是最早创建的）', () => {
    // 注意：输入顺序与"最久未用"相反，防止"取第一个"也能蒙对
    const picked = pickEvictionCandidate([s('newest', 300), s('middle', 200), s('oldest', 100)], 3);
    expect(picked).toBe('oldest');
  });

  it('正在运行的会话**不淘汰**（不能打断用户正在等的对话）', () => {
    const picked = pickEvictionCandidate([s('running-old', 100, true), s('idle-new', 200)], 2);
    expect(picked).toBe('idle-new');
  });

  it('全都在运行时返回 null（宁可暂时超上限，也不打断）', () => {
    expect(pickEvictionCandidate([s('a', 1, true), s('b', 2, true)], 2)).toBeNull();
  });

  it('上限 <= 0 属非法配置 → 不淘汰（保守，避免"上限 0 把会话全删"）', () => {
    expect(pickEvictionCandidate([s('a', 1)], 0)).toBeNull();
    expect(pickEvictionCandidate([s('a', 1)], -5)).toBeNull();
  });

  it('输入为空时不炸', () => {
    expect(pickEvictionCandidate([], 3)).toBeNull();
  });
});

describe('needsEviction', () => {
  it('等于或超过上限就该淘汰（边界写清楚，避免差 1 的错）', () => {
    expect(needsEviction(19, 20)).toBe(false);
    expect(needsEviction(20, 20)).toBe(true);
    expect(needsEviction(21, 20)).toBe(true);
  });
});
