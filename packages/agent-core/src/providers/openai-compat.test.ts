import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createStreamTimeout, listModels, resolveEndpoint, streamChat } from './openai-compat';
import type { ProviderEvent } from './types';

/** 起一个真实的本地 SSE 服务，验证「真·流式」而不是打桩返回值 */
interface MockServer {
  baseUrl: string;
  close: () => Promise<void>;
}

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

async function startServer(handler: RequestHandler): Promise<MockServer> {
  const server: Server = createServer(handler as Parameters<typeof createServer>[0]);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function startServerFromAsync(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
): Promise<MockServer> {
  return startServer((req, res) => {
    void handler(req, res);
  });
}

function sseChunk(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
}

const servers: MockServer[] = [];

afterEach(async () => {
  while (servers.length) {
    const s = servers.pop();
    if (s) await s.close();
  }
});

async function collect(gen: AsyncGenerator<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

describe('resolveEndpoint', () => {
  it.each([
    ['https://api.deepseek.com', 'https://api.deepseek.com/v1/chat/completions'],
    ['https://api.deepseek.com/', 'https://api.deepseek.com/v1/chat/completions'],
    ['https://api.deepseek.com/v1', 'https://api.deepseek.com/v1/chat/completions'],
    ['https://open.bigmodel.cn/api/paas/v4', 'https://open.bigmodel.cn/api/paas/v4/chat/completions'],
    [
      'https://x.com/v1/chat/completions',
      'https://x.com/v1/chat/completions',
    ],
  ])('%s → %s', (input, expected) => {
    expect(resolveEndpoint(input, 'chat/completions')).toBe(expected);
  });

  it('models 端点同样归一化', () => {
    expect(resolveEndpoint('https://api.deepseek.com/', 'models')).toBe(
      'https://api.deepseek.com/v1/models',
    );
  });
});

describe('streamChat：真实 SSE 端到端', () => {
  it('多段增量按顺序产出，并以 done(stop) 收尾', async () => {
    const mock = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sseChunk('你'));
      res.write(sseChunk('好'));
      res.write(sseChunk('，俱佳'));
      res.write('data: [DONE]\n\n');
      res.end();
    });
    servers.push(mock);

    const events = await collect(
      streamChat({ baseUrl: mock.baseUrl, apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    );

    const text = events.filter((e) => e.type === 'text_delta').map((e) => (e as { delta: string }).delta).join('');
    expect(text).toBe('你好，俱佳');
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'stop' });
  });

  it('服务端按极小分片慢写（模拟网络逐块到达）仍能正确拼装', async () => {
    const mock = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const whole = sseChunk('分片测试') + 'data: [DONE]\n\n';
      for (const ch of whole) res.write(ch); // 每次只写一个字符
      res.end();
    });
    servers.push(mock);

    const events = await collect(
      streamChat({ baseUrl: mock.baseUrl, apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    );
    const text = events.filter((e) => e.type === 'text_delta').map((e) => (e as { delta: string }).delta).join('');
    expect(text).toBe('分片测试');
    expect(events.at(-1)).toMatchObject({ type: 'done' });
  });

  it('usage 负载被识别（prompt_tokens / completion_tokens）', async () => {
    const mock = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sseChunk('ok'));
      res.write(`data: ${JSON.stringify({ usage: { prompt_tokens: 12, completion_tokens: 3 } })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });
    servers.push(mock);

    const events = await collect(
      streamChat({ baseUrl: mock.baseUrl, apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    );
    expect(events).toContainEqual({ type: 'usage', inputTokens: 12, outputTokens: 3 });
  });

  it('finish_reason=length → done(length)', async () => {
    const mock = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sseChunk('被截断'));
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }] })}\n\n`);
      res.end();
    });
    servers.push(mock);

    const events = await collect(
      streamChat({ baseUrl: mock.baseUrl, apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    );
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'length' });
  });

  it('无 [DONE] 直接断流：flush 吐尾包后仍给 done', async () => {
    const mock = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      // 注意：不写结尾空行，模拟服务端硬断
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '尾包' } }] })}`);
      res.end();
    });
    servers.push(mock);

    const events = await collect(
      streamChat({ baseUrl: mock.baseUrl, apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    );
    const text = events.filter((e) => e.type === 'text_delta').map((e) => (e as { delta: string }).delta).join('');
    expect(text).toBe('尾包');
    expect(events.at(-1)).toMatchObject({ type: 'done' });
  });

  it('HTTP 401 抛 http_error 并带上状态码与响应摘要', async () => {
    const mock = await startServer((_req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
    });
    servers.push(mock);

    await expect(
      collect(streamChat({ baseUrl: mock.baseUrl, apiKey: 'bad', model: 'm', messages: [] })),
    ).rejects.toMatchObject({ code: 'http_error', status: 401 });
  });

  it('data 里带 error 字段 → bad_response（部分厂商这样报错）', async () => {
    const mock = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ error: { message: 'quota exceeded' } })}\n\n`);
      res.end();
    });
    servers.push(mock);

    await expect(
      collect(streamChat({ baseUrl: mock.baseUrl, apiKey: 'k', model: 'm', messages: [] })),
    ).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('全是无法解析的负载 → bad_response（而不是静默成功）', async () => {
    const mock = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: not-json-1\n\n');
      res.write('data: not-json-2\n\n');
      res.end();
    });
    servers.push(mock);

    await expect(
      collect(streamChat({ baseUrl: mock.baseUrl, apiKey: 'k', model: 'm', messages: [] })),
    ).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('用户中止 → done(aborted) 而非抛错（中止是正常路径）', async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const mock = await startServerFromAsync(async (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sseChunk('第一段'));
      await gate; // 卡住不结束，等客户端中止
      res.end();
    });
    servers.push(mock);

    const ac = new AbortController();
    const events: ProviderEvent[] = [];
    const gen = streamChat({
      baseUrl: mock.baseUrl,
      apiKey: 'k',
      model: 'm',
      messages: [],
      signal: ac.signal,
    });

    const task = (async () => {
      for await (const ev of gen) {
        events.push(ev);
        if (ev.type === 'text_delta') ac.abort();
      }
    })();

    await task;
    release();
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'aborted' });
  });

  it('连不上（端口无人监听）→ network_error', async () => {
    await expect(
      collect(
        streamChat({ baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'k', model: 'm', messages: [] }),
      ),
    ).rejects.toMatchObject({ code: 'network_error' });
  });

  // 异常路径实验（复核 002 第二遍）：真实网络故障下的行为，必须有确定结局
  it('服务端发送途中强制断开连接 → 已收到的增量保留，并以 network_error 收尾（不挂起、不崩溃）', async () => {
    const mock = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sseChunk('前半段'));
      // 模拟网络中断：直接销毁 socket，既没有 [DONE] 也没有正常结束
      setTimeout(() => res.socket?.destroy(), 30);
    });
    servers.push(mock);

    const received: string[] = [];
    let failure: unknown;
    try {
      for await (const ev of streamChat({
        baseUrl: mock.baseUrl,
        apiKey: 'k',
        model: 'm',
        messages: [],
      })) {
        if (ev.type === 'text_delta') received.push(ev.delta);
      }
    } catch (err) {
      failure = err;
    }

    // 契约：中断属于网络错误（抛错），但**已经产出的增量不得丢失**——调用方据此保住半截回答
    expect(received.join('')).toContain('前半段');
    expect(failure).toMatchObject({ code: 'network_error' });
  });

  it('上游一直不响应 → 超时被识别为 timeout（不是 network_error，也不是静默 aborted）', async () => {
    const mock = await startServer(() => {
      // 刻意什么都不写、不结束：模拟上游卡死
    });
    servers.push(mock);

    const started = Date.now();
    let failure: unknown;
    try {
      for await (const _ev of streamChat({
        baseUrl: mock.baseUrl,
        apiKey: 'k',
        model: 'm',
        messages: [],
        signal: AbortSignal.timeout(300),
      })) {
        // 不应产出任何事件
      }
    } catch (err) {
      failure = err;
    }
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(5_000); // 必须有界，不能一直等
    // 复核 002 实测：Node 的 AbortSignal.timeout() 抛 TimeoutError，曾被误判为 network_error
    expect(failure).toMatchObject({ code: 'timeout' });
  });

  it('用户在「等待响应头」阶段主动取消 → done(aborted)（取消是正常路径）', async () => {
    const mock = await startServer(() => {
      // 不响应，等用户取消
    });
    servers.push(mock);

    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);

    const events = await collect(
      streamChat({ baseUrl: mock.baseUrl, apiKey: 'k', model: 'm', messages: [], signal: ac.signal }),
    );
    expect(events).toEqual([{ type: 'done', reason: 'aborted' }]);
  });

  it('请求体包含必要字段且 stream=true', async () => {
    let seenBody = '';
    let seenAuth = '';
    const mock = await startServer((req, res) => {
      seenAuth = req.headers['authorization'] ?? '';
      req.on('data', (c) => (seenBody += c));
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    servers.push(mock);

    await collect(
      streamChat({
        baseUrl: mock.baseUrl,
        apiKey: 'secret-key',
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: '你好' }],
        temperature: 0.3,
        maxTokens: 64,
      }),
    );

    const parsed = JSON.parse(seenBody) as Record<string, unknown>;
    expect(parsed['stream']).toBe(true);
    expect(parsed['model']).toBe('deepseek-chat');
    expect(parsed['temperature']).toBe(0.3);
    expect(parsed['max_tokens']).toBe(64);
    expect(seenAuth).toBe('Bearer secret-key');
  });
});

/**
 * 两条时间界限（2026-09-27 外部审查 T7）。
 *
 * 修之前的形状：`chat-service` 给整轮挂一个 5 分钟总超时，provider 自己不看时间 ——
 * 于是"上游 200 之后不再吐字"要等满 5 分钟才断开，而且断开时抛的是普通 AbortError，
 * 被下面的 `isAbort` 分支当成"用户点了停止"→ **界面把卡死显示成已停止**（静默失败）。
 * 现在：空闲超时归 provider（看得见数据在不在流），总时长也改成**按单次调用**算。
 */
describe('流式的空闲超时与单次调用上限', () => {
  const stalled = async (): Promise<MockServer> => {
    const mock = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sseChunk('前半段'));
      // 之后什么都不做：连接活着、但不再有数据 —— 这就是"上游卡住"的真实形状
    });
    servers.push(mock);
    return mock;
  };

  it('先吐了一段就不再吐 → timeout 且理由写明"没有再吐字"（不是 aborted）', async () => {
    const mock = await stalled();
    const received: string[] = [];
    let failure: unknown;
    const started = Date.now();
    try {
      for await (const ev of streamChat(
        { baseUrl: mock.baseUrl, apiKey: 'k', model: 'm', messages: [] },
        { idleTimeoutMs: 150, totalTimeoutMs: 30_000 },
      )) {
        if (ev.type === 'text_delta') received.push(ev.delta);
      }
    } catch (err) {
      failure = err;
    }
    // 之前那段确实收到了：证明这条用例测的是"读到一半卡住"，不是"根本没连上"
    expect(received.join('')).toContain('前半段');
    expect(failure).toMatchObject({ code: 'timeout' });
    expect(failure instanceof Error ? failure.message : '').toContain('没有再吐字');
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('反向：数据持续到达时长流**不被空闲超时误杀**（变异 M33 摘掉 beat 就红在这里）', async () => {
    const mock = await startServer(async (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (let i = 0; i < 20; i += 1) {
        res.write(sseChunk(`第${String(i)}段`));
        await new Promise<void>((r) => setTimeout(r, 15));
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
    servers.push(mock);
    // 整串流约 300ms，而空闲上限只有 80ms：不续命就一定被掐
    const events = await collect(
      streamChat(
        { baseUrl: mock.baseUrl, apiKey: 'k', model: 'm', messages: [] },
        { idleTimeoutMs: 80, totalTimeoutMs: 30_000 },
      ),
    );
    const text = events
      .filter((e) => e.type === 'text_delta')
      .map((e) => (e.type === 'text_delta' ? e.delta : ''))
      .join('');
    expect(text).toContain('第19段');
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'stop' });
  });

  it('每 30ms 一直吐但永不结束 → 由**单次调用总上限**掐断，理由与空闲不同', async () => {
    const mock = await startServer(async (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      let alive = true;
      req.on('close', () => {
        alive = false;
      });
      while (alive) {
        res.write(sseChunk('滴'));
        await new Promise<void>((r) => setTimeout(r, 30));
      }
    });
    servers.push(mock);
    let failure: unknown;
    try {
      for await (const _ev of streamChat(
        { baseUrl: mock.baseUrl, apiKey: 'k', model: 'm', messages: [] },
        { idleTimeoutMs: 5_000, totalTimeoutMs: 200 },
      )) {
        // 一直产出，直到总上限掐断
      }
    } catch (err) {
      failure = err;
    }
    expect(failure).toMatchObject({ code: 'timeout' });
    expect(failure instanceof Error ? failure.message : '').toContain('单次模型调用超过');
  });

  it('用户在等待响应头阶段取消 → 仍是 done(aborted)，不会被新分支误报成超时（变异 M34 的靶子）', async () => {
    const mock = await startServer(() => {
      // 不响应
    });
    servers.push(mock);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 80);
    const events = await collect(
      streamChat(
        { baseUrl: mock.baseUrl, apiKey: 'k', model: 'm', messages: [], signal: ac.signal },
        { idleTimeoutMs: 10_000, totalTimeoutMs: 30_000 },
      ),
    );
    expect(events).toEqual([{ type: 'done', reason: 'aborted' }]);
  });
});

describe('createStreamTimeout', () => {
  it('不 beat 就到期：idleExceeded 变真且信号被触发', async () => {
    const clock = createStreamTimeout({ idleMs: 40, totalMs: 10_000 });
    expect(clock.idleExceeded()).toBe(false);
    await new Promise<void>((r) => setTimeout(r, 120));
    expect(clock.idleExceeded()).toBe(true);
    expect(clock.signal.aborted).toBe(true);
    expect(clock.totalExceeded()).toBe(false);
    clock.dispose();
  });

  it('beat 续命：单段间隔都小于空闲上限时，累计多久都不 idle', async () => {
    const clock = createStreamTimeout({ idleMs: 60, totalMs: 30_000 });
    for (let i = 0; i < 8; i += 1) {
      await new Promise<void>((r) => setTimeout(r, 30));
      clock.beat();
    }
    expect(clock.idleExceeded()).toBe(false);
    expect(clock.signal.aborted).toBe(false);
    clock.dispose();
  });

  it('dispose 之后定时器全部撤掉（不留下会把进程拖住的句柄）', async () => {
    const clock = createStreamTimeout({ idleMs: 40, totalMs: 60 });
    clock.dispose();
    await new Promise<void>((r) => setTimeout(r, 150));
    expect(clock.idleExceeded()).toBe(false);
    expect(clock.totalExceeded()).toBe(false);
    expect(clock.signal.aborted).toBe(false);
  });
});

describe('listModels', () => {
  it('成功返回排序后的 id 列表', async () => {
    const mock = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'b-model' }, { id: 'a-model' }] }));
    });
    servers.push(mock);

    await expect(listModels({ baseUrl: mock.baseUrl, apiKey: 'k' })).resolves.toEqual([
      'a-model',
      'b-model',
    ]);
  });

  it('结构不对 → bad_response', async () => {
    const mock = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ nope: true }));
    });
    servers.push(mock);

    await expect(listModels({ baseUrl: mock.baseUrl, apiKey: 'k' })).rejects.toMatchObject({
      code: 'bad_response',
    });
  });

  it('403 → http_error 带状态码', async () => {
    const mock = await startServer((_req, res) => {
      res.writeHead(403);
      res.end('forbidden');
    });
    servers.push(mock);

    await expect(listModels({ baseUrl: mock.baseUrl, apiKey: 'k' })).rejects.toMatchObject({
      code: 'http_error',
      status: 403,
    });
  });
});
