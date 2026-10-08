import { app } from 'electron';
import { TERMINAL_LIMITS } from '@jujia/agent-core';
import {
  IPC,
  terminalInputSchema,
  terminalKillSchema,
  terminalResizeSchema,
  terminalStartSchema,
  terminalStatusResultSchema,
  terminalStatusSchema,
  type TerminalStatusPayload,
} from '@jujia/shared-ipc';
import { TerminalService } from '../terminal-service';
import { getWorkspaceInfo } from '../workspace';
import type { IpcContext } from './context';

/**
 * 内置终端（用户自己驱动的 PTY）。
 *
 * 与 `run_command` 的分工要分清：**终端是"人来用"，exec 工具是"模型来用"**。
 * 两者都归执行类、都每次问，但终端的工作目录被钉死在当前工作区内 ——
 * 这里刻意不接受渲染层传来的任意路径。
 *
 * `TERMINAL_STATUS` 也做同样的工作区核对：会话是按工作区归属的，把别的工作区的会话
 * 递给当前面板，接回去的就是一个 cwd 不对的终端。
 */

/** 没有可接回的会话时的答案（带上真实上限，界面才不会显示"上限 0 个"这种没意义的话） */
const noSession = (liveCount: number): TerminalStatusPayload => ({
  session: null,
  exited: null,
  liveCount,
  maxSessions: TERMINAL_LIMITS.maxSessions,
});
export function registerTerminalIpc(ctx: IpcContext): void {
  const { handle, deps } = ctx;

  const terminal = new TerminalService(
    (event) => {
      deps.getWindow?.()?.webContents.send(IPC.TERMINAL_STREAM, event);
    },
    // fail-closed：权限桥不可用时一律拒绝，绝不因为"取不到审批"就放行
    (req) => {
      const resolver = deps.permission?.resolve;
      if (!resolver) return Promise.resolve('deny' as const);
      return resolver(req);
    },
  );
  // 应用退出时杀掉所有 PTY，避免留下僵尸子进程
  app.on('before-quit', () => {
    terminal.disposeAll();
  });

  handle(IPC.TERMINAL_START, async (_e, payload: unknown): Promise<unknown> => {
    const parsed = terminalStartSchema.safeParse(payload);
    if (!parsed.success) return { ok: false, error: '终端参数不合法' };
    // 只允许在工作区内开终端：工作区不合法时直接拒绝，不静默改成别的目录
    const ws = await getWorkspaceInfo();
    if (!ws.valid) return { ok: false, error: '尚未选择工作区，无法启动终端' };
    if (parsed.data.workspaceRoot !== ws.root) {
      return { ok: false, error: '终端只能开在当前工作区内' };
    }
    return terminal.start({
      workspaceRoot: ws.root,
      ...(parsed.data.cols !== undefined ? { cols: parsed.data.cols } : {}),
      ...(parsed.data.rows !== undefined ? { rows: parsed.data.rows } : {}),
    });
  });

  handle(IPC.TERMINAL_STATUS, async (_e, payload: unknown): Promise<unknown> => {
    const parsed = terminalStatusSchema.safeParse(payload);
    if (!parsed.success) return noSession(terminal.activeCount);
    const ws = await getWorkspaceInfo();
    if (!ws.valid || parsed.data.workspaceRoot !== ws.root) return noSession(terminal.activeCount);
    // parse 而不是直接返回：主进程里的形状与契约漂了就当场抛，而不是给 UI 一个字段对不上的对象
    return terminalStatusResultSchema.parse(terminal.status(ws.root));
  });

  handle(IPC.TERMINAL_INPUT, async (_e, payload: unknown): Promise<boolean> => {
    const parsed = terminalInputSchema.safeParse(payload);
    if (!parsed.success) return false;
    return terminal.write(parsed.data.sessionId, parsed.data.data);
  });

  handle(IPC.TERMINAL_RESIZE, async (_e, payload: unknown): Promise<boolean> => {
    const parsed = terminalResizeSchema.safeParse(payload);
    if (!parsed.success) return false;
    return terminal.resize(parsed.data.sessionId, { cols: parsed.data.cols, rows: parsed.data.rows });
  });

  handle(IPC.TERMINAL_KILL, async (_e, payload: unknown): Promise<boolean> => {
    const parsed = terminalKillSchema.safeParse(payload);
    if (!parsed.success) return false;
    return terminal.kill(parsed.data.sessionId);
  });
}
