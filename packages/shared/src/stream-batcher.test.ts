import { describe, expect, it, vi } from 'vitest';
import {
  createDeltaBatcher,
  DEFAULT_WINDOW_SIZE,
  windowedSlice,
  type Scheduler,
} from './stream-batcher';

/** 手动调度器：让测试精确控制"帧"何时到来 */
function manualScheduler(): Scheduler & { tick: () => void; cancelled: number } {
  let queue: Array<{ h: number; cb: () => void }> = [];
  let seq = 0;
  const state = {
    cancelled: 0,
    schedule(cb: () => void): number {
      const h = (seq += 1);
      queue.push({ h, cb });
      return h;
    },
    cancel(h: number): void {
      state.cancelled += 1;
      queue = queue.filter((q) => q.h !== h);
    },
    tick(): void {
      const current = queue;
      queue = [];
      for (const q of current) q.cb();
    },
  };
  return state;
}

describe('createDeltaBatcher：流式增量合批', () => {
  it('同一帧内多次 push → 只 flush 一次，内容与顺序完整', () => {
    const sched = manualScheduler();
    const flushed: string[][] = [];
    const b = createDeltaBatcher<string>((items) => flushed.push(items), sched);

    b.push('a');
    b.push('b');
    b.push('c');

    expect(flushed).toEqual([]); // 帧还没到，不应提前 flush
    expect(b.pendingCount()).toBe(3);
    sched.tick();

    expect(flushed).toEqual([['a', 'b', 'c']]); // 一次 flush，顺序不变
    expect(b.pendingCount()).toBe(0);
  });

  it('flush 之后再次 push → 会重新排帧（不会永久失效）', () => {
    const sched = manualScheduler();
    const flushed: string[][] = [];
    const b = createDeltaBatcher<string>((items) => flushed.push(items), sched);

    b.push('a');
    sched.tick();
    b.push('b');
    sched.tick();

    expect(flushed).toEqual([['a'], ['b']]);
  });

  it('flushNow 立刻冲刷（结束/卸载前不丢最后一段）', () => {
    const sched = manualScheduler();
    const flushed: string[][] = [];
    const b = createDeltaBatcher<string>((items) => flushed.push(items), sched);

    b.push('tail');
    b.flushNow();

    expect(flushed).toEqual([['tail']]);
    expect(b.pendingCount()).toBe(0);
    sched.tick();
    expect(flushed).toHaveLength(1); // 不会重复 flush
  });

  it('dispose 后不再有任何回调，且取消待执行的帧（防已卸载组件被回调）', () => {
    const sched = manualScheduler();
    const flush = vi.fn();
    const b = createDeltaBatcher<string>(flush, sched);

    b.push('x');
    b.dispose();
    sched.tick();

    expect(flush).not.toHaveBeenCalled();
    expect(sched.cancelled).toBeGreaterThan(0);
    b.push('y'); // dispose 后 push 应被忽略
    sched.tick();
    expect(flush).not.toHaveBeenCalled();
  });

  it('空 push 不会产生空 flush', () => {
    const sched = manualScheduler();
    const flush = vi.fn();
    createDeltaBatcher<string>(flush, sched);
    sched.tick();
    expect(flush).not.toHaveBeenCalled();
  });
});

describe('windowedSlice：长列表窗口化', () => {
  it('未超限时全部可见、无需展开入口', () => {
    const r = windowedSlice([1, 2, 3], 10);
    expect(r.visible).toEqual([1, 2, 3]);
    expect(r.hiddenCount).toBe(0);
  });

  it('超限时只保留末尾 N 条，并给出被裁掉的数量', () => {
    const items = Array.from({ length: 500 }, (_, i) => i);
    const r = windowedSlice(items, DEFAULT_WINDOW_SIZE);
    expect(r.visible).toHaveLength(DEFAULT_WINDOW_SIZE);
    expect(r.visible[0]).toBe(500 - DEFAULT_WINDOW_SIZE); // 是末尾，不是开头
    expect(r.visible.at(-1)).toBe(499);
    expect(r.hiddenCount).toBe(500 - DEFAULT_WINDOW_SIZE);
  });

  it('size 非法（0/负数/小数）时兜底为至少 1 条', () => {
    expect(windowedSlice([1, 2, 3], 0).visible).toHaveLength(1);
    expect(windowedSlice([1, 2, 3], -5).visible).toHaveLength(1);
    expect(windowedSlice([1, 2, 3], 2.9).visible).toEqual([2, 3]);
  });

  it('不修改原数组（纯函数）', () => {
    const items = [1, 2, 3, 4];
    windowedSlice(items, 2);
    expect(items).toEqual([1, 2, 3, 4]);
  });
});
