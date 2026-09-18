import { IPC, type PermissionDecisionPayload, type StreamEvent } from '@jujia/shared-ipc';
import type { PermissionDecision, PermissionRequest, PermissionResolver } from '@jujia/agent-core';

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

export class PermissionBridge {
  private readonly pending = new Map<
    string,
    { resolve: (d: PermissionDecision) => void; timer: NodeJS.Timeout }
  >();

  private readonly timeoutMs: number;

  constructor(private readonly deps: PermissionBridgeDeps) {
    this.timeoutMs = deps.timeoutMs ?? 120_000;
  }

  /** 提供给 agent-core 的 resolver */
  readonly resolve: PermissionResolver = (req: PermissionRequest) =>
    new Promise<PermissionDecision>((res) => {
      const sent = this.deps.send(IPC.PERMISSION_REQUEST, req);
      if (!sent) {
        res('timeout');
        return;
      }
      const timer = setTimeout(() => {
        this.pending.delete(req.id);
        console.warn(`[permission] 请求超时未响应：${req.toolName} (${req.id})`);
        res('timeout');
      }, this.timeoutMs);
      this.pending.set(req.id, { resolve: res, timer });
    });

  /** 渲染层回填决策 */
  settle(id: string, decision: PermissionDecisionPayload): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.resolve(decision);
    return true;
  }

  /** 窗口销毁/崩溃时调用：所有挂起请求立刻按超时收尾 */
  cancelAll(reason: string): void {
    if (this.pending.size === 0) return;
    console.warn(`[permission] ${reason}，${this.pending.size} 个待审批请求按超时处理`);
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
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
