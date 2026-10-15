import type { PermissionExpiredReason } from '@jujia/shared-ipc';

/**
 * 审批请求在主进程侧作废时，弹窗要说的那句话（T58 · 2026-10-15）。
 *
 * 为什么单独成模块：`PermissionDialog` 里原来写的是 `reason === 'timeout' ? A : B` ——
 * 一个三元把**所有非 timeout** 都归到"窗口已关闭"。当时契约里还躺着一个桥从不发送的
 * `cancelled`：将来谁把它补上，界面对它说的就是错的那句。
 * 穷举 `Record` 之后，契约新增成员而不补文案 = 编译不过（与 done-notice.ts 同一条纪律）。
 */
export const EXPIRED_NOTICE: Record<PermissionExpiredReason, string> = {
  timeout: '有一个审批请求在主进程等待超时，已自动关闭 —— 那一步没有执行，需要的话请重新发起',
  'window-closed': '窗口已关闭，未答复的审批请求全部作废（没有任何操作被执行）',
};

/** 取那句话说；契约之外的值返回一句诚实的兜底（宁可说得宽，不可说成另一件事） */
export function expiredNotice(reason: PermissionExpiredReason): string {
  return EXPIRED_NOTICE[reason] ?? '有一个审批请求已经失效，未做任何操作';
}
