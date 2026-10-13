import { shell } from 'electron';
import {
  IPC,
  logPageViewSchema,
  logReportInputSchema,
  logReportResultSchema,
  logRevealResultSchema,
  type LogLevelView,
} from '@jujia/shared-ipc';
import { createLogRecord, isLogLevel } from '@jujia/agent-core';
import type { IpcContext } from './context';

/**
 * 结构化日志的读取与上报（M12 批一 · R10）。
 *
 * 三条形状上的取舍：
 * - **只读 + 一个受限的上报口**：渲染层能读尾部、能在文件管理器里定位文件，
 *   唯一能"写"的是 `LOGS_REPORT` —— 只能报错误（级别固定）、形状有契约（`.strict()`）、
 *   正文再过一遍与主进程同源的剔密（`createLogRecord`）。它是一份上报，不是一支笔。
 * - **定位只"显示"不"打开"**：`showItemInFolder` 在文件管理器里选中今天的日志，
 *   不会拿默认程序打开任何文件（打开 = 启动一个进程，那是另一扇门的事）。
 * - **不算时间**：界面不筛日期，`tail` 永远读"今天"那一本 —— 与审计同口径（按天翻账）。
 */
export function registerLogsIpc(ctx: IpcContext): void {
  const { handle, logs } = ctx;

  handle(IPC.LOGS_TAIL, async (_e, payload: unknown) => {
    // 上限由渲染层给，但**界面能要多少不等于盘上有多少**：这里夹一道，store 再挡一道
    const p = (payload ?? {}) as { limit?: unknown; minLevel?: unknown };
    const limit =
      typeof p.limit === 'number' && Number.isFinite(p.limit) && p.limit > 0
        ? Math.min(Math.floor(p.limit), 500)
        : 50;
    const minLevel: LogLevelView | undefined =
      typeof p.minLevel === 'string' && isLogLevel(p.minLevel) ? p.minLevel : undefined;
    const page = await logs.tail(limit, minLevel);
    return logPageViewSchema.parse(page);
  });

  handle(IPC.LOGS_REVEAL, async () => {
    try {
      shell.showItemInFolder(logs.currentFile());
      return logRevealResultSchema.parse({ ok: true, error: '' });
    } catch (err) {
      return logRevealResultSchema.parse({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  handle(IPC.LOGS_REPORT, async (_e, payload: unknown) => {
    const parsed = logReportInputSchema.safeParse(payload);
    if (!parsed.success) {
      // 契约不过就是"什么都没记"—— 与"记了但写失败"必须分得开
      return logReportResultSchema.parse({ ok: false, reason: '载荷不符合契约，没有记录' });
    }
    const { scope, msg, detail } = parsed.data;
    const record = createLogRecord(
      detail === undefined
        ? { level: 'error', scope: `renderer:${scope}`, msg }
        : { level: 'error', scope: `renderer:${scope}`, msg, data: { detail } },
      () => new Date(),
    );
    const result = await logs.append(record);
    return logReportResultSchema.parse({ ok: result.written, reason: result.reason ?? '' });
  });
}
