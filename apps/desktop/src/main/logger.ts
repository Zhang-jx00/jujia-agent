import { createLogRecord, isLogLevel, shouldLog, type LogLevel } from '@jujia/agent-core';
import type { LogStore } from './log-store';

/**
 * 记录日志的门面（M12 批一 · R10）。
 *
 * 薄薄一层，只做两件事：**按级别门槛拦一道**（不该记的不走到落盘），
 * 以及**把记录构造锁死在 `createLogRecord` 里**（剔密发生在构造时 ——
 * 门面这里没有任何"拼一条 JSON 直接写"的余地）。
 *
 * 写盘是"发射后不管"：日志失败绝不该拖慢或打断它记录的那件事；
 * 写坏了会在 store 的 `status()` / `tail().notice` 里数得出（不是静默）。
 */

export interface Logger {
  debug(scope: string, msg: string, data?: Record<string, unknown>): void;
  info(scope: string, msg: string, data?: Record<string, unknown>): void;
  warn(scope: string, msg: string, data?: Record<string, unknown>): void;
  error(scope: string, msg: string, data?: Record<string, unknown>): void;
}

export interface LoggerOptions {
  minLevel?: LogLevel;
  clock?: () => Date;
}

/**
 * 默认门槛：`info`；排查时用环境变量 `JJ_LOG_LEVEL=debug` 打开细节。
 * **不落配置**：多一个持久开关就多一个"被改坏了没人知道"的面 ——
 * 要看细节的场合是"现在就要查"，环境变量正好是那个现场。
 */
export function resolveDefaultMinLevel(env: NodeJS.ProcessEnv): LogLevel {
  const raw = env['JJ_LOG_LEVEL'];
  return raw !== undefined && isLogLevel(raw) ? raw : 'info';
}

export function createLogger(store: LogStore, opts: LoggerOptions = {}): Logger {
  const min = opts.minLevel ?? 'info';
  const clock = opts.clock ?? ((): Date => new Date());

  const write = (
    level: LogLevel,
    scope: string,
    msg: string,
    data?: Record<string, unknown>,
  ): void => {
    if (!shouldLog(level, min)) return;
    void store.append(
      createLogRecord(data === undefined ? { level, scope, msg } : { level, scope, msg, data }, clock),
    );
  };

  return {
    debug: (scope, msg, data) => write('debug', scope, msg, data),
    info: (scope, msg, data) => write('info', scope, msg, data),
    warn: (scope, msg, data) => write('warn', scope, msg, data),
    error: (scope, msg, data) => write('error', scope, msg, data),
  };
}
