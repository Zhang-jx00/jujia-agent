import { app } from 'electron';
import {
  IPC,
  scheduleDeleteSchema,
  scheduleEventSchema,
  scheduleListResultSchema,
  scheduleSaveSchema,
  scheduleToggleSchema,
  type ScheduleListResult,
  type ScheduleMutationResult,
  type ScheduleView,
} from '@jujia/shared-ipc';
import { decideFire, describeSkipped } from '@jujia/agent-core';
import { getDataRoot } from '../paths';
import { isRunning } from '../chat-service';
import { createFileScheduleStore, type ScheduleStore } from '../schedule-store';
import { createScheduleService, type ScheduleService } from '../schedule-service';
import type { IpcContext } from './context';

/**
 * 定时任务（M7 · R9）的通道：读清单 + 增删改 + 到点事件推送。
 *
 * 四条写在这里的判断：
 * 1. **"下一次是几点"由主进程算**（`decideFire` 那唯一一套算式）。界面再算一遍就是第二套口径，
 *    会出现"显示 09:00、实际 09:40 才跑"—— 这类不一致没人报 bug，只会让人不再信这个功能。
 * 2. **保存前过 `validateTaskInput`**（在 store 里）：规则坏了当场拒收并说明白，
 *    不留一条"存着但永远不触发"的条目。
 * 3. **到点起对话走 `ctx.startTurn`** —— 与用户敲字同一个函数，所以**同一扇权限门照常生效**。
 *    账本上也没有"免审批"这一格（store 直接把那种键拒掉）：定时不等于免审批。
 * 4. **store 与服务懒建**，模块加载期不碰 electron 路径（老规矩）；退出时把定时器撤掉。
 */

let storeRef: ScheduleStore | null = null;
function store(): ScheduleStore {
  if (storeRef === null) storeRef = createFileScheduleStore(getDataRoot());
  return storeRef;
}

let serviceRef: ScheduleService | null = null;

export function registerScheduleIpc(ctx: IpcContext): void {
  const { handle, deps, startTurn } = ctx;

  const service = (): ScheduleService => {
    if (serviceRef === null) {
      serviceRef = createScheduleService({
        store: store(),
        startTurn,
        // 用户那边正在这条会话上说话就别抢（不是失败，是还没轮到）
        isBusy: (sessionId) => isRunning(sessionId),
        events: (event) => {
          // 出口只在这一处，且**先过契约**：形状不对就丢掉并留话，不溜到界面
          const parsed = scheduleEventSchema.safeParse(event);
          if (!parsed.success) {
            console.warn('[schedule] 事件形状不合法，已丢弃：', parsed.error.message);
            return;
          }
          deps.getWindow?.()?.webContents.send(IPC.SCHEDULE_EVENT, parsed.data);
        },
      });
      serviceRef.start();
      app.on('before-quit', () => serviceRef?.stop());
    }
    return serviceRef;
  };

  /**
   * **装配即启动**：定时器不能等界面第一次打开才开始走 ——
   * 那样"每天 09:00"在没人点过这一页的整天里根本不会触发，而它看起来是配好了的。
   * 这一句跑在 `app.whenReady()` 之后的装配根里，所以 `getDataRoot()` 不在模块顶层被调（老规矩）。
   */
  service();

  handle(IPC.SCHEDULE_LIST, async (): Promise<ScheduleListResult> => {
    const tasks = await store().list();
    const health = await store().health();
    const now = new Date();
    const views: ScheduleView[] = tasks.map((task) => {
      const decision = decideFire(
        { ruleText: task.rule, anchorAt: task.anchorAt, lastRunAt: task.lastRunAt, jitterMs: task.jitterMs },
        now,
      );
      const notes: string[] = [];
      if (decision.kind === 'invalid') notes.push(decision.error);
      if (task.lastError !== '') notes.push(`上次没能跑起来：${task.lastError}`);
      if (task.lastSkipped > 0) notes.push(describeSkipped(task.lastSkipped));
      return {
        task,
        nextDueAt: decision.kind === 'invalid' ? null : decision.nextDueAt,
        note: notes.join('；'),
      };
    });
    return scheduleListResultSchema.parse({ views, health });
  });

  handle(IPC.SCHEDULE_SAVE, async (_e, payload: unknown): Promise<ScheduleMutationResult> => {
    const parsed = scheduleSaveSchema.safeParse(payload ?? {});
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? '定时任务参数不合法', tasks: await store().list() };
    }
    const res = await store().upsert(parsed.data);
    service();
    if (!res.ok) return { ok: false, error: res.error, tasks: await store().list() };
    return { ok: true, tasks: await store().list() };
  });

  const simple = async (
    run: () => Promise<{ ok: boolean; error: string }>,
  ): Promise<ScheduleMutationResult> => {
    const res = await run();
    const tasks = await store().list();
    return res.ok ? { ok: true, tasks } : { ok: false, error: res.error, tasks };
  };

  handle(IPC.SCHEDULE_TOGGLE, async (_e, payload: unknown): Promise<ScheduleMutationResult> => {
    const parsed = scheduleToggleSchema.safeParse(payload ?? {});
    if (!parsed.success) {
      return { ok: false, error: '启停需要任务标识与开关两个参数', tasks: await store().list() };
    }
    return simple(() => store().setEnabled(parsed.data.id, parsed.data.enabled));
  });

  handle(IPC.SCHEDULE_DELETE, async (_e, payload: unknown): Promise<ScheduleMutationResult> => {
    const parsed = scheduleDeleteSchema.safeParse(payload ?? {});
    if (!parsed.success) {
      return { ok: false, error: '删除需要任务标识', tasks: await store().list() };
    }
    return simple(() => store().remove(parsed.data.id));
  });
}
