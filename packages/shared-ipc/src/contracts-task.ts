import { z } from 'zod';

/**
 * 断点续跑的 IPC 契约（M17 批一 · R15，设计 `docs/DESIGN-M17.md`）。
 *
 * 状态词表放在这里**一处**：主进程的状态机（`task-state.ts`）、渲染层的卡片、preload 的
 * 载荷校验都引它 —— 三处各写一张表就一定会漂。
 */

/** 任务状态（视图；盘上记录沿用同一张表） */
export const TASK_STATUSES = ['running', 'done', 'failed', 'aborted', 'interrupted', 'dismissed'] as const;
export const taskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatusView = z.infer<typeof taskStatusSchema>;

/**
 * 点「续跑」时**写进对话历史的那条用户消息**。单一出处：主进程发送与界面气泡
 * 都引这一个常量 —— 两处各写一句，用户看到的和模型收到的就可能不是同一句话。
 */
export const RESUME_USER_TEXT = '继续上一条被中断的任务';

/** 卡片视图：`text` 由主进程的纯函数拼好（界面只显示，不再自己组合数字与理由） */
export const chatTaskViewSchema = z
  .object({
    sessionId: z.string(),
    taskId: z.string(),
    status: taskStatusSchema,
    stepsDone: z.number().int().nonnegative(),
    runningStep: z.string().nullable(),
    /** 原始要求前 80 字（给卡片显示"续的是哪件事"） */
    instructionPreview: z.string(),
    /** 如实描述（describeInterruption 的产出；只对 interrupted 非空） */
    text: z.string(),
    resumeCount: z.number().int().nonnegative(),
  })
  .strict();
export type ChatTaskView = z.infer<typeof chatTaskViewSchema>;

export const chatTaskResumeResultSchema = z
  .object({
    ok: z.boolean(),
    /** 成功时给出会话与消息 id（界面据此落气泡与路由流事件）；失败为 null */
    sessionId: z.string().nullable(),
    messageId: z.string().nullable(),
    /** 与 chatSend 同格：能继续但有件事该知道（如历史没装回来） */
    warning: z.string().nullable(),
    error: z.string(),
  })
  .strict();
export type ChatTaskResumeResult = z.infer<typeof chatTaskResumeResultSchema>;

export const chatTaskDismissResultSchema = z
  .object({ ok: z.boolean(), error: z.string() })
  .strict();
export type ChatTaskDismissResult = z.infer<typeof chatTaskDismissResultSchema>;

/** 点「续跑」的请求形状：带 taskId —— 记录在这之间被换掉（刚发过新消息）要能当场拒 */
export const chatTaskResumeRequestSchema = z
  .object({
    sessionId: z.string().min(1).max(64),
    taskId: z.string().min(1).max(128),
  })
  .strict();
export type ChatTaskResumeRequest = z.infer<typeof chatTaskResumeRequestSchema>;
