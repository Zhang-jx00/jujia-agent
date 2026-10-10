import { appendFile, copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { formatAuditLine, parseAuditLine, type AuditRecord } from '@jujia/agent-core';

/**
 * 审计落盘（M4 收尾 · 其二）。
 *
 * 三条设计口径：
 * 1. **按天一个 JSONL**：翻账按天翻是常态；也避免单个文件无限长大。
 * 2. **写不进去不抛穿业务**：审计失败不该让一次正常执行跟着死；但失败必须**数得出、看得见**
 *    （`status()` 里有 `writeFailures` / `lastError`，界面上有话）。
 * 3. **写满了不许静默丢**：到达当日上限后停止追加、开始计数，`tail()`  returned 的 `notice`
 *    会把"本次运行有 M 条没记进去"这句话带着走。
 *
 * 剔密在 `record` 之前就已做完（见 `audit/redact.ts`）：这里拿到的就是可以见人的形状，
 * 所以导出也只是**复制原文**，不做第二次加工 —— 加工点越多，越容易有一处忘了剔。
 */

export interface AuditLog {
  /** 追加一条。返回是否真的写下去了（写失败不抛，但要说） */
  append(record: AuditRecord): Promise<{ written: boolean; reason?: string }>;
  /** 今天的最近 N 条（正序） */
  tail(limit: number): Promise<AuditPage>;
  /** 把今天的账原样复制到目标路径；目标已存在则拒绝覆盖 */
  exportTo(destPath: string): Promise<{ lines: number; file: string }>;
  status(): Promise<AuditStatus>;
  /** 今天的账在哪个文件（界面要能指出"去哪儿看"） */
  currentFile(): string;
}

export interface AuditPage {
  records: AuditRecord[];
  /** 账上今天一共多少条（不受 limit 影响） */
  total: number;
  /** 读不出来的行数（残缺末行也算） */
  unparsed: number;
  /** 本次运行内因到达上限而没记下去的条数 */
  dropped: number;
  /** 必须让人看见的一句话（没有异常时为空串） */
  notice: string;
  file: string;
}

export interface AuditStatus {
  file: string;
  lines: number;
  dropped: number;
  writeFailures: number;
  lastError: string;
}

export interface AuditLogOptions {
  /** 审计目录（生产用 `getDataRoot()/audit`） */
  dir: string;
  /** 注入时钟：分日文件名要可测，也防止"未来的记录"混进账里 */
  clock: () => Date;
  maxLinesPerDay?: number;
}

const DEFAULT_MAX_LINES_PER_DAY = 5_000;

function dayKey(now: Date): string {
  // 用**本地日期**做分日：审计是给人按天翻的，UTC 会把晚上十点的操作记到"明天"
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${String(y)}-${m}-${d}`;
}

export function createAuditLog(opts: AuditLogOptions): AuditLog {
  const maxLines = opts.maxLinesPerDay ?? DEFAULT_MAX_LINES_PER_DAY;
  /** 本次运行的丢计与写失败计数（重启后归零 —— 所以界面话术必须写"本次运行"） */
  let dropped = 0;
  let writeFailures = 0;
  let lastError = '';

  const fileFor = (now: Date): string => join(opts.dir, `permissions-${dayKey(now)}.jsonl`);
  const currentFile = (): string => fileFor(opts.clock());

  async function readLines(file: string): Promise<string[]> {
    // 读不到就是"还没有账"（首次运行没有文件是常态）：返回空数组，
    // 但不把它当成"读出来是空的"—— 调用方要看的是 `status()` 里的行数与健康度
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      return [];
    }
    return text.split('\n');
  }

  async function todayRaw(): Promise<string[]> {
    return readLines(currentFile());
  }

  return {
    currentFile,

    async append(record) {
      const file = currentFile();
      const existing = await todayRaw().then((lines) => lines.filter((l) => l.trim() !== '').length);
      if (existing >= maxLines) {
        dropped += 1;
        return { written: false, reason: `今天的账已到上限（${String(maxLines)} 条），本条未记` };
      }
      try {
        await mkdir(opts.dir, { recursive: true });
        await appendFile(file, `${formatAuditLine(record)}\n`, 'utf8');
        return { written: true };
      } catch (err) {
        writeFailures += 1;
        lastError = err instanceof Error ? err.message : String(err);
        // 不抛：审计坏了不该让一次正常执行死掉；但这条失败必须数得出（见 status / 界面）
        return { written: false, reason: `审计写入失败：${lastError}` };
      }
    },

    async tail(limit) {
      const file = currentFile();
      const lines = await todayRaw();
      const records: AuditRecord[] = [];
      let unparsed = 0;
      for (const line of lines) {
        if (line.trim() === '') continue;
        const parsed = parseAuditLine(line);
        if (parsed === null) unparsed += 1;
        else records.push(parsed);
      }
      const noticeParts: string[] = [];
      if (dropped > 0) {
        noticeParts.push(`今天已到上限，另有 ${String(dropped)} 条未记（本次运行计数）`);
      }
      if (unparsed > 0) {
        noticeParts.push(`${String(unparsed)} 行没读出来（含末行残缺）`);
      }
      if (writeFailures > 0) {
        noticeParts.push(`${String(writeFailures)} 条写失败：${lastError}`);
      }
      const capped = Number.isFinite(limit) && limit > 0 ? records.slice(-Math.floor(limit)) : [];
      return {
        records: capped,
        total: records.length,
        unparsed,
        dropped,
        notice: noticeParts.join('；'),
        file,
      };
    },

    async exportTo(destPath) {
      const file = currentFile();
      if (await exists(destPath)) {
        throw new Error(`导出目标已存在，没有覆盖它：${destPath}`);
      }
      const lines = (await todayRaw()).filter((l) => l.trim() !== '');
      await copyFile(file, destPath);
      return { lines: lines.length, file: destPath };
    },

    async status() {
      const file = currentFile();
      const lines = (await todayRaw()).filter((l) => l.trim() !== '').length;
      return { file, lines, dropped, writeFailures, lastError };
    },
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
