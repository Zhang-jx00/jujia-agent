import { describe, expect, it } from 'vitest';
import { createOutputPump, createToolOutputStream } from './output-pump';

/**
 * 长命令的**实时输出合并泵**（R8.7 · M4 收尾其三）。
 *
 * 为什么要有这一层：`run_command` 的子进程按块吐数据，快的命令一秒能出几十块。
 * 一块推一次 IPC 会有两个坏处：① 渲染层被同一句话的不同碎片反复重绘；
 * ② IPC 事件数量没有上界（一条 256KB 的刷屏输出能打出几千个事件）。
 *
 * 所以这里刻意**只用字节上界，不用定时器**：
 * 攒够一批就交、剩下的等 `flush()`。理由写在这儿防后来人"顺手加个 200ms 节流"——
 * 定时器会带来三个这里根本不需要担心的东西：用户中途停止时漏掉最后一次 flush、
 * 测试要造假时钟、以及"事件在命令结束之后才到达"这种顺序颠倒。
 */

describe('createOutputPump（按字节批量、零丢失）', () => {
  it('没攒够不上限就不交：界面不会看见半句话碎片', () => {
    const pushed: string[] = [];
    const pump = createOutputPump({ maxChars: 20, push: (t) => pushed.push(t) });
    pump.feed('abc');
    pump.feed('def');
    expect(pushed).toEqual([]);
    expect(pump.buffered()).toBe(6);
  });

  it('攒够上限就交，交出的是攒到的整段（顺序不重排）', () => {
    const pushed: string[] = [];
    const pump = createOutputPump({ maxChars: 10, push: (t) => pushed.push(t) });
    pump.feed('12345');
    pump.feed('67890ab');
    expect(pushed).toEqual(['1234567890']);
    expect(pump.buffered()).toBe(2);
  });

  it('单块就超过上限：切成多段交出，一段都不丢', () => {
    const pushed: string[] = [];
    const pump = createOutputPump({ maxChars: 4, push: (t) => pushed.push(t) });
    pump.feed('abcdefghij');
    expect(pushed).toEqual(['abcd', 'efgh']);
    pump.flush();
    expect(pushed).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('flush 交出尾巴，且第二次 flush 不重复交（幂等 —— 收尾会被两条路径各调一次）', () => {
    const pushed: string[] = [];
    const pump = createOutputPump({ maxChars: 10, push: (t) => pushed.push(t) });
    pump.feed('tail-only');
    pump.flush();
    expect(pushed).toEqual(['tail-only']);
    pump.flush();
    expect(pushed).toEqual(['tail-only']);
    expect(pump.buffered()).toBe(0);
  });

  it('空字符串不产生事件（子进程会发空 chunk，界面不该因此多一行）', () => {
    const pushed: string[] = [];
    const pump = createOutputPump({ maxChars: 1, push: (t) => pushed.push(t) });
    pump.feed('');
    pump.flush();
    expect(pushed).toEqual([]);
  });

  it('零丢失：所有交出片段按序拼接 == 全部输入拼接（含最后一段尾巴）', () => {
    const pushed: string[] = [];
    const pump = createOutputPump({ maxChars: 7, push: (t) => pushed.push(t) });
    const inputs = ['中文输出第一行\n', 'x'.repeat(30), '\nstderr 片段', '尾'];
    for (const s of inputs) pump.feed(s);
    pump.flush();
    expect(pushed.join('')).toBe(inputs.join(''));
  });

  it('flush 之后继续 feed 照常工作（同一个 callId 的整条命令不会只流一次）', () => {
    const pushed: string[] = [];
    const pump = createOutputPump({ maxChars: 3, push: (t) => pushed.push(t) });
    pump.feed('aaa');
    pump.flush();
    pump.feed('bbb');
    pump.flush();
    expect(pushed).toEqual(['aaa', 'bbb']);
  });

  it('上限被夹成正整数：0 或负数不会造成死循环，也不会一字节都不交', () => {
    const pushed: string[] = [];
    const pump = createOutputPump({ maxChars: 0, push: (t) => pushed.push(t) });
    pump.feed('ab');
    pump.flush();
    expect(pushed.join('')).toBe('ab');
  });

  it('上限不是整数时向下取整（IPC 单事件的大小必须是确定的）', () => {
    const pushed: string[] = [];
    const pump = createOutputPump({ maxChars: 2.9, push: (t) => pushed.push(t) });
    pump.feed('abcd');
    expect(pushed).toEqual(['ab', 'cd']);
  });
});

describe('createToolOutputStream（界面只看尾部快照，不看增量）', () => {  it('没到攒批门槛就一条都不交；交的是"截至此刻的整段尾部"，不是片段', () => {
    const tails: string[] = [];
    const s = createToolOutputStream({ maxTailChars: 100, flushChars: 10, pushTail: (t) => tails.push(t) });
    s.feed('abc');
    s.feed('def');
    expect(tails).toEqual([]);
    s.feed('ghijklmnop'); // 一共攒到 16 个新字符，够一批（一批 = 10）
    expect(tails).toEqual(['abcdefghij']);
    s.close();
    // close 把剩下 6 个字符补上，最后那一份快照是全文 —— 界面按它整段替换，不靠拼接
    expect(tails[tails.length - 1]).toBe('abcdefghijklmnop');
  });

  it('快照必须含最新内容：后一条是前一条的延续，界面做一次替换就等价于"接得回"', () => {
    const tails: string[] = [];
    const s = createToolOutputStream({ maxTailChars: 1000, flushChars: 4, pushTail: (t) => tails.push(t) });
    s.feed('第一段');
    s.feed('第二段');
    s.feed('第三');
    s.close();
    expect(tails.length).toBeGreaterThan(1);
    expect(tails[tails.length - 1]).toBe('第一段第二段第三');
  });

  it('尾部超过上限只留末尾，且留下的是最新那段（内存有界，不许无限长）', () => {
    const tails: string[] = [];
    const s = createToolOutputStream({ maxTailChars: 10, flushChars: 4, pushTail: (t) => tails.push(t) });
    s.feed('0123456789');
    s.feed('abcdefghij');
    s.close();
    for (const t of tails) expect(t.length).toBeLessThanOrEqual(10);
    expect(tails[tails.length - 1]).toBe('abcdefghij');
  });

  it('close 交出最后的尾巴；没有新内容时不重复交（工具结束与用户停止两条路都调 close）', () => {
    const tails: string[] = [];
    const s = createToolOutputStream({ maxTailChars: 100, flushChars: 50, pushTail: (t) => tails.push(t) });
    s.feed('短');
    s.close();
    expect(tails).toEqual(['短']);
    s.close();
    expect(tails).toEqual(['短']);
  });

  it('一个字都没输出 → 一条快照都不交（界面不会多出一行"实时输出："空的）', () => {
    const tails: string[] = [];
    const s = createToolOutputStream({ maxTailChars: 100, flushChars: 1, pushTail: (t) => tails.push(t) });
    s.feed('');
    s.close();
    expect(tails).toEqual([]);
  });

  it('close 之后再 feed 不炸（防"事件晚到"把主进程带崩，晚到的照常进下一段快照）', () => {
    const tails: string[] = [];
    const s = createToolOutputStream({ maxTailChars: 100, flushChars: 1, pushTail: (t) => tails.push(t) });
    s.feed('一');
    s.close();
    expect(() => {
      s.feed('二');
      s.close();
    }).not.toThrow();
    expect(tails[tails.length - 1]).toBe('一二');
  });

  it('快照拼接里保留换行与截断说明（不吞字，也不给命令"加"内容）', () => {
    const tails: string[] = [];
    const s = createToolOutputStream({ maxTailChars: 100, flushChars: 3, pushTail: (t) => tails.push(t) });
    s.feed('a\n');
    s.feed('b\n');
    s.feed('c');
    s.close();
    expect(tails[tails.length - 1]).toBe('a\nb\nc');
  });
});

/* ---------------- 静默期刷新：短输出也要看得见 ---------------- */

/** 假调度器：不靠真计时器，"到点"由测试自己按；cancel 与真 clearTimeout 同义（撤掉就不再触发） */
function fakeScheduler() {
  const pending = new Map<number, () => void>();
  let nextId = 0;
  let cancels = 0;
  return {
    schedule: (fn: () => void): number => {
      nextId += 1;
      pending.set(nextId, fn);
      return nextId;
    },
    cancel: (handle: unknown): void => {
      cancels += 1;
      pending.delete(handle as number);
    },
    fireAll(): void {
      const list = [...pending.values()];
      pending.clear();
      for (const fn of list) fn();
    },
    get armedCount(): number {
      return pending.size;
    },
    get cancelCount(): number {
      return cancels;
    },
  };
}

function quietPump(s: ReturnType<typeof fakeScheduler>, pushed: string[], maxChars = 2000) {
  return createOutputPump({
    maxChars,
    quietMs: 250,
    push: (t) => pushed.push(t),
    schedule: s.schedule,
    cancel: s.cancel,
  });
}

describe('按字节攒批的补角：静默期到点必须也交一次', () => {
  it('输出很短、之后一直没有新东西 → 到点仍然交出去（否则"先吐两行然后安静 30 秒"全程看不见）', () => {
    const pushed: string[] = [];
    const s = fakeScheduler();
    quietPump(s, pushed).feed('构建开始');
    expect(pushed).toEqual([]);
    s.fireAll();
    expect(pushed).toEqual(['构建开始']);
  });

  it('到点交过之后不许留悬空回调；再次 feed 会重新挂一个', () => {
    const pushed: string[] = [];
    const s = fakeScheduler();
    const pump = quietPump(s, pushed);
    pump.feed('a');
    s.fireAll();
    expect(s.armedCount).toBe(0);
    pump.feed('b');
    expect(s.armedCount).toBe(1);
    s.fireAll();
    expect(pushed).toEqual(['a', 'b']);
  });

  it('攒满一批直接交时要把静默定时器撤掉（不撤会紧接着再交一次空批次）', () => {
    const pushed: string[] = [];
    const s = fakeScheduler();
    const pump = quietPump(s, pushed, 4);
    pump.feed('ab'); // 先来半批：挂上静默定时器
    expect(s.armedCount).toBe(1);
    pump.feed('cd'); // 攒满一整批：立刻交，并撤掉那个定时器
    expect(pushed).toEqual(['abcd']);
    expect(s.cancelCount).toBeGreaterThan(0);
    expect(s.armedCount).toBe(0);
    s.fireAll();
    expect(pushed).toEqual(['abcd']);
  });

  it('flush 之后到点的定时器不许再交任何东西（收尾幂等，防"结束后又冒出一行"）', () => {
    const pushed: string[] = [];
    const s = fakeScheduler();
    const pump = quietPump(s, pushed);
    pump.feed('半句');
    pump.flush();
    expect(pushed).toEqual(['半句']);
    s.fireAll();
    expect(pushed).toEqual(['半句']);
  });

  it('不给 quietMs 与调度器时保持原样：只按字节攒批（纯同步场景不必被迫带计时器）', () => {
    const pushed: string[] = [];
    const pump = createOutputPump({ maxChars: 2000, push: (t) => pushed.push(t) });
    pump.feed('短');
    expect(pushed).toEqual([]);
    pump.flush();
    expect(pushed).toEqual(['短']);
  });
});
