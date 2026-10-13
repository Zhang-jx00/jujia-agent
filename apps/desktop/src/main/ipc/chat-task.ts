import {
  IPC,
  RESUME_USER_TEXT,
  chatTaskDismissResultSchema,
  chatTaskResumeRequestSchema,
  chatTaskResumeResultSchema,
  type ChatTaskDismissResult,
  type ChatTaskResumeResult,
} from '@jujia/shared-ipc';
import {
  connectionForSession,
  resumeReadiness,
  taskDismiss,
  taskStatusFor,
} from '../chat-service';
import type { IpcContext } from './context';

/**
 * 断点续跑的三个通道（M17 批一 · R15；自 `ipc/chat.ts` 拆出 —— 那份贴着 300 行上限，
 * 按"同一能力的通道归一个模块"的老口径切开，设计见 `docs/DESIGN-M17.md`）。
 *
 * 三条口径：
 * - **读时判定只有主进程一处**（`taskStatusFor`：还是 running 的记录 = 上次进程没走完）；
 * - **续跑从唯一入口进**（`ctx.startTurn`，多带 resumeTaskId）—— 重放到高副作用动作照样重新问；
 * - 前置校验（可续 / id 相符）在**这里**以 IPC 结果返回 —— 失败原因界面显示得出来，
 *   而不是掉进聊天流的 catch 里变成一条错误气泡。
 */
export function registerChatTaskIpc(ctx: IpcContext): void {
  const { handle, startTurn } = ctx;

  handle(IPC.CHAT_TASK_GET, async (_e, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || sessionId === '') return null;
    return taskStatusFor(sessionId);
  });

  handle(IPC.CHAT_TASK_RESUME, async (_e, payload: unknown): Promise<ChatTaskResumeResult> => {
    const fail = (error: string): ChatTaskResumeResult => ({
      ok: false,
      sessionId: null,
      messageId: null,
      warning: null,
      error,
    });
    const parsed = chatTaskResumeRequestSchema.safeParse(payload);
    if (!parsed.success) return chatTaskResumeResultSchema.parse(fail('请求形态不合法，未做任何改动'));
    const { sessionId, taskId } = parsed.data;
    const ready = await resumeReadiness(sessionId, taskId);
    if (!ready.ok) return fail(ready.error);
    const connectionId = await connectionForSession(sessionId);
    if (connectionId === null) return fail('这个会话的连接信息读不到了（磁盘上没有它）');
    try {
      const r = await startTurn({
        connectionId,
        text: RESUME_USER_TEXT,
        sessionId,
        resumeTaskId: taskId,
      });
      return { ok: true, sessionId: r.sessionId, messageId: r.messageId, warning: r.warning, error: '' };
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  handle(IPC.CHAT_TASK_DISMISS, async (_e, sessionId: unknown): Promise<ChatTaskDismissResult> => {
    if (typeof sessionId !== 'string' || sessionId === '') {
      return chatTaskDismissResultSchema.parse({ ok: false, error: '缺少会话标识' });
    }
    const r = await taskDismiss(sessionId);
    return { ok: r.ok, error: r.error ?? '' };
  });
}
