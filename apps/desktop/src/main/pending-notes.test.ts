import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPendingNotes, shouldAskAgain } from './pending-notes';

/**
 * "哪个会话结束了还没记要点"这本账（6b · 报备 §四，批复④批准）。
 *
 * 为什么单独一个文件、且要点**不是当场写进 NOTES.md**：
 * ① 退出路径上做模型调用不可靠（进程要退了，异步调用会被杀）；
 * ② "落盘前必须预览"是硬要求，而退出时没人在看屏幕。
 * 所以退出只**记一笔待办**，下次启动再问一次 —— 写进长期记忆这一步永远发生在人点过之后。
 *
 * 这里只验账本本身（幂等、可读回、坏了不卡死）；跨进程的端到端事实在 e2e 里问。
 */

let root = '';
const file = () => join(root, 'pending-notes.json');

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'jujia-pending-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('待记要点的账本', () => {
  it('没有这个文件时是空账本（首次使用不该抛）', async () => {
    const ledger = createPendingNotes(file());
    expect(await ledger.list()).toEqual([]);
    expect(await ledger.neverAsk()).toBe(false);
  });

  it('同一会话被反复标记只留一条 —— 退出被点两次不该堆出重复追问', async () => {
    const ledger = createPendingNotes(file());
    await ledger.mark('sess-1', '第一段会话');
    await ledger.mark('sess-1', '第一段会话（标题后来改了）');
    const items = await ledger.list();
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('第一段会话（标题后来改了）');
  });

  it('换实例读得到：重启之后仍然记得要问', async () => {
    await createPendingNotes(file()).mark('sess-1', '一段');
    await createPendingNotes(file()).mark('sess-2', '二段');
    const again = createPendingNotes(file());
    expect((await again.list()).map((i) => i.sessionId).sort()).toEqual(['sess-1', 'sess-2']);
  });

  it('记完 / 决定不记之后从账上划掉', async () => {
    const ledger = createPendingNotes(file());
    await ledger.mark('sess-1', '一段');
    await ledger.clear('sess-1');
    expect(await ledger.list()).toEqual([]);
    // 划掉不存在的会话不该报错（幂等：可能上一次已经划了）
    await expect(ledger.clear('sess-1')).resolves.toBeUndefined();
  });

  it('「不再问」是持久决定，不是这一轮的临时状态', async () => {
    await createPendingNotes(file()).setNeverAsk(true);
    expect(await createPendingNotes(file()).neverAsk()).toBe(true);
    await createPendingNotes(file()).setNeverAsk(false);
    expect(await createPendingNotes(file()).neverAsk()).toBe(false);
  });

  it('文件被写坏时按空账本继续用，不卡住启动（损坏原件留证）', async () => {
    await writeFile(file(), '{ 这不是 JSON', 'utf8');
    const ledger = createPendingNotes(file());
    expect(await ledger.list()).toEqual([]);
    await ledger.mark('sess-1', '一段');
    expect(await createPendingNotes(file()).list()).toHaveLength(1);
  });

  it('只留最近若干条：这本账不该无限增长', async () => {
    const ledger = createPendingNotes(file());
    for (let i = 0; i < 40; i += 1) await ledger.mark(`sess-${String(i)}`, `标题 ${String(i)}`);
    const items = await ledger.list();
    expect(items.length).toBeLessThanOrEqual(20);
    expect(items.some((i) => i.sessionId === 'sess-39')).toBe(true);
  });

  it('落盘是真文件、不是内存：写完能在磁盘上看到内容', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jujia-pending2-'));
    const target = join(dir, 'nested', 'pending-notes.json');
    await mkdir(join(dir, 'nested'), { recursive: true });
    await createPendingNotes(target).mark('sess-1', '一段');
    expect(await readFile(target, 'utf8')).toContain('sess-1');
    await rm(dir, { recursive: true, force: true });
  });

  it('两条会话同时被标记：读—改—写被串行化，账上不少条目（T6③ 那一课在这里重演）', async () => {
    const ledger = createPendingNotes(file());
    await Promise.all([ledger.mark('sess-a', '甲'), ledger.mark('sess-b', '乙')]);
    expect((await ledger.list()).map((i) => i.sessionId).sort()).toEqual(['sess-a', 'sess-b']);
  });

  it('「记完划掉」与「标记」并发也不会把账写丢', async () => {
    const ledger = createPendingNotes(file());
    await ledger.mark('sess-c', '丙');
    await Promise.all([ledger.clear('sess-c'), ledger.mark('sess-d', '丁')]);
    const ids = (await ledger.list()).map((i) => i.sessionId).sort();
    expect(ids).toContain('sess-d');
  });

});

/**
 * "这一批话问过了吗"（写这条的原因是在设计 e2e 时发现的真缺陷）：
 * 用户在会话里点了「记」，账刚划掉；紧接着退出，`markAllResidentEnded` 又会把这个
 * 还驻留在内存里的会话重新记上一笔 —— 下次启动再问一遍同一批内容。
 * 判据用**落盘条数**（和水印同一个坐标系）：只有记过之后又多出来的消息才值得再问。
 */
describe('shouldAskAgain：记过的内容不问第二遍', () => {
  it('记要点时是 8 条，退出时还是 8 条 —— 不再问', () => {
    expect(shouldAskAgain(8, 8)).toBe(false);
  });

  it('记完又聊出第 9、10 条 —— 该问了', () => {
    expect(shouldAskAgain(8, 10)).toBe(true);
  });

  it('从没记过（-1）时，只要有内容就问；一条都没有就不问', () => {
    expect(shouldAskAgain(-1, 1)).toBe(true);
    expect(shouldAskAgain(-1, 0)).toBe(false);
  });

  it('盘上条数倒退也不可能出现，但判据不能反过来（宁可少问，不能把没问的当成问过）', () => {
    expect(shouldAskAgain(8, 7)).toBe(false);
  });
});
