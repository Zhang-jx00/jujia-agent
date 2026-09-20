/**
 * 流式增量的合批器与长列表窗口化（W6/W7）。
 *
 * **为什么抽成独立模块**：这两段逻辑原先写在 React 组件里，导致「合批被去掉」
 * 「窗口化上限被改坏」这类退化**没有任何测试能发现**（复核 006 的发现 R1）。
 * 抽成纯函数 + 可注入调度器后即可单测与变异测试。
 */

/** 可注入的调度器：默认用 requestAnimationFrame，测试用同步实现 */
export interface Scheduler {
  schedule: (cb: () => void) => number;
  cancel: (handle: number) => void;
}

/**
 * 该包不加载 DOM lib（保持可在 Node 下复用），因此这里用窄类型读全局 rAF；
 * 没有 rAF 时退回 setTimeout(16ms) —— 语义仍是"下一帧"。
 */
interface RafHost {
  requestAnimationFrame?: ((cb: () => void) => number) | undefined;
  cancelAnimationFrame?: ((h: number) => void) | undefined;
}
const rafHost = globalThis as unknown as RafHost;

export const rafScheduler: Scheduler = {
  schedule: (cb) => (rafHost.requestAnimationFrame ? rafHost.requestAnimationFrame(cb) : (setTimeout(cb, 16) as unknown as number)),
  cancel: (h) => rafHost.cancelAnimationFrame?.(h),
};

/** 测试用：立即执行（不需要真的等一帧） */
export function immediateScheduler(): Scheduler {
  let seq = 0;
  const pending = new Map<number, () => void>();
  return {
    schedule: (cb) => {
      const h = (seq += 1);
      pending.set(h, cb);
      return h;
    },
    cancel: (h) => {
      pending.delete(h);
    },
  };
}

export interface DeltaBatch<T> {
  push: (item: T) => void;
  /** 立刻冲刷未处理的增量（卸载/结束时调用，避免丢最后一段） */
  flushNow: () => void;
  /** 取消待执行的帧回调（卸载时调用，避免回调打到已卸载组件） */
  dispose: () => void;
  pendingCount: () => number;
}

/**
 * 把高频 push 合并成"每帧一次 flush"。
 *
 * 语义保证（这三条正是要测的东西）：
 * 1. 同一帧内多次 push → 只触发一次 flush，且**顺序与内容完整**；
 * 2. flush 之后再次 push → 会重新排一次帧回调（不会永久失效）；
 * 3. dispose 之后不再有任何回调（防止已卸载组件被回调）。
 */
export function createDeltaBatcher<T>(
  flush: (items: T[]) => void,
  scheduler: Scheduler = rafScheduler,
): DeltaBatch<T> {
  let buffer: T[] = [];
  let handle: number | null = null;
  let disposed = false;

  const runFlush = (): void => {
    handle = null;
    if (disposed || buffer.length === 0) return;
    const items = buffer;
    buffer = [];
    flush(items);
  };

  return {
    push(item: T): void {
      if (disposed) return;
      buffer.push(item);
      if (handle === null) handle = scheduler.schedule(runFlush);
    },
    flushNow(): void {
      if (handle !== null) {
        scheduler.cancel(handle);
        handle = null;
      }
      runFlush();
    },
    dispose(): void {
      disposed = true;
      if (handle !== null) {
        scheduler.cancel(handle);
        handle = null;
      }
      buffer = [];
    },
    pendingCount(): number {
      return buffer.length;
    },
  };
}

/**
 * 长列表窗口化：只保留末尾 `size` 条，返回是否需要显示"更早"入口与被裁掉的数量。
 * 默认 size 120 —— 上万个 DOM 节点是滚动卡顿的主因，先把常驻节点数压住。
 */
export const DEFAULT_WINDOW_SIZE = 120;

export interface WindowedResult<T> {
  visible: T[];
  hiddenCount: number;
}

export function windowedSlice<T>(items: readonly T[], size: number): WindowedResult<T> {
  const safeSize = Math.max(1, Math.floor(size));
  if (items.length <= safeSize) return { visible: [...items], hiddenCount: 0 };
  return { visible: items.slice(items.length - safeSize), hiddenCount: items.length - safeSize };
}
