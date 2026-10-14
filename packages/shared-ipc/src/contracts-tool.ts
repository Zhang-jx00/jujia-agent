import { z } from 'zod';
import { permissionDecisionSchema } from './contracts';

/**
 * 工具执行的一对契约（手动执行那条通道，界面"跑一次这个工具"与工作区自检都走它）。
 *
 * **为什么单独一个文件**：`contracts.ts` 已经顶到 `max-lines` 的 800 行上限
 * （2026-10-14 加 T43 的入站契约时当场被拦），本仓的纪律是**拆文件、不动阈值** ——
 * 阈值一放宽，"这个文件该拆了"的信号就永远听不见了。
 *
 * 两条契约放一起是因为它们描述的本来就是同一件事的两端：进去的形态与出来的形态。
 * `permissionDecisionSchema` 仍留在 `contracts.ts`（权限审批那一族共用它，不在本文件的职责里）。
 */

/** 手动执行工具（T43 · 2026-10-14 审计清零批）：**入站**契约 —— 形状判定只在这一处，主进程不再手写 `typeof`。 */
export const toolRunSchema = z.object({
  // min(1) 沿用原 handler 抛出的那句"缺少工具名"，界面上的话不变样（T30 同一条纪律）。
  // 上限 128：与连接标识同格 —— MCP 的限定名形如 `服务端id__工具名`，128 留得开而仍是有限上界。
  toolName: z.string().min(1, '缺少工具名').max(128, '工具名过长（上限 128）'),
  // 只钉"是不是一个扁平对象"：字段含义只有工具自己知道，仍由各自的 `tool.parse` 判。
  // 以前 `args` 以 `unknown` 直接进 `runTool`，给成数组/字符串时报的是 provider 侧的 zod 原文，
  // 同一种错两处不同说法。允许省略（"这个工具不收参数"是合法调用）。
  args: z.record(z.unknown()).optional(),
});
export type ToolRunPayload = z.infer<typeof toolRunSchema>;

/** 工具执行结果（W3：直接执行形态，供工作区自检与 M2 验收使用） */
export const toolRunResultSchema = z.object({
  ok: z.boolean(),
  toolName: z.string(),
  /** 回给模型/UI 的文本 */
  content: z.string(),
  durationMs: z.number().int().nonnegative(),
  /** 是否触发了权限询问 */
  asked: z.boolean(),
  decision: permissionDecisionSchema.nullable(),
  /** 涉及的工作区内路径 */
  paths: z.array(z.string()),
});
export type ToolRunResult = z.infer<typeof toolRunResultSchema>;
