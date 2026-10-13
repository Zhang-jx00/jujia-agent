/**
 * 结构化日志的**纯规则层**（M12 批一 · R10）。
 *
 * 日志是第二个磁盘位置：同一份密钥既在它该在的地方、又被抄进日志，
 * 就凭空多了一处泄露面。所以口径与执行审计**同源**（复核 063 定下的那条）：
 * **剔密发生在记录诞生时** —— 调用方拿到的 `LogRecord` 就是"可以见人"的形状，
 * 落盘、读回、显示都只是搬运，没有任何一处需要"记得再洗一次"。
 *
 * 判据**共用已有那两张表**（终端环境的 `isSensitiveEnvName`、审计的 `maskSecrets`），
 * 不在这里另立一套 —— 两处各写一张表，迟早一边多一个词、另一边漏一个词。
 *
 * 收敛（截断 / 深度上限 / 数组上限）全部**写明原因**：日志最怕的不是截断，
 * 是截了之后看不出来截过（"为什么这次只有半行"从此无从查起）。
 */

import { isSensitiveEnvName } from '../terminal/terminal';
import { maskSecrets } from '../audit/redact';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 由低到高的级别表（显示与过滤都从这里取，别处不许再排一份） */
export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function isLogLevel(value: string): value is LogLevel {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error';
}

/** 这条要不要记：级别不低于门槛 */
export function shouldLog(level: LogLevel, minLevel: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
}

export interface LogRecord {
  /** ISO 时间（由注入的时钟给出，"未来的记录"进不了文件） */
  ts: string;
  level: LogLevel;
  /** 哪个子系统（boot / chat / mcp / schedule / renderer …），界面按它分组找线索 */
  scope: string;
  msg: string;
  data?: Record<string, unknown>;
}

export interface LogInput {
  level: LogLevel;
  scope: string;
  msg: string;
  data?: Record<string, unknown> | undefined;
}

const MSG_MAX = 2_000;
const DATA_STRING_MAX = 1_000;
const DEPTH_MAX = 4;
const ARRAY_MAX = 20;
const KEY_MAX = 30;

function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…（已截断，原文 ${String(text.length)} 字符）`;
}

/**
 * 深度收敛 + 剔密，一趟走完。返回的一定是可以直接 `JSON.stringify` 的形状：
 * 不认识的类型（函数 / symbol / bigint）收敛成占位串，环标 `[循环引用]`，
 * 键名像密钥的**连值都不看**（与审计同口径：位数本身也是信息）。
 */
function sanitizeValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return capText(maskSecrets(value).text, DATA_STRING_MAX);
  if (typeof value !== 'object') return '[不可记]';
  if (seen.has(value)) return '[循环引用]';
  if (depth >= DEPTH_MAX) return '[深度超限]';
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const head = value.slice(0, ARRAY_MAX).map((v) => sanitizeValue(v, depth + 1, seen));
      if (value.length > ARRAY_MAX) {
        head.push(`…（共 ${String(value.length)} 项，只记前 ${String(ARRAY_MAX)}）`);
      }
      return head;
    }
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const key of Object.keys(src)) {
      if (n >= KEY_MAX) {
        out['…'] = `（键超过 ${String(KEY_MAX)} 个，其余不记）`;
        break;
      }
      n += 1;
      const v = src[key];
      if (v === undefined) continue;
      out[key] = isSensitiveEnvName(key) ? '***' : sanitizeValue(v, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

/** 造一条已经洗过的记录。**唯一**的构造入口 —— 别处不许手拼 `LogRecord` */
export function createLogRecord(input: LogInput, clock: () => Date): LogRecord {
  const record: LogRecord = {
    ts: clock().toISOString(),
    level: input.level,
    scope: input.scope,
    msg: capText(maskSecrets(input.msg).text, MSG_MAX),
  };
  if (input.data !== undefined) {
    const data = sanitizeValue(input.data, 0, new WeakSet());
    if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
      record.data = data as Record<string, unknown>;
    }
  }
  return record;
}

/** 一行一条 JSON（JSONL 与审计同格式；读回来的是同一套字段） */
export function formatLogLine(record: LogRecord): string {
  return JSON.stringify(record);
}

/** 坏行一律 null，不抛 —— 残缺末行是常态，不该作废整本 */
export function parseLogLine(line: string): LogRecord | null {
  if (line.trim() === '') return null;
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const { ts, level, scope, msg } = obj;
  if (typeof ts !== 'string' || typeof scope !== 'string' || typeof msg !== 'string') return null;
  if (typeof level !== 'string' || !isLogLevel(level)) return null;
  const out: LogRecord = { ts, level, scope, msg };
  if (obj['data'] !== undefined) out.data = obj['data'] as Record<string, unknown>;
  return out;
}
