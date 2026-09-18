import { describe, expect, it } from 'vitest';
import { createSseParser } from './sse';

describe('SSE 解析器：事件边界', () => {
  it('单个完整事件', () => {
    const p = createSseParser();
    expect(p.push('data: {"a":1}\n\n')).toEqual(['{"a":1}']);
  });

  it('一个 chunk 内含多个事件', () => {
    const p = createSseParser();
    expect(p.push('data: {"a":1}\n\ndata: {"b":2}\n\n')).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('事件被拆到多个 chunk（网络分块与事件边界无关）', () => {
    const p = createSseParser();
    expect(p.push('data: {"hel')).toEqual([]);
    expect(p.push('lo": "世')).toEqual([]);
    expect(p.push('界"}\n')).toEqual([]);
    expect(p.push('\n')).toEqual(['{"hello": "世界"}']);
  });

  it('一个 chunk 结束在事件中间，下一个 chunk 补完并携带新事件', () => {
    const p = createSseParser();
    expect(p.push('data: {"a":1}\n\ndata: {"b"')).toEqual(['{"a":1}']);
    expect(p.push(':2}\n\n')).toEqual(['{"b":2}']);
  });

  it('兼容 CRLF 换行（部分服务端/代理会改写）', () => {
    const p = createSseParser();
    expect(p.push('data: {"a":1}\r\n\r\n')).toEqual(['{"a":1}']);
  });

  it('忽略注释/心跳行，不打断事件', () => {
    const p = createSseParser();
    expect(p.push(': ping\n\ndata: {"a":1}\n\n')).toEqual(['{"a":1}']);
  });

  it('多行 data 按规范用 \\n 拼接', () => {
    const p = createSseParser();
    expect(p.push('data: line1\ndata: line2\n\n')).toEqual(['line1\nline2']);
  });

  it('[DONE] 原样透传（由 provider 层解释）', () => {
    const p = createSseParser();
    expect(p.push('data: [DONE]\n\n')).toEqual(['[DONE]']);
  });

  it('忽略 event/id/retry 等字段但不报错', () => {
    const p = createSseParser();
    expect(p.push('event: message\nid: 7\nretry: 1000\ndata: {"a":1}\n\n')).toEqual(['{"a":1}']);
  });

  it('空 data 行产出空负载（由 provider 层跳过）', () => {
    const p = createSseParser();
    expect(p.push('data:\n\n')).toEqual(['']);
  });

  it('flush 吐出末尾未以空行结束的事件（服务端直接断流）', () => {
    const p = createSseParser();
    expect(p.push('data: {"tail":true}')).toEqual([]);
    expect(p.flush()).toEqual(['{"tail":true}']);
  });

  it('flush 后没有残留，重复 flush 不再吐数据', () => {
    const p = createSseParser();
    p.push('data: {"a":1}\n\n');
    expect(p.flush()).toEqual([]);
    expect(p.flush()).toEqual([]);
  });

  it('中文与 Emoji 跨 chunk 不被破坏', () => {
    const p = createSseParser();
    const payload = JSON.stringify({ t: '你好🌏世界' });
    const mid = Math.floor(payload.length / 2);
    expect(p.push(`data: ${payload.slice(0, mid)}`)).toEqual([]);
    expect(p.push(`${payload.slice(mid)}\n\n`)).toEqual([payload]);
  });
});
