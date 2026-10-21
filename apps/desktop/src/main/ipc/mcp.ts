import {
  IPC,
  mcpApprovalPlanSchema,
  mcpApproveResultSchema,
  mcpConnectResultSchema,
  mcpServerViewSchema,
  type McpApprovalPlan,
  type McpConnectResult,
} from '@jujia/shared-ipc';
import { z } from 'zod';
import { getWorkspaceInfo } from '../workspace';
import type { IpcContext } from './context';

/**
 * MCP 服务端管理（W10e）。
 *
 * 一句话口径：**不自造插件协议**，外部工具统一走 MCP；
 * 批准后的工具注册进**同一个**共享注册表（`context.ts` 里那份），
 * 所以模型看到的工具清单与权限门用的是同一份 —— 分裂成两份就会重演 W10e 的接线缺陷。
 */
export function registerMcpIpc(ctx: IpcContext): void {
  const { handle, mcp, plugins } = ctx;

  handle(IPC.MCP_SERVER_LIST, async () => {
    // 先刷新插件：新装插件的贡献要立刻出现在列表里，不能等一次对话
    const wsInfo = await getWorkspaceInfo();
    await plugins.refresh(wsInfo.valid ? wsInfo.root : null);
    return z.array(mcpServerViewSchema).parse(await mcp.views());
  });

  /**
   * 保存 / 更新服务端配置。
   *
   * **「掉线后自动重连」那一格也走这条通道**（T31 · 选项 B）：
   * 它是配置的一部分（白名单偏好），因此与命令/参数/环境变量同一套校验与落盘。
   * 两条语义：
   * - **省略 = 保持原值**（与 `env` 同语义）；真正的"默认关"写死在落盘那一侧。
   * - 改它**不**会断开连接（`launchChanged` 只看命令/参数/环境变量）。
   */
  handle(IPC.MCP_SERVER_SAVE, async (_e, input: unknown) => {
    return mcpServerViewSchema.parse(await mcp.save(input));
  });

  handle(IPC.MCP_SERVER_DELETE, async (_e, id: unknown): Promise<boolean> => {
    if (typeof id !== 'string' || id === '') throw new Error('缺少服务端 id');
    return mcp.remove(id);
  });

  handle(IPC.MCP_CONNECT, async (_e, id: unknown): Promise<McpConnectResult> => {
    if (typeof id !== 'string' || id === '') throw new Error('缺少服务端 id');
    return mcpConnectResultSchema.parse(await mcp.connect(id));
  });

  /** 审批：批准哪些工具由用户逐条勾选；拒绝即零启用（默认不放行） */
  handle(IPC.MCP_APPROVE, async (_e, payload: unknown) => {
    const { id, choice } = (payload ?? {}) as { id?: unknown; choice?: unknown };
    if (typeof id !== 'string' || id === '') throw new Error('缺少服务端 id');
    return mcpApproveResultSchema.parse(await mcp.approve(id, choice));
  });

  /** 让界面在切页签回来之后还能接着批：计划的事实本来就在主进程，这里只是把它再读一次 */
  handle(IPC.MCP_PENDING_PLAN, async (): Promise<McpApprovalPlan | null> => {
    const pending = mcp.pendingApproval();
    return pending === null ? null : mcpApprovalPlanSchema.parse(pending.plan);
  });

  handle(IPC.MCP_DISCONNECT, async (_e, id: unknown): Promise<boolean> => {
    if (typeof id !== 'string' || id === '') throw new Error('缺少服务端 id');
    return mcp.disconnect(id);
  });
}
