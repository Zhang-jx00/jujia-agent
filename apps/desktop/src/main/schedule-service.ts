import { SCHEDULE_TICK_MS } from '@jujia/shared-ipc';
import { decideFire, describeSkipped } from '@jujia/agent-core';
import type { ScheduleStore } from './schedule-store';
import type { TurnTrigger } from './ipc/turn-trigger';

/**
 * 定时任务的发动机（M7 · R9）。
 *
 * 这一层只做三件事：**问纯算式该不该跑 → 起一轮对话 → 把结果落账**。它自己不做任何时间算术
 * （那是 `agent-core/schedule` 的活），也不自己起第二条对话路（`startTurn` 与用户敲字是同一个函数，
 * 所以到点这一路**照样过同一扇权限门** —— 定时不等于免审批，这一层没有第二套触发路径）。
 *
 * 四条从既有轮次抄来的规矩：
 * 1. **一次只跑一条**：一个 tick 里两条任务都到点就排队。同时起两轮模型调用，
 *    只会让两条都变慢、还让审批弹窗叠在一起。
 * 2. **到点尝试一次，失败不原地重试**：失败也推进水位线并把原因落在账上。
 *    不推进的话，一条坏了的任务每 30 秒重试一次 = 刷屏；推进并记下原因 = 看得见的一次失败
 *    （与权限超时那句「请勿自动重试」同口径）。
 * 3. **"忙"不是失败**：上一轮还挂着、或这条任务的会话正被用户用着 → 本 tick 不起新的，
 *    也**不推进**水位线（那一次还没跑，下个 tick 照旧算欠账）。
 * 4. **定时器必须有唯一的收口**：`start()` 重复调用不加第二个定时器，`stop()` 真的撤句柄；
 *    调度器可注入，测试不需要真等 30 秒。
 */

export type ScheduleEventKind = 'fired' | 'failed' | 'invalid-rule';

export interface ScheduleEvent {
  taskId: string;
  name: string;
  kind: ScheduleEventKind;
  /** 给人看的一句话（含"跳过 N 次"），不是正文 */
  note: string;
  /** 这次动作发生的真实时刻（与 `dueAt` 那个"日历上的那一次"是两件事） */
  at: string;
}

export interface ScheduleServiceDeps {
  store: ScheduleStore;
  /** 与用户敲字同一个入口 */
  startTurn: TurnTrigger;
  /** 这条会话此刻是不是正在被用（用户那边在跑就别抢） */
  isBusy: (sessionId: string) => boolean;
  /** 推给渲染层（面板据此重读清单） */
  events: (event: ScheduleEvent) => void;
  /** 可注入的时钟与调度器：测试不需要假等 30 秒 */
  now?: () => Date;
  schedule?: (fire: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
  tickMs?: number;
}

export interface ScheduleService {
  start(): void;
  stop(): void;
  /** 看一眼有没有到点的任务（`start()` 里也会立刻跑一次，开机补跑不该等一个完整 tick） */
  tickOnce(): Promise<void>;
}

/** 测试缩短这一口的理由与 `JJ_PERMISSION_TIMEOUT_MS` 一样：缩短不了就没人测得到 */
function defaultTickMs(): number {
  const raw = process.env['JJ_SCHEDULE_TICK_MS'];
  if (raw === undefined) return SCHEDULE_TICK_MS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1_000) return SCHEDULE_TICK_MS;
  return n;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createScheduleService(deps: ScheduleServiceDeps): ScheduleService {
  const now = deps.now ?? (() => new Date());
  const tickMs = deps.tickMs ?? defaultTickMs();
  const schedule = deps.schedule ?? ((fire, ms) => setInterval(fire, ms));
  const cancel = deps.cancel ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));

  let handle: unknown = undefined;
  /** 本服务自己那一轮在不在跑（与 `isBusy` 管的用户会话是两件事） */
  let running = false;
  /** 坏规则只报第一次：同一个 `id` 每 30 秒刷屏是噪声，不是信息 */
  const reportedInvalid = new Set<string>();

  const tickOnce = async (): Promise<void> => {
    if (running) return;
    const tasks = await deps.store.list();
    if (tasks.length === 0) return;
    running = true;
    try {
      for (const task of tasks) {
        if (!task.enabled) continue;
        const decision = decideFire(
          { ruleText: task.rule, anchorAt: task.anchorAt, lastRunAt: task.lastRunAt, jitterMs: task.jitterMs },
          now(),
        );
        if (decision.kind === 'invalid') {
          if (!reportedInvalid.has(task.id)) {
            reportedInvalid.add(task.id);
            deps.events({ taskId: task.id, name: task.name, kind: 'invalid-rule', note: decision.error, at: now().toISOString() });
          }
          continue;
        }
        reportedInvalid.delete(task.id);
        if (decision.kind !== 'fire') continue;
        // 「忙」不是失败：不起新的、也不动水位线 —— 那一次确实还没跑
        if (task.sessionId !== null && deps.isBusy(task.sessionId)) continue;

        const at = now().toISOString();
        try {
          const outcome = await deps.startTurn({
            connectionId: task.connectionId,
            text: task.prompt,
            ...(task.sessionId !== null ? { sessionId: task.sessionId } : {}),
          });
          await deps.store.markRun(task.id, {
            at: decision.dueAt,
            skipped: decision.skippedBefore,
            sessionId: outcome.sessionId,
            // 历史没装回来那句实话要留在账上（T6④ 同口径），但别把它当失败
            error: outcome.warning ?? '',
          });
          deps.events({
            taskId: task.id,
            name: task.name,
            kind: 'fired',
            note: describeSkipped(decision.skippedBefore) === '' ? '到点已触发' : describeSkipped(decision.skippedBefore),
            at,
          });
        } catch (err) {
          const reason = messageOf(err);
          // 失败也推进水位线：一次到点只试一次，不原地重试
          await deps.store.markRun(task.id, { at: decision.dueAt, skipped: decision.skippedBefore, error: reason });
          deps.events({ taskId: task.id, name: task.name, kind: 'failed', note: reason, at });
        }
      }
    } finally {
      running = false;
    }
  };

  return {
    start(): void {
      if (handle !== undefined) return; // 重复 start 不加第二个定时器
      handle = schedule(() => {
        void tickOnce();
      }, tickMs);
      void tickOnce();
    },
    stop(): void {
      if (handle === undefined) return;
      cancel(handle);
      handle = undefined;
    },
    tickOnce,
  };
}
