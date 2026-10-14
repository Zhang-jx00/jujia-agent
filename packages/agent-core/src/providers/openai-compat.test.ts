import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
        // 这一条测的是**请求体**，回包只是把它糊过去 —— 但 T25 之后"只给 [DONE]"会被判成
        // 异常（那正是本轮要修的静默成功），所以这里必须给一段真内容。
        // 记在这儿的理由：改之前这个夹具**正依赖着那个缺陷**才能跑绿。
        res.write(sseChunk('ok'));
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
    /**
     * **这一版必须用假时钟 + 手工喂流**（CI 第三红抓到的真形态，2026-10-14 夜；它是
     * "断言依赖真实时钟"那一族 —— 与 createStreamTimeout 组同一课）。病史如实：
     * 参数从 80ms/15ms 放到 200ms/30ms 之后，超载 runner 上**又一次**被单块调度拖炸
     * （同轮 git 组跑了 80 秒），报的还是"上游 …秒没有再吐字"——**诚实地**误杀。
     * 要验的是"每块数据到达都续命"这条**接线**，不是"CI 的调度有多准"：
     * 手工流 + 假时钟后逐毫秒可控、零真实等待。
     *
     * 判据两头都留（换靶不放宽）：每块间隔 150ms（虚拟）< 空闲上限 600ms，累计 20 块
     * 3000ms 不许被掐；而摘掉 `beat()`（M33）后上限不会续命，600ms 头上必被掐 ——
     * "上限小于整串时长"这条不变。
     */
    vi.useFakeTimers();
    try {
      const encoder = new TextEncoder();
      let push: (s: string) => void = () => undefined;
      let finish: () => void = () => undefined;
      let kill: (e: Error) => void = () => undefined;
      let aborted = false;
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          push = (s) => c.enqueue(encoder.encode(s));
          finish = () => c.close();
          kill = (e) => c.error(e);
        },
      });
      // 手工流当"网络"：fetch 直接把这块流当响应体；信号断了就如实传导（真实网络里就是断读侧）
      const fetcher = (async (_url: unknown, init?: RequestInit) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          kill(new Error('被信号掐断 —— 这是真实网络里 AbortSignal 的传导形状'));
        });
        return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }) as unknown as typeof fetch;

      const pump = collect(
        streamChat(
          { baseUrl: 'http://example.invalid/v1', apiKey: 'k', model: 'm', messages: [] },
          { fetcher, idleTimeoutMs: 600, totalTimeoutMs: 30_000 },
        ),
      ).then(
        (events) => ({ events, failure: null as unknown }),
        (failure: unknown) => ({ events: [] as ProviderEvent[], failure }),
      );

      for (let i = 0; i < 20 && !aborted; i += 1) {
        push(sseChunk(`第${String(i)}段`));
        // 虚拟时间走 150ms（< 空闲上限 600）：每块都续命的话，累计多久都不该被掐
        await vi.advanceTimersByTimeAsync(150);
      }
      if (!aborted) {
        push('data: [DONE]\n\n');
        finish();
      }
      const r = await pump;
      if (r.failure !== null) throw r.failure;
      const text = r.events
        .filter((e) => e.type === 'text_delta')
        .map((e) => (e.type === 'text_delta' ? e.delta : ''))
        .join('');
      expect(text).toContain('第19段');
      expect(r.events.at(-1)).toEqual({ type: 'done', reason: 'stop' });
    } finally {
      vi.useRealTimers();
    }
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
  /**
   * **这一组必须用假时钟**（CI 首跑回填抓到的真形态，2026-10-14）：原来用真实 `sleep(30)` 打拍子，
   * 而 CI 的负载会让一次 30ms 睡变成 80ms+ —— 60ms 的 idle 定时器**诚实地**触发了，
   * "beat 续命"于是间歇性红（本地窄缝永远复现不了）。这是"断言依赖真实时钟"那一族：
   * 要验证的是**逻辑**（beat 会重新计满 idle），不是"CI 的调度有多准"。换成假时钟后逐毫秒可控。
   */
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('不 beat 就到期：idleExceeded 变真且信号被触发', () => {
    const clock = createStreamTimeout({ idleMs: 40, totalMs: 10_000 });
    expect(clock.idleExceeded()).toBe(false);
    vi.advanceTimersByTime(120);
    expect(clock.idleExceeded()).toBe(true);
    expect(clock.signal.aborted).toBe(true);
    expect(clock.totalExceeded()).toBe(false);
    clock.dispose();
  });

  it('beat 续命：单段间隔都小于空闲上限时，累计多久都不 idle', () => {
    const clock = createStreamTimeout({ idleMs: 60, totalMs: 30_000 });
    for (let i = 0; i < 8; i += 1) {
      vi.advanceTimersByTime(30);
      clock.beat();
    }
    // 8 段 × 30ms = 240ms 累计，远超 idleMs；但**每一段都没到 60ms** —— 一次都不许触发
    expect(clock.idleExceeded()).toBe(false);
    expect(clock.signal.aborted).toBe(false);
    clock.dispose();
  });

  it('dispose 之后定时器全部撤掉（不留下会把进程拖住的句柄）', () => {
    const clock = createStreamTimeout({ idleMs: 40, totalMs: 60 });
    clock.dispose();
    vi.advanceTimersByTime(150);
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

/* ------------------------------------------------------------------ *
 * R7 · provider 批（外部审查 T25 / T26 / T27 + 附带一条）
 *
 * 四条都是**静默**类：不报错、不崩，只是把"没拿到东西"说成"拿到了"。
 * 每条都对着本地真 SSE 服务跑，不打桩返回值 —— 打桩会把"帧怎么切"这件事测没了。
 * ------------------------------------------------------------------ */

describe('T25：拿到 [DONE] 不等于拿到回答', () => {
  it('全是无法解析的负载 + [DONE] → bad_response，不许记成"一条空回答但成功"', async () => {
    const mock = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: not-json-1\n\n');
      res.write('data: not-json-2\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });
    servers.push(mock);

    await expect(
      collect(streamChat({ baseUrl: mock.baseUrl, apiKey: 'k', model: 'm', messages: [] })),
    ).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('一个数据负载都没有、只给了 [DONE] → 也是异常，而且说法与"垃圾负载"不同', async () => {
    const mock = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: [DONE]\n\n');
      res.end();
    });
    servers.push(mock);

    await expect(
      collect(streamChat({ baseUrl: mock.baseUrl, apiKey: 'k', model: 'm', messages: [] })),
    ).rejects.toThrow(/没有给出任何内容/);
  });

  it('只有 usage、没有正文 + [DONE] → 放行（上游确实答过，不许误判成空流）', async () => {
    const mock = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ usage: { prompt_tokens: 5, completion_tokens: 2 } })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });
    servers.push(mock);

    const events = await collect(streamChat({ baseUrl: mock.baseUrl, apiKey: 'k', model: 'm', messages: [] }));
    expect(events).toContainEqual({ type: 'usage', inputTokens: 5, outputTokens: 2 });
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'stop' });
  });

  it('只有工具调用、没有正文，收尾 [DONE] → done(tool_calls)，兜底不许误伤工具轮', async () => {
    const mock = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(
        `data: ${JSON.stringify({
          choices: [{ delta: { tool_calls: [{ index: 0, id: 'c0', function: { name: 'list_dir', arguments: '{}' } }] } }],
        })}\n\n`,
      );
      res.write('data: [DONE]\n\n');
      res.end();
    });
    servers.push(mock);

    const events = await collect(streamChat({ baseUrl: mock.baseUrl, apiKey: 'k', model: 'm', messages: [] }));
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'tool_calls' });
  });
});

describe('T26：finish_reason 不许被归并成 stop', () => {
  async function finishOf(reason: string): Promise<ProviderEvent | undefined> {
    const mock = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sseChunk('写到一半'));
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: reason }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });
    servers.push(mock);
    const events = await collect(streamChat({ baseUrl: mock.baseUrl, apiKey: 'k', model: 'm', messages: [] }));
    return events.at(-1);
  }

  it('length 原样传出（截断要看得见）', async () => {
    expect(await finishOf('length')).toEqual({ type: 'done', reason: 'length' });
  });

  it('content_filter 原样传出 —— 它和"正常写完"绝不是一回事', async () => {
    expect(await finishOf('content_filter')).toEqual({ type: 'done', reason: 'content_filter' });
  });

  it('厂商自造的未知原因不猜：按 stop 收尾，也不报错（宁可少说一句，不要编一句）', async () => {
    expect(await finishOf('stop')).toEqual({ type: 'done', reason: 'stop' });
    expect(await finishOf('some_vendor_specific')).toEqual({ type: 'done', reason: 'stop' });
  });
});

describe('T27：同一帧里的 usage 不许被吞', () => {
  it('正文 + usage 在同一帧 → 两个事件都产出', async () => {
    const mock = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(
        `data: ${JSON.stringify({
          choices: [{ delta: { content: '你好' } }],
          usage: { prompt_tokens: 11, completion_tokens: 7 },
        })}\n\n`,
      );
      res.write('data: [DONE]\n\n');
      res.end();
    });
    servers.push(mock);

    const events = await collect(streamChat({ baseUrl: mock.baseUrl, apiKey: 'k', model: 'm', messages: [] }));
    expect(events).toContainEqual({ type: 'text_delta', delta: '你好' });
    expect(events).toContainEqual({ type: 'usage', inputTokens: 11, outputTokens: 7 });
  });

  it('分两帧给（正文帧 / usage 帧）→ 同样两个都有（对照：别把一种写法修坏成另一种）', async () => {
    const mock = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sseChunk('你好'));
      res.write(`data: ${JSON.stringify({ usage: { prompt_tokens: 3, completion_tokens: 4 } })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });
    servers.push(mock);

    const events = await collect(streamChat({ baseUrl: mock.baseUrl, apiKey: 'k', model: 'm', messages: [] }));
    expect(events).toContainEqual({ type: 'text_delta', delta: '你好' });
    expect(events).toContainEqual({ type: 'usage', inputTokens: 3, outputTokens: 4 });
  });
});

describe('附带一条的实测口径：断流尾部的残缺多字节', () => {
  it('最后一个 chunk 止于半个汉字 → 不许把替换字符当正文吐出来', async () => {
    const mock = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sseChunk('正常内容'));
      // '好' 的 UTF-8 是 3 字节：这里只给第 1 个字节就断流
      res.write(Buffer.from('好', 'utf8').subarray(0, 1));
      res.end();
    });
    servers.push(mock);

    const events = await collect(streamChat({ baseUrl: mock.baseUrl, apiKey: 'k', model: 'm', messages: [] }));
    const text = events
      .filter((e) => e.type === 'text_delta')
      .map((e) => (e as { delta: string }).delta)
      .join('');
    expect(text).toBe('正常内容');
    expect(text).not.toContain('\ufffd');
  });
});
