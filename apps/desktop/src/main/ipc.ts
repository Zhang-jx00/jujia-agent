import type { IpcDeps } from './ipc/context';
import { createIpcContext } from './ipc/context';
import { registerCoreIpc } from './ipc/core';
import { registerChatIpc } from './ipc/chat';
import { registerToolIpc } from './ipc/tools';
import { registerTerminalIpc } from './ipc/terminal';
import { registerBrowserIpc } from './ipc/browser';
import { registerGitIpc } from './ipc/git';
import { registerMcpIpc } from './ipc/mcp';
import { registerExtensionIpc } from './ipc/extensions';
import { registerAuditIpc } from './ipc/audit';
import { registerPermissionRulesIpc } from './ipc/permissions';
import { registerPdfIpc } from './ipc/pdf';
import { registerCanvasIpc } from './ipc/canvas';
import { registerScheduleIpc } from './ipc/schedule';
import { registerLogsIpc } from './ipc/logs';
import { registerUpdateIpc } from './ipc/update';

export type { IpcDeps };

/**
 * 主进程 IPC 的**装配根**。
 *
 * 约定：入参与出参都必须过 zod 校验，避免契约悄悄漂移；
 * 发送方校验只在一处（ipc/handle.ts），新通道默认受保护。
 *
 * R-12 拆分：原先这里是 756 行的单文件，所有 handler 平铺在一个函数里，
 * 查一个通道要滚过无关的九个板块。现在按"通道属于哪个能力"分文件，
 * 本文件只负责**装配顺序** —— 新增能力 = 新增一个模块 + 在这里加一行。
 *
 * 为什么共享状态必须在 createIpcContext 里建、而不在各模块里各自 new：
 * 工具注册表、MCP、插件/技能、钩子运行器、权限策略**必须全进程同一份**。
 * W10e 那次接线缺陷就是注册表被新建了两份 —— 批准后的工具注册进 A 表、执行时去 B 表查，
 * 表面现象是"批准成功了但模型用不了工具"。
 *
 * 反过来，只被一个能力使用的服务（终端 / 浏览器 / git）就留在各自模块里创建与销毁，
 * 读者不用跨文件就能看清"这个服务是谁起的、什么时候收尾"。
 */
export function registerIpcHandlers(deps: IpcDeps): void {
  const ctx = createIpcContext(deps);

  registerCoreIpc(ctx);
  registerChatIpc(ctx);
  registerToolIpc(ctx);
  registerTerminalIpc(ctx);
  registerBrowserIpc(ctx);
  registerGitIpc(ctx);
  registerMcpIpc(ctx);
  registerExtensionIpc(ctx);
  registerPermissionRulesIpc(ctx);
  registerAuditIpc(ctx);
  registerPdfIpc(ctx);
  registerCanvasIpc(ctx);
  registerScheduleIpc(ctx);
  registerLogsIpc(ctx);
  registerUpdateIpc(ctx);
}
