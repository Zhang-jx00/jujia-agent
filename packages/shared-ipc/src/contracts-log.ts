import { z } from 'zod';

/**
 * 结构化日志的 IPC 契约（M12 批一 · R10）。
 *
 * 从 `contracts.ts` 拆出来独立成册：那份主契约已经贴着 lint 的行数上限
 * （拆前 819 行 / 上限 800），而日志这一族（6 个 schema）形状自洽、
 * 只服务 `LOGS_*` 三条通道 —— 按"这个文件是干什么的"归到铺设计划 14。
 *
 * 与审计同缘：**落盘之前就洗过**（`createLogRecord` 是唯一构造入口），
 * 所以这条契约拿到的就是"可以见人"的形状 —— 界面读到的与磁盘上的一字不差。
 */

export const logLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
export type LogLevelView = z.infer<typeof logLevelSchema>;

export const logRecordViewSchema = z
  .object({
    ts: z.string(),
    level: logLevelSchema,
    scope: z.string(),
    msg: z.string(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type LogRecordView = z.infer<typeof logRecordViewSchema>;

export const logPageViewSchema = z
  .object({
    records: z.array(logRecordViewSchema),
    /** 今天一共多少条（解析成功的；不受条数与级别过滤影响） */
    total: z.number(),
    unparsed: z.number(),
    dropped: z.number(),
    /** 一句话的实话（上限 / 残缺末行 / 写失败）；没有异常时是空串 */
    notice: z.string(),
    file: z.string(),
  })
  .strict();
export type LogPageView = z.infer<typeof logPageViewSchema>;

export const logRevealResultSchema = z.object({ ok: z.boolean(), error: z.string() }).strict();
export type LogRevealResult = z.infer<typeof logRevealResultSchema>;

/** 渲染层唯一能"影响日志"的形状：只能报错误，级别固定，长度有界 */
export const logReportInputSchema = z
  .object({
    scope: z.string().min(1).max(64),
    msg: z.string().min(1).max(1000),
    detail: z.string().max(4000).optional(),
  })
  .strict();
export type LogReportInput = z.infer<typeof logReportInputSchema>;

export const logReportResultSchema = z.object({ ok: z.boolean(), reason: z.string() }).strict();
export type LogReportResult = z.infer<typeof logReportResultSchema>;
