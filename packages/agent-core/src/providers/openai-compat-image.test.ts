import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { generateImage, resolveEndpoint } from './openai-compat';

/**
 * 文生图（M11 剩余 · R51 · S1）· **provider 层**的真值。
 *
 * 单独成文件的原因：这个 provider 的测试文件本来就贴着 800 行的上限（仓里的硬规矩），
 * 再往里塞一组新用例就会顶破 —— 拆出来比"塞进去再说"诚实。
 *
 * 验收面三件事：
 * ① **请求体字节**：提示词 / 张数 / 模型真的发出去了（不是只在本地拼了个对象）；
 * ② **只支持 b64_json**：只从 data[] 取 b64_json；只回 url 时**没有第二次出站**（SSRF 面）；
 * ③ **形状不对要如实报错**：不能"假装成功"返回空数组。
 */

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
    baseUrl: `http://127.0.0.1:${String(port)}/v1`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const servers: MockServer[] = [];

afterEach(async () => {
  while (servers.length) {
    const s = servers.pop();
    if (s) await s.close();
  }
});

/** 把请求体解析成对象；解析不了就原样留着（**不留一个用不上的初值**） */
function parseBody(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { __unparsed: raw };
  }
}

describe('resolveEndpoint · images/generations', () => {
  it.each([
    ['https://api.openai.com', 'https://api.openai.com/v1/images/generations'],
    ['https://api.openai.com/', 'https://api.openai.com/v1/images/generations'],
    ['https://api.openai.com/v1', 'https://api.openai.com/v1/images/generations'],
    // 用户把完整端点填进 baseUrl ⇒ 原样用，不许再拼一层
    ['https://x.com/v1/images/generations', 'https://x.com/v1/images/generations'],
    // 填的是别的端点 ⇒ 换段
    ['https://x.com/v1/chat/completions', 'https://x.com/v1/images/generations'],
  ])('%s → %s', (input, expected) => {
    expect(resolveEndpoint(input, 'images/generations')).toBe(expected);
  });
});

describe('generateImage（文生图）', () => {
  /** 一台会记账的假远端：记下收到的路径、请求体与次数 */
  interface Recorder {
    baseUrl: string;
    hits: { path: string; auth: string | undefined; body: Record<string, unknown> }[];
  }

  async function startImageServer(
    handler: (body: Record<string, unknown>, res: ServerResponse) => void,
  ): Promise<Recorder> {
    const rec: Recorder = { baseUrl: '', hits: [] };
    const mock = await startServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += String(c)));
      req.on('end', () => {
        const body = parseBody(raw);
        rec.hits.push({ path: req.url ?? '', auth: req.headers['authorization'], body });
        handler(body, res);
      });
    });
    servers.push(mock);
    rec.baseUrl = mock.baseUrl;
    return rec;
  }

  it('请求体真的带上提示词 / 张数 / 模型，且打到 /v1/images/generations', async () => {
    const rec = await startImageServer((_body, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: 'AAAA' }] }));
    });

    await generateImage({
      baseUrl: rec.baseUrl,
      apiKey: 'sk-test',
      model: 'e2e-image-model',
      prompt: '一只坐在窗台上的猫',
      count: 2,
    });

    expect(rec.hits).toHaveLength(1);
    const hit = rec.hits[0]!;
    expect(hit.path).toBe('/v1/images/generations');
    expect(hit.auth).toBe('Bearer sk-test');
    expect(hit.body['prompt']).toBe('一只坐在窗台上的猫');
    expect(hit.body['n']).toBe(2);
    expect(hit.body['model']).toBe('e2e-image-model');
  });

  it('响应里的 b64_json 被取出来（多张按顺序）', async () => {
    const rec = await startImageServer((_body, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: 'AAA' }, { b64_json: 'BBB' }] }));
    });

    await expect(
      generateImage({ baseUrl: rec.baseUrl, apiKey: 'k', model: 'm', prompt: 'p' }),
    ).resolves.toEqual(['AAA', 'BBB']);
  });

  it('只回 url → 如实报错（url_only），而且**没有第二次出站**', async () => {
    const rec = await startImageServer((_body, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ url: 'http://127.0.0.1:1/evil.png' }] }));
    });

    await expect(
      generateImage({ baseUrl: rec.baseUrl, apiKey: 'k', model: 'm', prompt: 'p' }),
    ).rejects.toMatchObject({ code: 'url_only' });
    // 只回过一次 —— 服务端给了链接就**不许**主进程再去 GET 那个链接（SSRF 面）
    expect(rec.hits).toHaveLength(1);
  });

  it('data 为空 → bad_response（不许假装成功返回空数组）', async () => {
    const rec = await startImageServer((_body, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [] }));
    });

    await expect(
      generateImage({ baseUrl: rec.baseUrl, apiKey: 'k', model: 'm', prompt: 'p' }),
    ).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('没有 data 字段 → bad_response', async () => {
    const rec = await startImageServer((_body, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ nope: true }));
    });

    await expect(
      generateImage({ baseUrl: rec.baseUrl, apiKey: 'k', model: 'm', prompt: 'p' }),
    ).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('返回的不是 JSON → bad_response', async () => {
    const rec = await startImageServer((_body, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('not json at all');
    });

    await expect(
      generateImage({ baseUrl: rec.baseUrl, apiKey: 'k', model: 'm', prompt: 'p' }),
    ).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('404 → unsupported（"这个连接不支持生成"，不是"生成失败"）', async () => {
    const rec = await startImageServer((_body, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid URL (POST /v1/images/generations)' } }));
    });

    await expect(
      generateImage({ baseUrl: rec.baseUrl, apiKey: 'k', model: 'm', prompt: 'p' }),
    ).rejects.toMatchObject({ code: 'unsupported', status: 404 });
  });

  it('400 → http_error（上游的话照原样带出来）', async () => {
    const rec = await startImageServer((_body, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: '参数不被支持' } }));
    });

    await expect(
      generateImage({ baseUrl: rec.baseUrl, apiKey: 'k', model: 'm', prompt: 'p' }),
    ).rejects.toMatchObject({ code: 'http_error', status: 400 });
  });

  it('上游挂住不回 → 超时被识别为 timeout（不是 network_error，也不是无限等）', async () => {
    const mock = await startServer(() => {
      /* 什么都不回 —— 模拟上游挂住 */
    });
    servers.push(mock);

    await expect(
      generateImage(
        { baseUrl: mock.baseUrl, apiKey: 'k', model: 'm', prompt: 'p' },
        { totalTimeoutMs: 150 },
      ),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('上游把认证头回显在正文里 → 剔密后才进错误消息（密钥不进渲染层）', async () => {
    // 网关回显 Authorization 是最常见的形态 ⇒ 命中共享剔密表的 `Bearer` 那条
    const echoed = 'sk-live-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const rec = await startImageServer((_body, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Authorization: Bearer ${echoed}` }));
    });

    const err = await generateImage({ baseUrl: rec.baseUrl, apiKey: 'k', model: 'm', prompt: 'p' }).catch(
      (e: unknown) => e,
    );
    const message = err instanceof Error ? err.message : String(err);
    expect(message).not.toContain(echoed);
  });

  it('上游把密钥藏在 JSON 字段里回显 → 剔密后才进错误消息', async () => {
    const echoed = 'sk-live-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const rec = await startImageServer((_body, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ api_key: echoed }));
    });

    const err = await generateImage({ baseUrl: rec.baseUrl, apiKey: 'k', model: 'm', prompt: 'p' }).catch(
      (e: unknown) => e,
    );
    const message = err instanceof Error ? err.message : String(err);
    expect(message).not.toContain(echoed);
  });
});
