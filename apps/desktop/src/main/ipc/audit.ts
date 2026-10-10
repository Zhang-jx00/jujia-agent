import { dialog } from 'electron';
import { IPC, auditExportResultSchema, auditPageSchema } from '@jujia/shared-ipc';
import type { IpcContext } from './context';

/**
 * 执行审计的读取与导出（M4 收尾 · 其二）。
 *
 * 本模块**不判定、不加工**：账本形状与剔密都在服务里做完了，这里只做两件事 ——
 * 把今天的账原样交给界面，以及替用户选一个导出位置。
 *
 * 为什么导出要走系统"另存为"而不是直接写进工作区：审计是要给人**带走**的东西
 * （贴进工单、给朋友看），写到工作区里等于把一份可能敏感的副本塞进项目目录，
 * 还可能撞上同名文件。位置由人挑，且已存在的一律拒绝覆盖。
 */
export function registerAuditIpc(ctx: IpcContext): void {
  const { handle, deps, audit } = ctx;

  handle(IPC.AUDIT_TAIL, async (_e, payload: unknown) => {
    // 上限由渲染层给，但**界面能要多少不等于磁盘上有多少**：服务自己会夹
    const limit = typeof payload === 'number' && Number.isFinite(payload) && payload > 0 ? payload : 12;
    return auditPageSchema.parse(await audit.tail(Math.min(Math.floor(limit), 200)));
  });

  handle(IPC.AUDIT_EXPORT, async () => {
    const win = deps.getWindow?.();
    if (win === undefined) {
      return auditExportResultSchema.parse({
        ok: false,
        cancelled: true,
        error: '没有可用窗口，取消导出（什么都没写）',
      });
    }
    const today = new Date().toISOString().slice(0, 10);
    const picked = await dialog.showSaveDialog(win, {
      title: '导出执行审计',
      defaultPath: `俱佳Agent-执行审计-${today}.jsonl`,
      filters: [{ name: 'JSON Lines', extensions: ['jsonl'] }],
    });
    if (picked.canceled || picked.filePath === undefined || picked.filePath === '') {
      return auditExportResultSchema.parse({
        ok: false,
        cancelled: true,
        error: '已取消，没有写出任何文件',
      });
    }
    try {
      const result = await audit.exportTo(picked.filePath);
      return auditExportResultSchema.parse({ ok: true, lines: result.lines, file: result.file });
    } catch (err) {
      return auditExportResultSchema.parse({
        ok: false,
        cancelled: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
