import { IPC, toolRunResultSchema, type ToolRunResult } from '@jujia/shared-ipc';
import { runTool } from '@jujia/agent-core';
import { getWorkspaceInfo } from '../workspace';
import type { IpcContext } from './context';

/**
 * 手动执行工具（界面"跑一次这个工具"与 e2e 都走这里）。
 *
 * 这里是**权限门的第二条入口**（第一条是对话链路），所以必须与对话用同一份策略：
 * 模式、用户规则、高危清单、钩子运行器缺一不可 —— 少传一项就等于手动执行绕过那一层。
 * 注意它**不传 alwaysAllow 白名单**：手动执行本来就是"这一次要问一下"，
 * 会话级的"总是允许"只属于对话链路（`chat-service` 里那份）。
 */
export function registerToolIpc(ctx: IpcContext): void {
  const { handle, deps, registry, mcp, plugins, skills, hookRunner, loadPolicy } = ctx;

  handle(IPC.TOOL_RUN, async (_e, payload: unknown): Promise<ToolRunResult> => {
    const { toolName, args } = (payload ?? {}) as { toolName?: unknown; args?: unknown };
    if (typeof toolName !== 'string' || toolName === '') {
      throw new Error('缺少工具名');
    }

    const info = await getWorkspaceInfo();
    // MCP 工具操作的是外部服务，不需要工作区；内置文件工具才需要。
    // 若把工作区当成所有工具的前置条件，用户没选工作区时就完全用不了 MCP 工具。
    const isMcpTool = mcp.owns(toolName);
    if (!isMcpTool && (!info.root || !info.valid)) {
      return toolRunResultSchema.parse({
        ok: false,
        toolName,
        content: `无法执行：${info.message}。请先在「概览」页选择工作区。`,
        durationMs: 0,
        asked: false,
        decision: null,
        paths: [],
      });
    }

    const tool = registry.get(toolName);
    // 未选工作区时给一个不可能的根目录：内置工具会在路径守卫阶段被拒（fail closed）
    const workspaceRoot = info.root && info.valid ? info.root : '__no_workspace__';
    const policy = await loadPolicy();
    // 手动执行工具前也刷新一次：界面上的当前技能/插件必须与真实状态一致
    await plugins.refresh(info.root && info.valid ? info.root : null);
    await skills.refresh(info.root && info.valid ? info.root : null);
    const res = await runTool(tool, args ?? {}, { workspaceRoot }, deps.permission.resolve, {
      mode: policy.mode,
      rules: policy.rules,
      alwaysAsk: policy.alwaysAsk,
      hooks: hookRunner,
      sessionId: 'manual',
      // 手动执行与对话链路走同一个出口：两处各写一份"怎么记"，账迟早对不上
      onDecision: (info) => {
        void ctx.audit.recordTool(info);
      },
    });

    return toolRunResultSchema.parse({
      ok: res.outcome.ok,
      toolName,
      content: res.outcome.content,
      durationMs: res.durationMs,
      asked: res.asked,
      decision: res.decision ?? null,
      paths: res.outcome.evidence?.paths ?? [],
    });
  });
}
