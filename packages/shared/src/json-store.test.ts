import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonStore, __resetWriteQueues, atomicWriteJson, readJsonSafe } from './json-store';

interface Config {
  theme: 'light' | 'dark';
  workspace: string | null;
}

const defaults = (): Config => ({ theme: 'dark', workspace: null });

const validateConfig = (input: unknown): Config => {
  if (typeof input !== 'object' || input === null) throw new Error('不是对象');
  const o = input as Record<string, unknown>;
  if (o['theme'] !== 'light' && o['theme'] !== 'dark') throw new Error('theme 非法');
  const ws = o['workspace'];
  if (ws !== null && typeof ws !== 'string') throw new Error('workspace 非法');
  return { theme: o['theme'], workspace: ws };
};

let dir: string;
let file: string;

beforeEach(async () => {
  __resetWriteQueues();
  dir = await mkdtemp(join(tmpdir(), 'jujia-store-'));
  file = join(dir, 'config.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('atomicWriteJson', () => {
  it('写入后内容可读，且不残留 .tmp 文件', async () => {
    await atomicWriteJson(file, { version: 1, data: defaults() });
    const raw = await readFile(file, 'utf8');
    expect(JSON.parse(raw)).toMatchObject({ version: 1 });

    const leftovers = (await readdir(dir)).filter((n) => n.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('覆盖写会生成 .bak，且 .bak 保留上一版内容', async () => {
    await atomicWriteJson(file, { version: 1, data: { theme: 'dark', workspace: null } });
    await atomicWriteJson(file, { version: 1, data: { theme: 'light', workspace: 'D:/p' } });

    const bak = JSON.parse(await readFile(`${file}.bak`, 'utf8')) as { data: Config };
    expect(bak.data.theme).toBe('dark');
  });

  it('并发写同一路径不会互相破坏（串行化）', async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_v, i) =>
        atomicWriteJson(file, { version: 1, data: { theme: i % 2 ? 'light' : 'dark', workspace: null } }),
      ),
    );
    const parsed = JSON.parse(await readFile(file, 'utf8')) as { version: number };
    expect(parsed.version).toBe(1); // 文件始终是完整 JSON
    expect((await readdir(dir)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  // 复核发现（2026-09-18 第二遍，运行时损坏恢复实验暴露）：
  // 初版把主文件无条件 rename 成 .bak，若主文件已损坏，就会用垃圾覆盖掉
  // 本来健康的备份——等于亲手毁掉唯一的救援副本。此用例锁死该行为。
  it('主文件损坏时写入：不得覆盖健康 .bak，并隔离损坏文件为 .corrupt-*', async () => {
    await atomicWriteJson(file, { version: 1, data: { theme: 'dark', workspace: null } });
    await atomicWriteJson(file, { version: 1, data: { theme: 'light', workspace: 'D:/new' } });
    const healthyBak = await readFile(`${file}.bak`, 'utf8');
    expect(healthyBak).toContain('"dark"');

    // 模拟断电：主文件被截断
    await writeFile(file, '{"version":1,"data":{"theme":"lig', 'utf8');

    // 自愈写回（真实场景中由 ensureConfigFile 触发）
    await atomicWriteJson(file, { version: 1, data: { theme: 'light', workspace: 'D:/new' } });

    // .bak 必须保持健康内容，未被截断垃圾覆盖
    expect(await readFile(`${file}.bak`, 'utf8')).toBe(healthyBak);

    // 损坏文件被隔离留证
    const quarantined = (await readdir(dir)).filter((n) => n.includes('.corrupt-'));
    expect(quarantined).toHaveLength(1);

    // 主文件已恢复正常
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ version: 1 });
  });
});

describe('readJsonSafe 的三级降级', () => {
  it('正常文件 → source=primary, 未触发恢复', async () => {
    const store = new JsonStore<Config>(file, { version: 1, defaults, validate: validateConfig });
    await store.write({ theme: 'light', workspace: 'D:/ws' });

    const res = await store.read();
    expect(res.source).toBe('primary');
    expect(res.recovered).toBe(false);
    expect(res.data.workspace).toBe('D:/ws');
    expect(res.detectedVersion).toBe(1);
  });

  it('主文件半截损坏（模拟断电）→ 回退 .bak 并标记 recovered', async () => {
    const store = new JsonStore<Config>(file, { version: 1, defaults, validate: validateConfig });
    await store.write({ theme: 'dark', workspace: 'D:/old' }); // 生成基线
    await store.write({ theme: 'light', workspace: 'D:/new' }); // 产生 .bak（内容为 dark/old）

    // 模拟写一半就断电：主文件被截断成非法 JSON
    await writeFile(file, '{"version":1,"data":{"theme":"lig', 'utf8');

    const res = await store.read();
    expect(res.source).toBe('backup');
    expect(res.recovered).toBe(true);
    expect(res.data).toEqual({ theme: 'dark', workspace: 'D:/old' });
  });

  it('主文件与 .bak 均损坏 → 回退默认值且不抛异常', async () => {
    await writeFile(file, 'not json at all', 'utf8');
    await writeFile(`${file}.bak`, '{{{', 'utf8');

    const res = await readJsonSafe<Config>(file, {
      version: 1,
      defaults,
      validate: validateConfig,
    });
    expect(res.source).toBe('default');
    expect(res.recovered).toBe(true);
    expect(res.data).toEqual(defaults());
  });

  it('内容合法但 schema 不符 → 视为不可用并降级', async () => {
    await writeFile(file, JSON.stringify({ version: 1, data: { theme: 'blue' } }), 'utf8');
    const res = await readJsonSafe<Config>(file, {
      version: 1,
      defaults,
      validate: validateConfig,
    });
    expect(res.source).toBe('default');
  });
});

describe('版本迁移', () => {
  it('旧版本信封会先 migrate 再 validate', async () => {
    await writeFile(
      file,
      JSON.stringify({ version: 1, data: { dark: true } }),
      'utf8',
    );

    const res = await readJsonSafe<Config>(file, {
      version: 2,
      defaults,
      validate: validateConfig,
      migrate: (from, data) => {
        expect(from).toBe(1);
        const old = data as { dark: boolean };
        return { theme: old.dark ? 'dark' : 'light', workspace: null };
      },
    });

    expect(res.source).toBe('primary');
    expect(res.data.theme).toBe('dark');
    expect(res.detectedVersion).toBe(2); // 迁移后按当前版本对待
  });
});

describe('JsonStore.update', () => {
  it('读改写一体化，且写入内容带 updatedAt', async () => {
    const store = new JsonStore<Config>(file, { version: 1, defaults, validate: validateConfig });
    const next = await store.update((cur) => ({ ...cur, workspace: 'D:/proj' }));

    expect(next.workspace).toBe('D:/proj');
    const disk = JSON.parse(await readFile(file, 'utf8')) as { updatedAt: string };
    expect(Number.isNaN(Date.parse(disk.updatedAt))).toBe(false);
  });
});
