import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  STORED_MESSAGE_MAX_CHARS,
  createSessionStore,
  messagesFile,
  sessionDir,
  toStoredMessage,
  type SessionMeta,
  type SessionStore,
  type StoredMessage,
} from './session-store';

/** 一个正常形态的会话 id（真实来源是 `randomUUID()`，这里写死一个同形态的值） */
const ID = 'a1b2c3d4-0000-4000-8000-000000000000';

/**
 * 会话存储层的验收（铺设计划 6 · 6a）。
 *
 * 重心放在三件"错了就伤用户数据"的事上：
 * ① 会话 id 不许被当成路径直接用（白名单在唯一入口处把关）；
 * ② 残缺行只允许出现在**最后一条**，中间坏掉要报而不是跳过；
 * ③ 清单只是缓存 —— 它坏了不能连带丢会话，必须能从目录重建。
 */

let root = '';

const meta = (id: string, over: Partial<SessionMeta> = {}): SessionMeta => ({
  id,
  connectionId: 'conn-1',
  title: '一段标题',
  createdAt: '2026-09-26T10:00:00.000Z',
  lastUsedAt: '2026-09-26T10:00:00.000Z',
  messageCount: 0,
  compactedThrough: 0,
  ...over,
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'jujia-sessions-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/**
 * 6a 时这里是 `store.record(meta, msgs)`；T6① 之后"先落消息、再写元信息、失败不回退计数"
 * 这件事归 `session-journal` 管（见 session-journal.test.ts），存储层只留两个动作。
 * 本文件的用例测的还是"写进去的能读回来"，所以这里给一个两行的替身，不改动用例本意。
 */
async function record(store: SessionStore, meta: SessionMeta, messages: StoredMessage[]): Promise<void> {
  await store.append(meta.id, messages);
  await store.saveMeta(meta);
}

describe('会话 id 只能经白名单变成路径', () => {
  it.each([
    ['../escape', '相对路径上跳'],
    ['..', '只有上跳'],
    ['a/b', '带分隔符'],
    ['a\\b', 'Windows 分隔符'],
    ['ABS-UUID', '大写不在白名单'],
    ['short', '不足 6 字符'],
    ['', '空串'],
    [`${'x'.repeat(80)}`, '超长'],
    ['ok-id;rm -rf', '夹带分号'],
  ])('%s（%s）→ 抛', (id) => {
    expect(() => sessionDir(root, id)).toThrow(/不合法/);
  });

  it('正常 uuid 形态通过', () => {
    expect(sessionDir(root, ID)).toBe(join(root, ID));
    expect(() => messagesFile(root, ID)).not.toThrow();
  });
});

describe('写入与读回', () => {
  it('record 之后 list 看得见、load 读得回同样内容', async () => {
    const store = createSessionStore(root);
    const id = ID;
    const msgs = [toStoredMessage('user', '第一个问题'), toStoredMessage('assistant', '第一个回答')];
    await record(store, meta(id, { messageCount: msgs.length }), msgs);

    const listed = await store.list();
    expect(listed.length).toBe(1);
    expect(listed[0]?.id).toBe(id);

    const loaded = await store.load(id);
    expect(loaded.droppedTailBytes).toBe(0);
    expect(loaded.messages.map((m) => m.content)).toEqual(['第一个问题', '第一个回答']);
    expect(loaded.messages[0]?.role).toBe('user');
  });

  it('同一会话再 record 是追加，不覆盖（append-only）', async () => {
    const store = createSessionStore(root);
    const id = ID;
    await record(store, meta(id), [toStoredMessage('user', '一')]);
    await record(store, meta(id), [toStoredMessage('user', '二')]);
    const loaded = await store.load(id);
    expect(loaded.messages.map((m) => m.content)).toEqual(['一', '二']);
  });

  it('单条超上限被截断并如实标注（不静默丢字）', () => {
    const long = 'x'.repeat(STORED_MESSAGE_MAX_CHARS + 500);
    const m = toStoredMessage('user', long);
    expect(m.content.length).toBeLessThanOrEqual(STORED_MESSAGE_MAX_CHARS + 40);
    expect(m.content).toContain('已截断');
  });

  it('换行与连续空白被压成单行（JSONL 一行一条的前提）', () => {
    const m = toStoredMessage('user', '第一行\n\n第二行\t带制表');
    expect(m.content).toBe('第一行 第二行 带制表');
  });
});

describe('损坏处理：只允许丢最后一条', () => {
  it('末行残缺 → 丢掉它并报告字节数，前面的完整行照常读回', async () => {
    const store = createSessionStore(root);
    const id = ID;
    await record(store, meta(id), [toStoredMessage('user', '完好的一行')]);
    const path = messagesFile(root, id);
    const tail = await readFile(path, 'utf8');
    await writeFile(path, `${tail}{"v":1,"role":"u`, 'utf8');
    const loaded = await store.load(id);
    expect(loaded.messages.length).toBe(1);
    expect(loaded.droppedTailBytes).toBeGreaterThan(0);
  });

  it('中间行损坏 → 抛错（不能用"丢弃最后一条"解释成正常）', async () => {
    const store = createSessionStore(root);
    const id = ID;
    await record(store, meta(id), [toStoredMessage('user', 'A')]);
    const path = messagesFile(root, id);
    const body = await readFile(path, 'utf8');
    await writeFile(path, `不是一行 JSON\n${body}`, 'utf8');
    await expect(store.load(id)).rejects.toThrow(/第 1 行损坏/);
  });

  it('遇到比当前实现更新的版本号 → 拒绝加载并说清原因，不"尽力解析"', async () => {
    const store = createSessionStore(root);
    const id = ID;
    await record(store, meta(id), [toStoredMessage('user', 'A')]);
    const path = messagesFile(root, id);
    const head = await readFile(path, 'utf8');
    await writeFile(path, `${head}{"v":99,"role":"user","content":"未来的行"}`, 'utf8');
    await expect(store.load(id)).rejects.toThrow(/future-version|版本/);
  });
});

describe('清单只是缓存', () => {
  it('index.json 被删掉后仍能由目录重建（会话不因缓存坏而"消失"）', async () => {
    const store = createSessionStore(root);
    const id = ID;
    await record(store, meta(id), [toStoredMessage('user', '留着')]);
    await rm(join(root, 'index.json'), { force: true });
    const listed = await store.list();
    expect(listed.map((m) => m.id)).toEqual([id]);
  });

  it('index.json 是垃圾也不炸：重建即可', async () => {
    const store = createSessionStore(root);
    await record(store, meta(ID), [toStoredMessage('user', 'x')]);
    await writeFile(join(root, 'index.json'), '{ 坏掉的 json', 'utf8');
    await expect(store.list()).resolves.toBeInstanceOf(Array);
  });

  it('不认识名字的目录被跳过（不猜、也不报错卡死整个列表）', async () => {
    await mkdir(join(root, 'NOT-A-SESSION'), { recursive: true });
    const store = createSessionStore(root);
    await record(store, meta(ID), [toStoredMessage('user', 'x')]);
    expect((await store.list()).map((m) => m.id)).toEqual([ID]);
  });

  /**
   * T6③：以前"重建"是**只读**的 —— 删掉 index.json 之后清单就永远不再存在，
   * 每次列会话都要重扫全目录（看似只是慢，实际是把"缓存"这件事悄悄取消了）。
   */
  it('重建之后把清单**写回磁盘**（下一次列会话不再依赖扫目录）', async () => {
    const store = createSessionStore(root);
    await record(store, meta(ID), [toStoredMessage('user', '留着')]);
    await rm(join(root, 'index.json'), { force: true });
    expect(await store.list()).toHaveLength(1);
    // 写回是真的发生：另开一个实例、只读缓存也能列出来（不碰目录扫描）
    const again = createSessionStore(root);
    const cached = await again.list();
    expect(cached.map((m) => m.id)).toEqual([ID]);
    expect(JSON.parse(await readFile(join(root, 'index.json'), 'utf8'))).toMatchObject({
      data: { sessions: [{ id: ID }] },
    });
  });

  it('两个会话同时更新清单：读—改—写被串行化，谁都不被覆盖（T6③）', async () => {
    const store = createSessionStore(root);
    const other = 'b2c3d4e5-1111-4000-8000-000000000000';
    await Promise.all([
      store.saveMeta(meta(ID, { lastUsedAt: '2026-09-27T10:00:00.000Z' })),
      store.saveMeta(meta(other, { lastUsedAt: '2026-09-27T11:00:00.000Z' })),
    ]);
    expect((await store.list()).map((m) => m.id).sort()).toEqual([ID, other].sort());
  });
});
