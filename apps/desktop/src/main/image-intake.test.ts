import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IMAGE_MAX_PER_MESSAGE } from '@jujia/agent-core';
import { prepareByteImages, readImageFiles } from './image-intake';

/**
 * 图片接收层（M11 批一 · R14）：选择器（给路径，**先 stat 再 readFile**）与
 * 拖动/粘贴（给原始字节）两条路，**共用同一个准入内核**（agent-core 的 prepareImage）。
 *
 * 验收面三件事：① 上限挡在读盘之前；② 逐张给结果 —— 好的进、坏的带理由出；
 * ③ 超量（>4）**明说**，不静默丢。
 */

let dir: string;

/** 最小合法 PNG（8 字节签名 + IHDR + IEND；CRC 用零占位 —— 剥离只走结构不校验 CRC） */
function tinyPng(withMeta = false): Uint8Array {
  const utf8 = (s: string): Uint8Array => new Uint8Array(Array.from(s, (c) => c.charCodeAt(0)));
  const chunk = (type: string, payload: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + payload.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, payload.length);
    out.set(utf8(type), 4);
    out.set(payload, 8);
    return out;
  };
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [sig, chunk('IHDR', new Uint8Array(13))];
  if (withMeta) parts.push(chunk('tEXt', utf8('GPS 31.23')));
  parts.push(chunk('IEND', new Uint8Array(0)));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

beforeEach(async () => {
  dir = await mkdtemp(join(process.cwd(), '.tmp', 'jujia-intake-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('readImageFiles：给路径这条路（先 stat 再读）', () => {
  it('合法 PNG 读进来 → 剥完元数据、带名字与大小', async () => {
    const p = join(dir, 'shot.png');
    await writeFile(p, tinyPng(true));
    const r = await readImageFiles([p]);
    expect(r.problems).toEqual([]);
    expect(r.images).toHaveLength(1);
    expect(r.images[0]?.mimeType).toBe('image/png');
    expect(r.images[0]?.name).toBe('shot.png');
    expect(r.images[0]?.stripped).toBe(true);
  });

  it('超过 5MB 的**在读进来之前**就被挡（stat 先判）—— 沙箱沙不了盘，这条只能按大小断言', async () => {
    const p = join(dir, 'huge.png');
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 0);
    await writeFile(p, big);
    const r = await readImageFiles([p]);
    expect(r.images).toEqual([]);
    expect(r.problems[0]).toContain('5MB');
  });

  it('不存在 / 不是图片：逐条给理由，不整体失败', async () => {
    const bad = join(dir, 'note.txt');
    await writeFile(bad, '这不是图片');
    const r = await readImageFiles([bad, join(dir, 'missing.png')]);
    expect(r.images).toEqual([]);
    expect(r.problems).toHaveLength(2);
    expect(r.problems[0]).toContain('不是支持的图片');
    expect(r.problems[1]).toMatch(/读不到|找不到|ENOENT/);
  });

  it(`一次最多 ${IMAGE_MAX_PER_MESSAGE} 张：多出来的**明说**，不静默丢`, async () => {
    const paths: string[] = [];
    for (let i = 0; i < IMAGE_MAX_PER_MESSAGE + 1; i += 1) {
      const p = join(dir, `img-${String(i)}.png`);
      await writeFile(p, tinyPng(false));
      paths.push(p);
    }
    const r = await readImageFiles(paths);
    expect(r.images).toHaveLength(IMAGE_MAX_PER_MESSAGE);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain(String(IMAGE_MAX_PER_MESSAGE));
  });
});

describe('prepareByteImages：拖动/粘贴这条路（给原始字节，再走同一个内核）', () => {
  it('合法 PNG 字节 → 与读盘路径同一形状的结果', () => {
    const r = prepareByteImages([{ name: 'drop.png', bytes: tinyPng(false) }]);
    expect(r.problems).toEqual([]);
    expect(r.images[0]?.name).toBe('drop.png');
    expect(r.images[0]?.stripped).toBe(false);
  });

  it('剥元数据同样生效（字节路不比读盘路少一道）', () => {
    const r = prepareByteImages([{ name: 'drop.png', bytes: tinyPng(true) }]);
    expect(r.problems).toEqual([]);
    expect(r.images[0]?.stripped).toBe(true);
  });

  it('认不出的字节：给理由，不抛', () => {
    const r = prepareByteImages([{ name: 'x.png', bytes: new Uint8Array([1, 2, 3, 4]) }]);
    expect(r.images).toEqual([]);
    expect(r.problems[0]).toContain('不是支持的图片');
  });

  it(`一次最多 ${IMAGE_MAX_PER_MESSAGE} 张：多出来的**明说**，不静默丢`, () => {
    const items = Array.from({ length: IMAGE_MAX_PER_MESSAGE + 1 }, (_, i) => ({
      name: `d-${String(i)}.png`,
      bytes: tinyPng(false),
    }));
    const r = prepareByteImages(items);
    expect(r.images).toHaveLength(IMAGE_MAX_PER_MESSAGE);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain(`d-${String(IMAGE_MAX_PER_MESSAGE)}.png`);
  });
});
