import type { GateDecision } from '@jujia/agent-core';
import type { AuditAnswer } from '@jujia/agent-core';
import type { AuditService } from './audit-service';

/**
 * 非工具门的**统一记账出口**（R8.6 · M4 收尾·其二（下））。
 *
 * 为什么还要再抽一层：git 提交/推送、打开外部程序、改钩子配置这三扇门各自有五六条提前返回
 * （仓库没定位到、URL 不合法、自选程序不可用、策略拒、人拒、超时、自证失败、做完、做失败……）。
 * 把"记一笔"写在每条 return 之前 = 迟早漏一条 —— 铺设11 在工具侧已经用变异验证过这个结论，
 * 这里沿用同一个形状：**判定交出来，记账在 `finally`，一条判定只对应一条账**。
 *
 * 刻意**不推导**任何事实：
 * - `outcome` 直接抄 `gate.action`（判定是什么就是什么，人拒了也还是"判定为 ask"）；
 * - `asked` / `answer` 由调用方在真的弹过窗那一刻标出来（没标 = 没问过 = 账上不许出现答复）；
 * - `executed` 只看**返回值里的成没成**（"批过"与"做过"是两格，见铺设11 的 M170）；
 * - 没标 gate 就不记账 —— 还没发生过判定就失败的路径（没选工作区、URL 不合法），
 *   凭空记一条等于伪造判定，与"参数校验没过不进审计"同一条口径。
 */

export interface GateAuditMarks {
  /** 这次动作的权限判定（不标 = 判定没发生过 = 不记账） */
  gate?: GateDecision | undefined;
  /** 进门的那份参数（原样交给服务做落盘前摘要，这一层不碰内容） */
  args?: unknown;
  /** 哪一格是"这件事的可读形态"（与工具的 `commandArg` 走同一个摘要路径：剔密 + 长度上限） */
  commandKey?: string | undefined;
  /** 是否真的弹过窗 */
  asked?: boolean | undefined;
  /** 弹过窗之后的答复（没问过就不许标 —— 服务层的 `makeRecord` 会当场拒） */
  answer?: AuditAnswer | undefined;
}

/**
 * 跑一次"过门 + 做事"，并把判定事实记进账本。
 *
 * `T extends { ok: boolean }`：三个门的返回形状都带 `ok`，`executed` 直接从它取 ——
 * 不再要求调用方"记得标 executed"，也就少一格可以标错的东西。
 */
export async function auditedGateRun<T extends { ok: boolean }>(
  audit: AuditService,
  subject: string,
  run: (mark: (patch: GateAuditMarks) => void) => Promise<T>,
  sessionId: string = 'manual',
): Promise<T> {
  const started = Date.now();
  const marks: GateAuditMarks = {};
  const mark = (patch: GateAuditMarks): void => {
    Object.assign(marks, patch);
  };
  let result: T | undefined;
  try {
    result = await run(mark);
    return result;
  } finally {
    const gate = marks.gate;
    // 这里**不能 return**（会把正常结果吞成 undefined，铺设11 实测过的坑）
    if (gate !== undefined) {
      await audit.recordGate({
        subject,
        outcome: gate.action,
        asked: marks.asked === true,
        ...(marks.answer === undefined ? {} : { answer: marks.answer }),
        reason: gate.reason,
        args: marks.args ?? {},
        sessionId,
        durationMs: Date.now() - started,
        executed: result?.ok === true,
        ...(marks.commandKey === undefined ? {} : { commandKey: marks.commandKey }),
      });
    }
  }
}
