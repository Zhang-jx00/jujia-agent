import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTask } from './task-state';
import { createTaskStore, taskFile } from './task-store';

/**
 * 任务记录的落盘（M17 批一 · R15）：与会话同目录、走 JsonStore 原子写（tmp→fsync→rename + .bak）。
 *
 * 为什么逐条测：这张记录是"崩溃后唯一还记得断在哪"的东西 ——
 * 读不出来要**当成没有记录**（不能抛崩打开会话这条路径），写进坏形状要**当场拒**（不能猜）。
 */

let root: string;
let sessionsRoot: string;

beforeEach(async () => {
  root = await mkdtemp(join(process.cwd(), '.tmp', 'jujia-task-'));
  sessionsRoot = join(root, 'sessions');
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const rec = (over: Partial<Parameters<typeof createTask>[0]> = {}) =>
  createTask({
    taskId: 't-1',
    sessionId: 'sess-0001',
    instruction: '把报告写出来',
    now: new Date('2026-10-13T20:00:00.000Z'),
    ...over,
  });

describe('createTaskStore：写→读往返', () => {
  it('写进去再读回来，字段一字不差', async () => {
    const store = createTaskStore(sessionsRoot);
    await store.write('sess-0001', rec());
    const back = await store.read('sess-0001');
    expect(back?.taskId).toBe('t-1');
    expect(back?.instruction).toBe('把报告写出来');
    expect(back?.status).toBe('running');
  });

  it('记录就放在会话目录里的 task.json（与会话同生共死，不另起存储）', async () => {
    const store = createTaskStore(sessionsRoot);
    await store.write('sess-0001', rec());
    const raw = await readFile(taskFile(sessionsRoot, 'sess-0001'), 'utf8');
    const parsed = JSON.parse(raw) as { version: number; data: { taskId: string } };
    expect(parsed.version).toBe(1);
    expect(parsed.data.taskId).toBe('t-1');
  });

  it('没有记录 → null（不抛）：没跑过任务的会话是常态', async () => {
    const store = createTaskStore(sessionsRoot);
    expect(await store.read('sess-none1')).toBeNull();
  });

  it('坏文件 → null 且不抛（回退默认；打开会话的路径不能被一条烂记录崩掉）', async () => {
    const store = createTaskStore(sessionsRoot);
    await store.write('sess-0001', rec());
    await writeFile(taskFile(sessionsRoot, 'sess-0001'), '{这不是 JSON', 'utf8');
    expect(await store.read('sess-0001')).toBeNull();
  });

  it('结构对但状态是表外词的文件 → null（形状先验，不猜）', async () => {
    const store = createTaskStore(sessionsRoot);
    await store.write('sess-0001', rec());
    const good = JSON.parse(await readFile(taskFile(sessionsRoot, 'sess-0001'), 'utf8')) as {
      data: Record<string, unknown>;
    };
    await writeFile(
      taskFile(sessionsRoot, 'sess-0001'),
      JSON.stringify({ version: 1, updatedAt: 'x', data: { ...good.data, status: '删库中' } }),
      'utf8',
    );
    expect(await store.read('sess-0001')).toBeNull();
  });

  it('会话 id 白名单照旧生效：拿非法 id 拼路径当场抛（同一道守卫，不绕）', async () => {
    const store = createTaskStore(sessionsRoot);
    await expect(store.write('../evil', rec({ sessionId: '../evil' }))).rejects.toThrow();
  });
});
