import { z } from 'zod';

/**
 * 更新检查的 IPC 契约（M12 批二 · R11）。
 *
 * 无依赖最小形态的形状：**查一次、说一句、指条路**。
 * `hasUpdate` 只在"确实更新"时为 true；查不到（404 / 网络断 / 超时 / 版本号读不懂）
 * 一律 `ok:false` + `error` 一句话 —— 它与"已是最新"必须是两种不同的显示。
 */

export const updateCheckResultSchema = z
  .object({
    ok: z.boolean(),
    current: z.string(),
    /** 查到的最新 tag（查不到为空串） */
    latest: z.string(),
    hasUpdate: z.boolean(),
    /** 发布页地址（交给人自己去看） */
    url: z.string(),
    /** 给人读的一句话（ok 时为空串） */
    error: z.string(),
  })
  .strict();
export type UpdateCheckResultView = z.infer<typeof updateCheckResultSchema>;
