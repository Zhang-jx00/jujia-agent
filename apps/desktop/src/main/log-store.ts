import { appendFile, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  formatLogLine,
  parseLogLine,
  shouldLog,
  type LogLevel,
  type LogRecord,
} from '@jujia/agent-core';

/**
 * 日志落盘（M12 批一 · R10）。
 *
 * 与执行审计（`audit-log.ts`）同一形状 —— 它们回答的是同一类问题
 * （"当时到底发生了什么"），不该出现两套读法：
 * 1. **按天一个 JSONL**（本地日期）：翻日志按天翻是常态，也避免单文件无限长大；
 * 2. **写不进去不抛穿业务**，但失败**数得出、看得见**（`status()` / `notice`）；
 * 3. **写满了不许静默丢**：到当日上限后停止追加、开始计数，`tail()` 会把那句话带着走；
 * 4. 本条追加的**轮转**：保留最近若干天（`prune`），删了谁都列名 ——
 *    轮转是最容易变成"某天日志突然没了也没人知道"的地方。
 *
 * 剔密在 `createLogRecord` 里就做完了（`agent-core/log/log-record.ts`）：
 * 这个文件只负责搬运"已经可以见人"的形状。
 */

export interface LogStore {
  /** 追加一条。返回是否真的写下去了（写失败不抛，但要说） */
  append(record: LogRecord): Promise<{ written: boolean; reason?: string }>;
  /** 今天的最近 N 条（正序）；带 `minLevel` 时只回不低于门槛的 */
  tail(limit: number, minLevel?: LogLevel): Promise<LogPage>;
  status(): Promise<LogStatus>;
  /** 今天的日志在哪个文件（界面要能指出"去哪儿看"） */
  currentFile(): string;
  /** 保留最近 `keepDays` 天（含今天），更早的删掉；返回删了哪些 */
  prune(keepDays: number): Promise<{ removed: string[] }>;
}

export interface LogPage {
  records: LogRecord[];
  /** 今天一共多少条（解析成功的，不受 limit 与级别过滤影响） */
  total: number;
  /** 读不出来的行数（残缺末行也算） */
  unparsed: number;
  /** 本次运行内因到达上限而没记下去的条数 */
  dropped: number;
  /** 必须让人看见的一句话（没有异常时为空串） */
  notice: string;
  file: string;
}

export interface LogStatus {
  file: string;
  lines: number;
  dropped: number;
  writeFailures: number;
  lastError: string;
}

export interface LogStoreOptions {
  /** 日志目录（生产用 `getDataRoot()/logs`） */
  dir: string;
  /** 注入时钟：分日文件名与轮转边界都要可测 */
  clock: () => Date;
  maxLinesPerDay?: number;
}

const DEFAULT_MAX_LINES_PER_DAY = 20_000;
const FILE_RE = /^app-(\d{4})-(\d{2})-(\d{2})\.jsonl$/;

function dayKey(now: Date): string {
  // 与审计同口径：**本地日期**分日（UTC 会把晚上十点的事件记到"明天"）
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${String(y)}-${m}-${d}`;
}

/** 由"今天"往回取 keepDays 天（含今天）的日期键 —— 逐日走日历（夏令时也加得对） */
function keepKeys(today: Date, keepDays: number): Set<string> {
  const keys = new Set<string>();
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  for (let i = 0; i < keepDays; i += 1) {
    keys.add(dayKey(cursor));
    cursor.setDate(cursor.getDate() - 1);
  }
  return keys;
}

export function createLogStore(opts: LogStoreOptions): LogStore {
  const maxLines = opts.maxLinesPerDay ?? DEFAULT_MAX_LINES_PER_DAY;
  /** 本次运行的丢计与写失败计数（重启后归零 —— 界面话术必须写"本次运行"） */
  let dropped = 0;
  let writeFailures = 0;
  let lastError = '';

  const fileFor = (now: Date): string => join(opts.dir, `app-${dayKey(now)}.jsonl`);
  const currentFile = (): string => fileFor(opts.clock());

  async function readToday(): Promise<string[]> {
    try {
      return (await readFile(currentFile(), 'utf8')).split('\n');
    } catch {
      return [];
    }
  }

  return {
    currentFile,

    async append(record) {
      const existing = (await readToday()).filter((l) => l.trim() !== '').length;
      if (existing >= maxLines) {
        dropped += 1;
        return { written: false, reason: `今天的日志已到上限（${String(maxLines)} 条），本条未记` };
      }
      try {
        await mkdir(opts.dir, { recursive: true });
        await appendFile(currentFile(), `${formatLogLine(record)}\n`, 'utf8');
        return { written: true };
      } catch (err) {
        writeFailures += 1;
        lastError = err instanceof Error ? err.message : String(err);
        // 不抛：日志坏掉不该让一次正常启动/执行跟着死；但这条失败必须数得出（status / 界面）
        return { written: false, reason: `日志写入失败：${lastError}` };
      }
    },

    async tail(limit, minLevel) {
      const file = currentFile();
      const all: LogRecord[] = [];
      let unparsed = 0;
      for (const line of await readToday()) {
        if (line.trim() === '') continue;
        const parsed = parseLogLine(line);
        if (parsed === null) unparsed += 1;
        else all.push(parsed);
      }
      const noticeParts: string[] = [];
      if (dropped > 0) noticeParts.push(`今天已到上限，另有 ${String(dropped)} 条未记（本次运行计数）`);
      if (unparsed > 0) noticeParts.push(`${String(unparsed)} 行没读出来（含末行残缺）`);
      if (writeFailures > 0) noticeParts.push(`${String(writeFailures)} 条写失败：${lastError}`);
      const visible =
        minLevel === undefined ? all : all.filter((r) => shouldLog(r.level, minLevel));
      const capped =
        Number.isFinite(limit) && limit > 0 ? visible.slice(-Math.floor(limit)) : [];
      return {
        records: capped,
        total: all.length,
        unparsed,
        dropped,
        notice: noticeParts.join('；'),
        file,
      };
    },

    async status() {
      const lines = (await readToday()).filter((l) => l.trim() !== '').length;
      return { file: currentFile(), lines, dropped, writeFailures, lastError };
    },

    async prune(keepDays) {
      let names: string[];
      try {
        names = await readdir(opts.dir);
      } catch {
        return { removed: [] };
      }
      const allowed = keepKeys(opts.clock(), keepDays);
      const removed: string[] = [];
      for (const name of names) {
        const m = FILE_RE.exec(name);
        if (m === null) continue; // 只认自家命名的文件，别的东西一根手指都不碰
        const key = `${m[1] ?? ''}-${m[2] ?? ''}-${m[3] ?? ''}`;
        if (allowed.has(key)) continue;
        try {
          await rm(join(opts.dir, name), { force: true });
          removed.push(name);
        } catch {
          // 删不掉就留着 —— 轮转失败不是数据丢失，不需要中断任何事；下一次再试
        }
      }
      removed.sort();
      return { removed };
    },
  };
}
