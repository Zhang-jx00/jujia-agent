import { appendFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogRecord, formatLogLine, type LogRecord } from '@jujia/agent-core';
import { createLogStore } from './log-store';

/**
 * 日志落盘（M12 批一 · R10）。
 *
 * 验收面与审计同源：**记得住**（按天一个文件、可回读、换实例仍在）与**不装没事**
 * （写坏了要说、写满了要说、轮转删了谁要说）。一份会静默丢行或静默爆长的日志，
 * 比没有日志更危险 —— 它会在最需要它的时候给你一个"看起来是空的"答案。
 */

let dir: string;
const clock = (): Date => new Date('2026-10-13T09:00:00.000Z');

function rec(level: LogRecord['level'], msg: string): LogRecord {
  return createLogRecord({ level, scope: 'test', msg }, clock);
}

beforeEach(async () => {
  dir = await mkdtemp(join(process.cwd(), '.tmp', 'jujia-logs-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('createLogStore：追加与回读', () => {
  it('还没有文件时读到空（不抛、也不建文件）', async () => {
    const store = createLogStore({ dir, clock });
    const page = await store.tail(10);
    expect(page.records).toEqual([]);
    expect(page.total).toBe(0);
    const st = await store.status();
    expect(st.lines).toBe(0);
  });

  it('写入后换一个实例仍读得回来（磁盘真值，不是内存）', async () => {
    const a = createLogStore({ dir, clock });
    await a.append(rec('info', '第一行'));
    await a.append(rec('warn', '第二行'));
    const b = createLogStore({ dir, clock });
    const page = await b.tail(10);
    expect(page.records.map((r) => r.msg)).toEqual(['第一行', '第二行']);
    expect(page.total).toBe(2);
    // 文件就在"今天"名下
    expect(page.file.endsWith('app-2026-10-13.jsonl')).toBe(true);
  });

  it('到达当日上限后停止追加：本条不算、计数 + 1、话要说出来', async () => {
    const store = createLogStore({ dir, clock, maxLinesPerDay: 2 });
    await store.append(rec('info', '一'));
    await store.append(rec('info', '二'));
    const third = await store.append(rec('info', '三'));
    expect(third.written).toBe(false);
    expect(third.reason).toContain('上限');
    const page = await store.tail(10);
    expect(page.records).toHaveLength(2);
    expect(page.dropped).toBe(1);
    expect(page.notice).toContain('未记');
  });

  it('写不进去不抛穿业务，但写失败数得出、末次错误看得见', async () => {
    // 让 mkdir 失败：把"日志目录"指到一个**父级是文件**的路径下
    const blocker = join(dir, 'blocking-file');
    await writeFile(blocker, 'x', 'utf8');
    const store = createLogStore({ dir: join(blocker, 'logs'), clock });
    const r = await store.append(rec('error', '写不进去的一条'));
    expect(r.written).toBe(false);
    expect(r.reason).toContain('写入失败');
    const st = await store.status();
    expect(st.writeFailures).toBe(1);
    expect(st.lastError.length).toBeGreaterThan(0);
  });

  it('坏行只丢那一行（末行残缺是常态，不作废整本）', async () => {
    const store = createLogStore({ dir, clock });
    await store.append(rec('info', '好行一'));
    await mkdir(dir, { recursive: true });
    // 追加（不是覆盖）：末行故意留半截 JSON
    await appendFile(store.currentFile(), `${formatLogLine(rec('info', '好行二'))}\n{"half`, 'utf8');
    const page = await store.tail(10);
    expect(page.records.map((r) => r.msg)).toEqual(['好行一', '好行二']);
    expect(page.unparsed).toBe(1);
    expect(page.notice).toContain('没读出来');
  });
});

describe('级别过滤：界面要看"警告以上"时不用把整本搬过去', () => {
  it('tail 带门槛时只回不低于门槛的行，total 仍是今天全部', async () => {
    const store = createLogStore({ dir, clock });
    await store.append(rec('debug', '细节'));
    await store.append(rec('info', '普通'));
    await store.append(rec('warn', '警告'));
    await store.append(rec('error', '错误'));
    const page = await store.tail(10, 'warn');
    expect(page.records.map((r) => r.level)).toEqual(['warn', 'error']);
    expect(page.total).toBe(4);
  });
});

describe('轮转：只动自家文件、删了谁要说', () => {
  it('保留最近 N 天，更早的删掉并列名（同目录的无关文件不许碰）', async () => {
    await mkdir(dir, { recursive: true });
    // 造 10 天份日志 + 一个无关文件
    for (const day of ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']) {
      await writeFile(join(dir, `app-2026-10-${day}.jsonl`), '{}\n', 'utf8');
    }
    // 今天（注入时钟）是 10-13；保留 7 天 = 10-07 起
    await writeFile(join(dir, 'app-2026-10-13.jsonl'), '{}\n', 'utf8');
    await writeFile(join(dir, 'readme.txt'), '不是日志', 'utf8');

    const store = createLogStore({ dir, clock });
    const { removed } = await store.prune(7);
    // 今天（注入时钟）= 10-13；保留 7 天 = 10-07..10-13（含两端）
    expect(removed).toEqual([
      'app-2026-10-01.jsonl',
      'app-2026-10-02.jsonl',
      'app-2026-10-03.jsonl',
      'app-2026-10-04.jsonl',
      'app-2026-10-05.jsonl',
      'app-2026-10-06.jsonl',
    ]);
    // 边界：正好第 7 天（10-07）的留着
    const kept = await readFile(join(dir, 'app-2026-10-07.jsonl'), 'utf8');
    expect(kept).toBe('{}\n');
    // 无关文件没被碰
    expect(await readFile(join(dir, 'readme.txt'), 'utf8')).toBe('不是日志');
  });

  it('没有可删的就报空列表（轮转是静默的常客，这里不静默）', async () => {
    const store = createLogStore({ dir, clock });
    const { removed } = await store.prune(7);
    expect(removed).toEqual([]);
  });
});
