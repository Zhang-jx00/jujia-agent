import {
  IPC,
  permissionExpiredSchema,
  permissionRequestSchema,
  type PermissionDecisionPayload,
  type PermissionExpiredPayload,
  type StreamEvent,
} from '@jujia/shared-ipc';
import type {
  PermissionAnswer,
  PermissionDecision,
  PermissionRequest,
  PermissionResolver,
} from '@jujia/agent-core';

/**
 * 权限请求桥（W3）：把 agent-core 的 `PermissionResolver` 接到渲染层的审批弹窗。
 *
 * 关键设计：
 * - main 侧发出请求后**挂起等待**渲染层回填（同一个 id）；
 * - 渲染层长时间不响应 → **超时**，且超时会以 `timeout` 返回，
 *   与「用户点拒绝」在文案与语义上都不同（PLAN §6 W5 的硬要求，W3 先满足语义区分）；
 * - 窗口销毁或渲染进程崩溃 → 所有挂起请求立即以 `timeout` 收尾，
 *   绝不让工具调用无限等待（复核 001/002 的教训：不允许存在无上界的等待）。
 */

export interface PermissionBridgeDeps {
  /** 把请求推给渲染层；返回 false 表示没有可用窗口 */
  send: (channel: string, payload: unknown) => boolean;
  timeoutMs?: number;
}

/**
 * 等待用户回音的上界（默认 120 秒，可用 `JJ_PERMISSION_TIMEOUT_MS` 覆盖）。
 *
 * 为什么留这个口：这一环的语义是"等不到的时候怎么收尾"，而它**只有等到才会被验证**。
 * 没有可缩短的界，端到端就只能看着 120 秒发呆或者干脆不测 —— 不测的东西最容易腐烂。
 * 它同时也是运维参数（有人就是想把审批窗口调长/调短），不是只为测试造出来的旋钮。
 */
function defaultTimeoutMs(): number {
  const raw = process.env['JJ_PERMISSION_TIMEOUT_MS'];
  const n = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(n) && n >= 1_000 ? n : 120_000;
}

export class PermissionBridge {
  private readonly pending = new Map<
    string,
    { resolve: (a: PermissionDecision | PermissionAnswer) => void; timer: NodeJS.Timeout }
  >();

  private readonly timeoutMs: number;

  constructor(private readonly deps: PermissionBridgeDeps) {
    this.timeoutMs = deps.timeoutMs ?? defaultTimeoutMs();
  }

  /** 提供给 agent-core 的 resolver */
  readonly resolve: PermissionResolver = (req: PermissionRequest) =>
    new Promise<PermissionDecision | PermissionAnswer>((res) => {
      /**
       * T59：形状在**出门之前**判一次。
       *
       * 渲染层入口（preload）本来就拿同一张 schema 过滤，**不合的整条丢弃** ——
       * 判据只留在那一侧的后果是：弹窗不出现、桥在这里挂满 120 秒，
       * 界面说"点了没反应"而事实是"契约漂移"。同一件事两种说法，正是本仓最忌的静默失败。
       * 当场收尾按 `timeout`（**fail closed：这一步不执行**，与"没有可用窗口"同一档），
       * 并把 zod 那句原因写进告警 —— 说的必须是"形状没过契约"，不是"用户没点"。
       */
      const parsed = permissionRequestSchema.safeParse(req);
      if (!parsed.success) {
        console.warn(
          `[permission] 审批请求不合契约，未推给界面（这一步不会执行）：${req.toolName} (${req.id})` +
            ` —— ${parsed.error.issues[0]?.message ?? '字段缺失'}`,
        );
        res('timeout');
        return;
      }
      // 发**判过的那一份**：与 `expire()` 里 `payload.data` 同一个口径（一处判形状，一处发判过的）
      const sent = this.deps.send(IPC.PERMISSION_REQUEST, parsed.data);
      if (!sent) {
        res('timeout');
        return;
      }
      const timer = setTimeout(() => {
        this.pending.delete(req.id);
        console.warn(`[permission] 请求超时未响应：${req.toolName} (${req.id})`);
        // 只告诉渲染层"这一张可以关掉了"（按 id 精确通知，见 expire()）：
        // 同一时刻可能有别的请求正等着用户点，一把全关会把它们一起抹掉
        this.expire(req.id, 'timeout');
        res('timeout');
      }, this.timeoutMs);
      this.pending.set(req.id, { resolve: res, timer });
    });

  /**
   * 通知渲染层"这个 id 已在主进程侧结束"（超时 / 窗口销毁）。
   *
   * 为什么必须由主进程主动说（外部审查 T9）：弹窗是渲染层自己排队的，
   * 主进程超时按"未响应"继续走之后，那张卡还挂着 —— 用户随后点"允许"，
   * 决定落进一个已经不存在的需求里，点了等于没点，而且界面一声不响。
   */
  private expire(id: string, reason: PermissionExpiredPayload['reason']): void {
    const payload = permissionExpiredSchema.safeParse({ id, reason });
    if (!payload.success) return;
    this.deps.send(IPC.PERMISSION_EXPIRED, payload.data);
  }

  /** 渲染层回填决策（edit 时带 updatedArgs） */
  settle(id: string, decision: PermissionDecisionPayload, updatedArgs?: unknown): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.resolve(updatedArgs === undefined ? decision : { decision, updatedArgs });
    return true;
  }

  /** 窗口销毁/崩溃时调用：所有挂起请求立刻按超时收尾 */
  cancelAll(reason: string): void {
    if (this.pending.size === 0) return;
    console.warn(`[permission] ${reason}，${this.pending.size} 个待审批请求按超时处理`);
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      this.expire(id, 'window-closed');
      entry.resolve('timeout');
      this.pending.delete(id);
    }
  }

  pendingCount(): number {
    return this.pending.size;
  }
}

/** 便于 main 侧统一构造 send（窗口不存在时返回 false） */
export function makeStreamSender(
  getWindow: () => { isDestroyed: () => boolean; webContents: { send: (c: string, p: unknown) => void } } | undefined,
): (channel: string, payload: unknown) => boolean {
  return (channel, payload) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return false;
    win.webContents.send(channel, payload);
    return true;
  };
}

/** 类型占位：便于在 ipc.ts 中引用 StreamEvent（避免未使用导入被 lint 报错） */
export type StreamEventLike = StreamEvent;
