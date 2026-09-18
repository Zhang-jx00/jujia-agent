import { describe, expect, it } from 'vitest';
import { ToolCallAccumulator } from './tool-call-accumulator';

/**
 * 拼装器是 W4 的地基，用例对应知识卡片 011 里「想当然就会错」的每一条。
 */
describe('ToolCallAccumulator：按 index 归位', () => {
  it('单个调用被切成多帧 → 正确拼出 name 与 arguments', () => {
    const acc = new ToolCallAccumulator();
    acc.push([{ index: 0, id: 'call_1', function: { name: 'write_', arguments: '{"pa' } }]);
    acc.push([{ index: 0, function: { name: 'file', arguments: 'th":"a.txt","content":"hi"}' } }]);

    const calls = acc.finish();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.id).toBe('call_1');
    expect(calls[0]?.name).toBe('write_file'); // 关键：name 必须串接
    expect(calls[0]?.arguments).toEqual({ path: 'a.txt', content: 'hi' });
    expect(calls[0]?.parseError).toBeNull();
  });

  it('两个调用交错到达 → 不能按到达顺序 append（否则参数错位）', () => {
    const acc = new ToolCallAccumulator();
    // 交错：先 index=1 的首片，再 index=0，再 index=1 的尾片……
    acc.push([{ index: 1, id: 'c1', function: { name: 'list_dir', arguments: '{"path"' } }]);
    acc.push([{ index: 0, id: 'c0', function: { name: 'read_file', arguments: '{"path"' } }]);
    acc.push([{ index: 1, function: { arguments: ':"."}' } }]);
    acc.push([{ index: 0, function: { arguments: ':"README.md"}' } }]);

    const calls = acc.finish();
    expect(calls.map((c) => c.index)).toEqual([0, 1]); // 按 index 排序
    expect(calls[0]?.name).toBe('read_file');
    expect(calls[0]?.arguments).toEqual({ path: 'README.md' });
    expect(calls[1]?.name).toBe('list_dir');
    expect(calls[1]?.arguments).toEqual({ path: '.' });
  });

  it('arguments 未闭合时（流被截断）→ 给 parseError 而不是抛异常', () => {
    const acc = new ToolCallAccumulator();
    acc.push([{ index: 0, id: 'c0', function: { name: 'write_file', arguments: '{"path":"a.tx' } }]);

    const calls = acc.finish();
    expect(calls[0]?.arguments).toBeNull();
    expect(calls[0]?.parseError).toBeTruthy();
    expect(calls[0]?.argumentsText).toBe('{"path":"a.tx');
  });

  it('无参调用（空 arguments）→ 视为合法空对象', () => {
    const acc = new ToolCallAccumulator();
    acc.push([{ index: 0, id: 'c0', function: { name: 'list_dir' } }]);

    const calls = acc.finish();
    expect(calls[0]?.arguments).toEqual({});
    expect(calls[0]?.parseError).toBeNull();
  });

  it('arguments 是数组或标量 → 明确报「不是 JSON 对象」', () => {
    const acc = new ToolCallAccumulator();
    acc.push([{ index: 0, id: 'c0', function: { name: 'x', arguments: '[1,2]' } }]);
    expect(acc.finish()[0]?.parseError).toContain('不是 JSON 对象');
  });

  it('缺少 id 时给出稳定的兜底 id（后续 tool 消息需要它配对）', () => {
    const acc = new ToolCallAccumulator();
    acc.push([{ index: 3, function: { name: 'x', arguments: '{}' } }]);
    expect(acc.finish()[0]?.id).toBe('call_3');
  });

  it('hasCalls / reset 行为正确', () => {
    const acc = new ToolCallAccumulator();
    expect(acc.hasCalls()).toBe(false);
    acc.push(undefined);
    acc.push([]);
    expect(acc.hasCalls()).toBe(false);
    acc.push([{ index: 0, function: { name: 'x', arguments: '{}' } }]);
    expect(acc.hasCalls()).toBe(true);
    acc.reset();
    expect(acc.hasCalls()).toBe(false);
  });

  it('中文参数跨帧拼装不乱码', () => {
    const acc = new ToolCallAccumulator();
    const json = JSON.stringify({ path: '文档/说明.md', content: '你好，俱佳' });
    const mid = Math.floor(json.length / 2);
    acc.push([{ index: 0, id: 'c0', function: { name: 'write_file', arguments: json.slice(0, mid) } }]);
    acc.push([{ index: 0, function: { arguments: json.slice(mid) } }]);
    expect(acc.finish()[0]?.arguments).toEqual({ path: '文档/说明.md', content: '你好，俱佳' });
  });
});
