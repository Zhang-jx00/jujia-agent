import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetStore } from '../connections-store';
import { generateImageForConnection, IMAGE_GEN_DIR } from './image-gen-service';

/**
 * 媒体生成 · 文生图（M11 剩余 · R51 · S1）· **服务层**的真值。
 *
 * 这一层不打桩连接表、不打桩 fetch：
 * - 连接是**真的**从盘上的 `connections.json` 读出来的（`resolveConnection` 真跑一遍）；
 * - 远端是**真的本地 HTTP 服务**（`node:http`），走完整的请求/响应；
 * - 产物是**真的落盘**，字节**逐字节比对**。
 *
 * 验收面四件事：
 * ① 产物真的落在**数据目录**里，字节逐字节一致；
 * ② 超 5MB 被拒，且**盘上什么都没有**（不许"写了一半"）；
 * ③ **只支持 b64_json**：只回 url 的形态被拒，且**没有第二次出站**（SSRF 面）；
 * ④ 魔数认不出 / 连接不存在 / 端点不存在 ⇒ 各自**如实说**，不静默失败。
 */

/* ------------------------------ 假远端 ------------------------------ */

interface FakeRemote {
  baseUrl: string;
  /** 收到过几次请求（用来证明"没有第二次出站"） */
  hits: { path: string; body: Record<string, unknown> }[];
  close: () => Promise<void>;
}

/** 把请求体解析成对象；解析不了就原样留着（**不留一个用不上的初值**） */
function parseBody(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { __unparsed: raw };
  }
}

async function startRemote(
  handler: (req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>) => void,
): Promise<FakeRemote> {
  const hits: FakeRemote['hits'] = [];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += String(c)));
    req.on('end', () => {
      const body = parseBody(raw);
      hits.push({ path: req.url ?? '', body });
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${String(port)}/v1`,
    hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** 最小合法 PNG（签名 + 一点载荷）—— 魔数只看前 8 字节 */
function pngBytes(fill: number, size = 64): Uint8Array {
  const out = new Uint8Array(size);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  out.fill(fill, 8);
  return out;
}

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

/* ------------------------------ 每例的隔离环境 ------------------------------ */

let dataRoot: string;
let connectionId: string;
const remotes: FakeRemote[] = [];

/** 往盘上写一条**真的**连接记录（JsonStore 的信封格式，与应用自己写出来的一样） */
async function seedConnection(baseUrl: string, apiKey = 'sk-local-only'): Promise<void> {
  connectionId = 'gen-conn-1';
  await writeFile(
    join(dataRoot, 'connections.json'),
    JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      data: {
        connections: [
          {
            id: connectionId,
            name: '本地假远端',
            baseUrl,
            apiFormat: 'openai-compatible',
            model: 'e2e-image-model',
            // `plain` 是真实存在的落盘形态（safeStorage 不可用时应用自己就这么写的）
            secret: { scheme: 'plain', value: apiKey },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      },
    }),
    'utf8',
  );
  __resetStore();
}

beforeEach(async () => {
  // 临时产物只进项目内草稿区（不占 C 盘）
  dataRoot = await mkdtemp(join(process.cwd(), '.tmp', 'jujia-img-gen-'));
  process.env['JUJIA_DATA_BASE_DIR'] = dataRoot;
  __resetStore();
});

afterEach(async () => {
  while (remotes.length) {
    const r = remotes.pop();
    if (r) await r.close();
  }
  delete process.env['JUJIA_DATA_BASE_DIR'];
  __resetStore();
  await rm(dataRoot, { recursive: true, force: true });
});

/* ------------------------------ 用例 ------------------------------ */

describe('文生图 · 产物真的落盘（R51 S1）', () => {
  it('字节逐字节一致地落在数据目录里；回执给出路径 / 大小 / 类型', async () => {
    const payload = pngBytes(0x41);
    const remote = await startRemote((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: b64(payload) }] }));
    });
    remotes.push(remote);
    await seedConnection(remote.baseUrl);

    const r = await generateImageForConnection({ connectionId, prompt: '一只猫' });

    expect(r.ok).toBe(true);
    expect(r.reason).toBeNull();
    expect(r.artifacts).toHaveLength(1);
    const art = r.artifacts[0]!;
    expect(art.mimeType).toBe('image/png');
    expect(art.sizeBytes).toBe(payload.byteLength);
    expect(art.prompt).toBe('一只猫');
    // 落点在本应用数据目录下
    expect(art.path.startsWith(join(dataRoot, IMAGE_GEN_DIR))).toBe(true);

    // **逐字节**一致
    const onDisk = new Uint8Array(await readFile(art.path));
    expect(Array.from(onDisk)).toEqual(Array.from(payload));

    // 目录里**只有**那一个产物（没有 tmp 残留）
    const names = await readdir(join(dataRoot, IMAGE_GEN_DIR));
    expect(names).toHaveLength(1);
    expect(names[0]).not.toContain('.tmp');
  });

  it('提示词 / 张数真的发给了远端（请求体字节）', async () => {
    const remote = await startRemote((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: b64(pngBytes(0x42)) }] }));
    });
    remotes.push(remote);
    await seedConnection(remote.baseUrl);

    await generateImageForConnection({ connectionId, prompt: '窗台上的猫', count: 2 });

    expect(remote.hits).toHaveLength(1);
    expect(remote.hits[0]!.path).toBe('/v1/images/generations');
    expect(remote.hits[0]!.body['prompt']).toBe('窗台上的猫');
    expect(remote.hits[0]!.body['n']).toBe(2);
    expect(remote.hits[0]!.body['model']).toBe('e2e-image-model');
  });
});

describe('文生图 · 三道门（R51 S1）', () => {
  it('超 5MB 被拒，且盘上什么都没有', async () => {
    const tooBig = new Uint8Array(5 * 1024 * 1024 + 1);
    tooBig.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const remote = await startRemote((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: b64(tooBig) }] }));
    });
    remotes.push(remote);
    await seedConnection(remote.baseUrl);

    const r = await generateImageForConnection({ connectionId, prompt: '大图' });

    expect(r.ok).toBe(false);
    expect(r.reason).toBe('too_large');
    expect(r.artifacts).toHaveLength(0);
    // 盘上**不许**留下半个产物
    const dir = join(dataRoot, IMAGE_GEN_DIR);
    const names = await readdir(dir).catch(() => [] as string[]);
    expect(names).toHaveLength(0);
  });

  it('只回 url → 被拒，且**没有第二次出站**（SSRF 面）', async () => {
    const remote = await startRemote((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ url: 'http://127.0.0.1:1/evil.png' }] }));
    });
    remotes.push(remote);
    await seedConnection(remote.baseUrl);

    const r = await generateImageForConnection({ connectionId, prompt: '图' });

    expect(r.ok).toBe(false);
    expect(r.reason).toBe('url_only');
    // 服务端只被问过一次 —— 主进程**没有**去 GET 那个链接
    expect(remote.hits).toHaveLength(1);
    const dir = join(dataRoot, IMAGE_GEN_DIR);
    const names = await readdir(dir).catch(() => [] as string[]);
    expect(names).toHaveLength(0);
  });

  it('魔数认不出是图片 → 被拒（不信扩展名、不信服务商说的）', async () => {
    const notImage = new Uint8Array(Array.from({ length: 32 }, (_x, i) => 0x41 + (i % 26)));
    const remote = await startRemote((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: b64(notImage) }] }));
    });
    remotes.push(remote);
    await seedConnection(remote.baseUrl);

    const r = await generateImageForConnection({ connectionId, prompt: '图' });

    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not_image');
  });

  it('第二张不合格 ⇒ **一张都不落盘**（回执不许说"没有产物"而盘上却有）', async () => {
    const good = pngBytes(0x44);
    const bad = new Uint8Array(5 * 1024 * 1024 + 1);
    bad.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const remote = await startRemote((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: b64(good) }, { b64_json: b64(bad) }] }));
    });
    remotes.push(remote);
    await seedConnection(remote.baseUrl);

    const r = await generateImageForConnection({ connectionId, prompt: '图' });

    expect(r.ok).toBe(false);
    expect(r.reason).toBe('too_large');
    expect(r.artifacts).toHaveLength(0);
    // **第一张也不许留在盘上** —— 校验全过才落盘
    const dir = join(dataRoot, IMAGE_GEN_DIR);
    const names = await readdir(dir).catch(() => [] as string[]);
    expect(names).toHaveLength(0);
  });
});

describe('文生图 · 如实说不支持（R51 S1）', () => {
  it('端点不存在 → unsupported（"这个连接不支持生成"）', async () => {
    const remote = await startRemote((_req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid URL (POST /v1/images/generations)' } }));
    });
    remotes.push(remote);
    await seedConnection(remote.baseUrl);

    const r = await generateImageForConnection({ connectionId, prompt: '图' });

    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unsupported');
    expect(r.error).toContain('这个连接不支持生成');
  });

  it('连接不存在 → no_connection（不静默失败）', async () => {
    const r = await generateImageForConnection({ connectionId: '根本没有这条', prompt: '图' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_connection');
    expect(r.error).not.toBe('');
  });

  it('提示词是空的 → 直接拒（不发出去）', async () => {
    const remote = await startRemote((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: b64(pngBytes(0x43)) }] }));
    });
    remotes.push(remote);
    await seedConnection(remote.baseUrl);

    const r = await generateImageForConnection({ connectionId, prompt: '   ' });

    expect(r.ok).toBe(false);
    expect(remote.hits).toHaveLength(0); // 一个字都没发出去
  });
});

describe('文生图 · 密钥不进回执（R51 S1）', () => {
  it('上游把密钥原样回显（共享剔密表认不出的形态）→ 回执里也没有它', async () => {
    const key = 'sk-local-only-0123456789ABCDEFGHIJKLMNOP';
    const remote = await startRemote((_req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      // 形态刻意刁钻：键名与值之间没有空格 ⇒ 共享那张按形态匹配的表认不出来
      res.end(JSON.stringify({ error: `invalid key:${key}` }));
    });
    remotes.push(remote);
    await seedConnection(remote.baseUrl, key);

    const r = await generateImageForConnection({ connectionId, prompt: '图' });

    expect(r.ok).toBe(false);
    expect(r.error).not.toContain(key);
  });
});
