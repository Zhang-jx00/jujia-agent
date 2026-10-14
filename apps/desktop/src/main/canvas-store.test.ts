import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CANVAS_GRAPH_VERSION, CANVAS_MAX_FILE_BYTES, type CanvasGraph } from '@jujia/shared-ipc';
import { canvasFile, createCanvasStore } from './canvas-store';

/**
 * 画布图的持久化（M9a，报备 §三）。
 *
 * 四条底线，每条都对应一次真实教训的形状：
 * ① **id 只能经白名单变成路径**（`../escape` 不许变成任意路径读写）—— 与 `session-store` 同一条纪律；
 * ② **图不合法不许落盘**（带 apiKey 的图必须被拒，密钥不进可分享文件）；
 * ③ 坏文件不进列表，但**也不删**（用户的图，出了问题要能自己去看）；
 * ④ 迁移骨架真的会跑（v0 的文件读得回来）。
 */

let root = '';
const ID = 'graph-0000-1111-2222';

const graph = (over: Partial<CanvasGraph> = {}): CanvasGraph => ({
  version: CANVAS_GRAPH_VERSION,
  connectionId: 'conn-1',
  nodes: [{ id: 'a', kind: 'prompt', x: 0, y: 0, config: { prompt: '把要点写成三条' } }],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  ...over,
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'jujia-canvas-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('存取往返', () => {
  it('存了能读回来（重启后仍在磁盘上）', async () => {
    const store = createCanvasStore(root);
    expect(await store.save(ID, graph())).toEqual({ ok: true });
    const reopened = createCanvasStore(root);
    const loaded = await reopened.load(ID);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.graph.nodes[0]?.config['prompt']).toBe('把要点写成三条');
  });

  it('列表给出名字、节点数与改动时间（按时间倒序）', async () => {
    const store = createCanvasStore(root);
    await store.save(ID, graph());
    await store.save('graph-3333-4444-5555', graph({ nodes: [] }));
    const items = await store.list();
    expect(items).toHaveLength(2);
    expect((items[0]?.updatedAt ?? '') >= (items[1]?.updatedAt ?? '')).toBe(true);
    expect(items.map((i) => i.name)).toContain('把要点写成三条');
  });
});

describe('id 白名单：非法 id 不许变成路径', () => {
  it('save / load 都拒绝越界 id', async () => {
    const store = createCanvasStore(root);
    const saved = await store.save('../escape', graph());
    expect(saved.ok).toBe(false);
    const loaded = await store.load('../escape');
    expect(loaded.ok).toBe(false);
  });

  it('canvasFile 是唯一的路径出口（非法 id 在这里抛）', () => {
    expect(() => canvasFile(root, '../../etc/passwd')).toThrow();
    expect(canvasFile(root, ID)).toContain(ID);
  });
});

describe('落盘前的把关', () => {
  it('带 apiKey 的图存不进去（密钥不进可分享文件）', async () => {
    const store = createCanvasStore(root);
    const withKey = { ...graph(), apiKey: 'sk-nope' };
    const r = await store.save(ID, withKey);
    expect(r.ok).toBe(false);
  });

  /**
   * 文件大小上限是**最后一道**（schema 不管单个 config 多大，那是 validateGraph 的事；
   * 而"存"这一步只过 schema）——所以这里用超大 config 造出真正超 2MB 的图。
   * 顺带说明为什么上限是"兜底"而不是"主闸"：正常路径上单节点 8KB × 节点数 200 ≈ 1.6MB，
   * 本来就越不过 2MB；它拦的是**绕过校验直接调用**的那种输入。
   */
  it('超过大小上限的图被拒，且说得出多大', async () => {
    const store = createCanvasStore(root);
    const many = {
      ...graph(),
      nodes: Array.from({ length: 200 }, (_, i) => ({
        id: `n${String(i)}`,
        kind: 'prompt' as const,
        x: 0,
        y: 0,
        config: { prompt: 'x'.repeat(20_000) },
      })),
    };
    const r = await store.save(ID, many);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('KB');
    expect(CANVAS_MAX_FILE_BYTES).toBe(2 * 1024 * 1024);
  });
});

describe('坏文件与旧版本', () => {
  it('坏 JSON 不进列表，但文件还在（用户的图，不许擅自删）', async () => {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, `${ID}.json`), '{ 这不是 json', 'utf8');
    const store = createCanvasStore(root);
    expect(await store.list()).toEqual([]);
    // 文件仍在
    await expect(import('node:fs/promises').then((m) => m.access(canvasFile(root, ID)))).resolves.toBeUndefined();
  });

  it('v0 的旧文件读得回来（迁移骨架真的会跑）', async () => {
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, `${ID}.json`),
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        // 图自己的版本号写在 data 里（与信封版本是两件事）：v0 = 没有 viewport 的早期形状
        data: { version: 0, connectionId: 'conn-1', nodes: graph().nodes, edges: [] },
      }),
      'utf8',
    );
    const store = createCanvasStore(root);
    const loaded = await store.load(ID);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.graph.version).toBe(CANVAS_GRAPH_VERSION);
  });
});

describe('原子写与「损坏 ≠ 没有」（T40 · R23 修）', () => {
  it('第二次保存留下上一版的 .bak（原子写的既有语义，与 json-store 同源）', async () => {
    const store = createCanvasStore(root);
    await store.save(ID, graph());
    const v2 = graph({
      nodes: [{ id: 'b', kind: 'prompt', x: 1, y: 1, config: { prompt: '第二版' } }],
    });
    await store.save(ID, v2);
    // .bak = 上一版（"旧文件转 .bak"这一步真的发生了 —— 旧写法裸 writeFile 没有它）
    const bak = await readFile(`${canvasFile(root, ID)}.bak`, 'utf8');
    expect(bak).toContain('把要点写成三条');
    const cur = await readFile(canvasFile(root, ID), 'utf8');
    expect(cur).toContain('第二版');
    // 读回来仍是新版（.bak 只是救援副本，不抢主文件的位置）
    const loaded = await store.load(ID);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(JSON.stringify(loaded.graph)).toContain('第二版');
  });

  it('主文件损坏且没有备份：报「读不出来」，不许报成「没有这张图」', async () => {
    const store = createCanvasStore(root);
    await store.save(ID, graph());
    await rm(`${canvasFile(root, ID)}.bak`, { force: true }); // 构造"无备份"现场
    await writeFile(canvasFile(root, ID), '{ 这不是 JSON', 'utf8');
    const r = await store.load(ID);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('读不出来');
      expect(r.error).not.toContain('没有这张图');
    }
  });
});
