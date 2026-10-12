import { describe, expect, it } from 'vitest';
import { createToolOutputRelay } from './tool-output-relay';

/**
 * 实时输出的**按调用分线**中转层（R8.7）。
 *
 * 为什么单独一个文件：`chat-service` 依赖 electron、进不了 vitest，
 * 而这里恰恰是本轮最容易出错的一层 —— 一次回答里模型可以连调好几个工具，
 * 每条输出必须回到**它自己那一次调用**的尾巴上。把这段状态机抽出来，
 * 它就能被单测与变异测试咬到（本仓的成例：判据长在可测的层，胶水只做胶水）。
 */

const MAX_TAIL = 20;
const FLUSH = 6;

function harness() {
  const sent: Array<{ callId: string; name: string; tail: string }> = [];
  const relay = createToolOutputRelay({
    maxTailChars: MAX_TAIL,
    flushChars: FLUSH,
    pushTail: (callId, name, tail) => sent.push({ callId, name, tail }),
  });
  return { relay, sent };
}

describe('createToolOutputRelay', () => {
  it('同一次调用的输出汇成一条尾部，攒够一批才发一份快照', () => {
    const { relay, sent } = harness();
    relay.onChunk('c1', 'run_command', 'abc');
    expect(sent.length).toBe(0);
    relay.onChunk('c1', 'run_command', 'defghi');
    // 一批正好 6 个字符：先发 'abcdef'，剩下 'ghi' 压在批次里等下一批或等收尾
    expect(sent.map((s) => s.tail)).toEqual(['abcdef']);
    relay.onEnd('c1');
    expect(sent[sent.length - 1]?.tail).toBe('abcdefghi');
  });

  it('两个调用各记各的尾巴：后一次调用的输出不许串到前一个气泡上', () => {
    const { relay, sent } = harness();
    relay.onChunk('cA', 'run_command', '第一波');
    relay.onChunk('cA', 'run_command', 'xxx'); // 凑满一批
    relay.onChunk('cB', 'run_command', '第二波');
    relay.onChunk('cB', 'run_command', 'yyy');
    const owners = sent.map((s) => `${s.callId}:${s.tail}`);
    expect(owners).toEqual(['cA:第一波xxx', 'cB:第二波yyy']);
  });

  it('结束时补发一次尾巴，之后该次调用被清掉（closeAll 不许再补第二遍）', () => {
    const { relay, sent } = harness();
    relay.onChunk('c1', 'run_command', '只剩尾巴');
    relay.onEnd('c1');
    expect(sent.length).toBe(1);
    expect(sent[0]?.tail).toBe('只剩尾巴');
    relay.closeAll();
    expect(sent.length).toBe(1);
  });

  it('中途停止也交尾巴：closeAll 把每条还活着的线各补发一次（已经跑出来的东西必须看得见）', () => {
    const { relay, sent } = harness();
    relay.onChunk('c1', 'run_command', 'aaa');
    relay.onChunk('c2', 'run_command', 'bbb');
    relay.closeAll();
    expect(sent.map((s) => `${s.callId}:${s.tail}`)).toEqual(['c1:aaa', 'c2:bbb']);
  });

  it('一个字都没输出的调用：结束与停止都不发快照（不许造空事件）', () => {
    const { relay, sent } = harness();
    relay.onEnd('c1');
    relay.closeAll();
    expect(sent.length).toBe(0);
  });

  it('只保留末尾若干个字符（长输出不许把主进程内存吃干净）', () => {
    const { relay, sent } = harness();
    relay.onChunk('c1', 'run_command', 'x'.repeat(MAX_TAIL + FLUSH * 3));
    for (const s of sent) expect(s.tail.length).toBeLessThanOrEqual(MAX_TAIL);
    expect(sent[sent.length - 1]?.tail).toBe('x'.repeat(MAX_TAIL));
  });

  it('结束之后再迟到的块不炸，照常起一条新线并在收尾时交出去', () => {
    const { relay, sent } = harness();
    relay.onChunk('c1', 'run_command', '早');
    relay.onEnd('c1');
    expect(() => {
      relay.onChunk('c1', 'run_command', '迟到');
      relay.onChunk('c1', 'run_command', '的块');
    }).not.toThrow();
    relay.closeAll();
    expect(sent[sent.length - 1]?.tail).toBe('迟到的块');
  });

  it('名称随事件带走（同一次调用的每条快照都说得出是哪个工具）', () => {
    const { relay, sent } = harness();
    relay.onChunk('c1', 'run_command', 'abcdef');
    expect(sent[0]?.name).toBe('run_command');
  });
});
