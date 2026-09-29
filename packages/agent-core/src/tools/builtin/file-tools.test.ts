import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listDirTool } from './file-tools';
import type { ToolContext } from '../types';

/**
 * `list_dir` 的上限参数（M19 轻量 IDE 的文件树要用）。
 *
 * 为什么加在工具上而不是只在面板里截断：面板截断意味着**整个目录的条目已经跨进程传过来了**——
 * 十万个名字照样把渲染层压住，只是"没画出来"而已。要防的是那一次读取本身。
 *
 * 为什么要保留"不传就列全部"：模型今天调 `list_dir` 的行为一个字都不能变
 * （它是模型的工具，不是面板的私有函数）。所以是**可选参数 + 默认不变**，
 * 而不是"顺手给所有人加个默认上限"。
 */

let root = '';
const ctx = (): ToolContext => ({ workspaceRoot: root });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'jujia-listdir-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('list_dir：默认行为不变，上限是可选参数', () => {
  it('不传 maxEntries 时列全部（模型的口径一字不改）', async () => {
    await mkdir(join(root, 'sub'));
    await writeFile(join(root, 'a.txt'), 'x');
    await writeFile(join(root, 'b.txt'), 'x');
    const out = await listDirTool.run({}, ctx());
    expect(out.content.split('\n').filter(Boolean).sort()).toEqual(['a.txt', 'b.txt', 'sub/']);
    expect(out.content).not.toContain('只显示');
  });

  it('传了 maxEntries 就截断，并如实标注还剩多少（不静默）', async () => {
    for (const name of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) {
      await writeFile(join(root, name), 'x');
    }
    const out = await listDirTool.run({ maxEntries: 2 }, ctx());
    const lines = out.content.split('\n').filter(Boolean);
    expect(lines.slice(0, 2)).toEqual(['a.txt', 'b.txt']);
    expect(out.content).toContain('共 4 项');
    expect(out.content).toContain('只显示了前 2 项');
  });

  it('条目没超上限时不加标注（不能"永远带着一句废话"）', async () => {
    await writeFile(join(root, 'only.txt'), 'x');
    const out = await listDirTool.run({ maxEntries: 10 }, ctx());
    expect(out.content.trim()).toBe('only.txt');
  });

  it('上限必须是正整数（0 / 负数 / 小数都拒）', () => {
    for (const bad of [0, -1, 1.5]) {
      expect(() => listDirTool.parse?.({ maxEntries: bad })).toThrow();
    }
  });
});
