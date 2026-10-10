import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatAuditLine, makeRecord, type AuditRecord } from '@jujia/agent-core';
import { createAuditLog } from './audit-log';

/**
 * 审计落盘（M4 收尾 · 其二）。
 *
 * 验收面只有两件事：**记得住**（追加、分日、可回读）与**不装没事**
 * （写坏了要说、写满了要说、末行残缺要说）。
 * 一份会静默丢记录的审计文件，比没有审计更危险 —— 它会让人以为"查得到"。
 */

let dir: string;
const clock = (): Date => new Date('2026-10-09T10:00:00.000Z');

function rec(over: Partial<Parameters<typeof makeRecord>[0]> = {}): AuditRecord {
  return makeRecord({
    clock: '2026-10-09T10:00:00.000Z',
    sessionId: 's-1',
    subject: 'run_command',
    kind: 'exec',
    outcome: 'deny',
    executed: false,
    reason: '命中你的规则「run_command」（命令前缀：rm -rf）→ 拒绝',
    ...over,
  });
}

beforeEach(async () => {
  dir = await mkdtemp(join(process.cwd(), '.tmp', 'jujia-audit-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('createAuditLog', () => {
  it('一天一个文件、按行追加，回读得到原样', async () => {
    const log = createAuditLog({ dir, clock });
    await log.append(rec());
    await log.append(rec({ subject: 'write_file', outcome: 'allow', reason: '只读操作' }));

    const files = await readdir(dir);
    expect(files).toEqual(['permissions-2026-10-09.jsonl']);

    const page = await log.tail(10);
    expect(page.records.map((r) => r.subject)).toEqual(['run_command', 'write_file']);
    expect(page.unparsed).toBe(0);
    expect(page.dropped).toBe(0);
  });

  it('日期跨天要分文件（审计按天翻是常态，混在一个文件里会把两天的账搅在一起）', async () => {
    // 用**本地时间**构造器：分日判据看的是本地日期（晚上十点的操作该记在"今天"），
    // 写 ISO 串会按 UTC 解析，在 UTC+8 机器上两个时刻其实落在同一天 —— 那样这条用例测不到分日
    let now = new Date(2026, 9, 9, 23, 59);
    const log = createAuditLog({ dir, clock: () => now });
    await log.append(rec());
    now = new Date(2026, 9, 10, 0, 1);
    await log.append(rec());
    expect((await readdir(dir)).sort()).toEqual([
      'permissions-2026-10-09.jsonl',
      'permissions-2026-10-10.jsonl',
    ]);
    const page = await log.tail(10);
    // 换天后"今天的账"从头开始：回读只看当天，这是口径而不是丢失
    expect(page.records).toHaveLength(1);
    expect(page.file).toContain('2026-10-10');
  });

  it('目录不存在时自己建（第一次运行就要能记账，不能等谁先手动建目录）', async () => {
    const log = createAuditLog({ dir: join(dir, 'deeper', 'audit'), clock });
    await log.append(rec());
    const page = await log.tail(5);
    expect(page.records).toHaveLength(1);
  });

  it('写满上限后不再写，但**必须说得出丢了几条**（静默丢记录 = 账不可信）', async () => {
    const log = createAuditLog({ dir, clock, maxLinesPerDay: 2 });
    await log.append(rec());
    await log.append(rec());
    await log.append(rec());
    await log.append(rec());
    const page = await log.tail(50);
    expect(page.records).toHaveLength(2);
    expect(page.dropped).toBe(2);
    expect(page.notice).toContain('未记');
  });

  it('末行残缺不许把整本账读废（jsonl 的既有口径：只有最后一条允许是半截）', async () => {
    await mkdir(dir, { recursive: true });
    const file = join(dir, 'permissions-2026-10-09.jsonl');
    await writeFile(file, `${formatAuditLine(rec())}\n{"ts":"2026-10-09T10:00:00.000Z","subjec`, 'utf8');
    const log = createAuditLog({ dir, clock });
    const page = await log.tail(10);
    expect(page.records).toHaveLength(1);
    expect(page.unparsed).toBe(1);
    expect(page.notice).toContain('末行');
  });

  it('磁盘写不进去时不抛穿业务、但要在状态里报出来（审计失败不该让工具调用跟着死）', async () => {
    // 用一个"目录路径其实是个文件"的位置制造真实写失败
    const blocker = join(dir, 'blocker');
    await writeFile(blocker, 'not a dir', 'utf8');
    const log = createAuditLog({ dir: blocker, clock });
    await expect(log.append(rec())).resolves.toMatchObject({ written: false });
    const status = await log.status();
    expect(status.writeFailures).toBe(1);
    expect(status.lastError).toContain('blocker');
  });

  it('tail 只给最近 N 条、且时间正序（界面要的是"最近发生了什么"，翻页交给导出）', async () => {
    const log = createAuditLog({ dir, clock });
    for (let i = 0; i < 5; i += 1) await log.append(rec({ reason: `第 ${String(i)} 条` }));
    const page = await log.tail(2);
    expect(page.records.map((r) => r.reason)).toEqual(['第 3 条', '第 4 条']);
    expect(page.total).toBe(5);
  });

  it('导出的就是账本原文（剔密在写入前已经做完，导出不该再有第二次加工的机会）', async () => {
    const log = createAuditLog({ dir, clock });
    await log.append(rec());
    await log.append(rec());
    const dest = join(dir, 'exported.jsonl');
    const result = await log.exportTo(dest);
    expect(result.lines).toBe(2);
    const { readFile } = await import('node:fs/promises');
    expect((await readFile(dest, 'utf8')).split('\n').filter((l) => l !== '')).toHaveLength(2);
  });

  it('导出目标已存在时拒绝覆盖（与文件工具的覆盖保护同一口径：不许悄悄改掉别人的文件）', async () => {
    const log = createAuditLog({ dir, clock });
    await log.append(rec());
    const dest = join(dir, 'already-there.jsonl');
    await writeFile(dest, 'user data', 'utf8');
    await expect(log.exportTo(dest)).rejects.toThrow(/已存在/);
    const { readFile } = await import('node:fs/promises');
    expect(await readFile(dest, 'utf8')).toBe('user data');
  });
});
