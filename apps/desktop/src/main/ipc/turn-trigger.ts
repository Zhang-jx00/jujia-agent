import { summarizeCatalog, type HookRunner, type ToolRegistry } from '@jujia/agent-core';
import type { AuditService } from '../audit-service';
import type { PluginsService } from '../plugins';
import type { SkillsService } from '../skills';
import { hydrateSession, sendMessage } from '../chat-service';
import { getWorkspaceInfo } from '../workspace';
import type { IpcDeps, IpcPolicy } from './context';

/**
 * 起一轮对话的**唯一入口**（M7 · R9，从 `ipc/chat.ts` 抽出来）。
 *
 * 为什么必须抽出来而不是"定时任务那边照抄一份"：这一段是**权限参数的汇聚点** ——
 * 模式、用户规则、高危清单、钩子运行器、共享注册表、技能清单、审计出口。
 * 少传一项的表现不是报错，而是"界面看起来一切正常、引擎在裸奔"（W10g 之前的死代码状态）；
 * 而两处各写一份清单，新增参数的人只会记得改其中一处 —— 正是本仓反复抓的
 * 「同一件事在两处各说各话」。用户敲字与定时到点**必须落到同一个函数上**。
 *
 * 参数继续**逐个显式列出来**，不用展开对象蒙混。
 */

export interface TurnInput {
  connectionId: string;
  text: string;
  /** 续到已有会话；不传或空串则新建 */
  sessionId?: string;
}

export interface TurnOutcome {
  sessionId: string;
  messageId: string;
  /** 历史没装回来时的实话（T6④：不许静默回落成"新建会话从零开始"） */
  warning: string | null;
}

export type TurnTrigger = (input: TurnInput) => Promise<TurnOutcome>;

/** 建一个触发器要的东西。刻意不接整个 `IpcContext`：这里只声明真用到的那九样 */
export interface TurnTriggerSource {
  deps: IpcDeps;
  fetchImpl: typeof fetch;
  mcpDebug: (message: string) => void;
  plugins: PluginsService;
  skills: SkillsService;
  registry: ToolRegistry;
  hookRunner: HookRunner;
  loadPolicy: () => Promise<IpcPolicy>;
  audit: AuditService;
}

export function createTurnTrigger(source: TurnTriggerSource): TurnTrigger {
  const { deps, fetchImpl, mcpDebug, plugins, skills, registry, hookRunner, loadPolicy, audit } = source;

  return async ({ connectionId, text, sessionId }) => {
    // 工作区决定了工具是否可用；未选择时仍可对话，但工具会被路径校验拒绝
    const ws = await getWorkspaceInfo();
    const policy = await loadPolicy();
    await plugins.refresh(ws.valid ? ws.root : null);
    const skillCatalog = await skills.refresh(ws.valid ? ws.root : null);
    mcpDebug('[plugins] ' + plugins.summary());
    mcpDebug('[skills] ' + summarizeCatalog(skillCatalog));

    // 重启后第一次发问：会话不在内存里就从磁盘装回来（6a 的"续上"就走这一步）。
    // **装不回来不能静默**（外部审查 T6④）：静默回落成"新建会话从零开始"，
    // 用户看到的是"我明明接着昨天的话聊，它怎么全忘了"，而没有任何地方说为什么。
    const sid = typeof sessionId === 'string' && sessionId !== '' ? sessionId : null;
    let warning: string | null = null;
    if (sid !== null) {
      try {
        await hydrateSession(sid, connectionId);
      } catch (err) {
        warning = `历史未能恢复，这一轮从空上下文继续（磁盘上的旧记录一字未动）。原因：${
          err instanceof Error ? err.message : String(err)
        }`;
        console.warn('[chat] 会话历史装载失败，已按"空上下文继续"处理：', err);
      }
    }

    const result = sendMessage(
      {
        connectionId,
        text,
        ...(sid !== null ? { sessionId: sid } : {}),
      },
      deps.emitStream,
      {
        fetcher: fetchImpl,
        permission: deps.permission.resolve,
        // 执行审计：判定事实交回上下文里那**唯一**的一个服务（不在这里再建一个）
        onDecision: (info) => {
          void audit.recordTool(info);
        },
        workspaceRoot: ws.valid ? ws.root : null,
        // 同一个注册表：内置工具 + 已批准的 MCP 工具都在这里，模型才看得到它们
        registry,
        mode: policy.mode,
        rules: policy.rules,
        alwaysAsk: policy.alwaysAsk,
        hooks: hookRunner,
        skillCatalogText: skills.catalogText(),
      },
    );
    return { ...result, warning };
  };
}
