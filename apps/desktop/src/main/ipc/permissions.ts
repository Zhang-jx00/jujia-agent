import {
  IPC,
  permissionRuleInputSchema,
  permissionRuleViewSchema,
  permissionRulesHealthSchema,
} from '@jujia/shared-ipc';
import { z } from 'zod';
import type { IpcContext } from './context';

/**
 * 自定义权限规则表（W5c）。
 *
 * 规则与模式的关系是这套权限设计的核心口径（`deny`/`ask` 绝对生效，连 `bypassPermissions` 也让路），
 * 判定实现全在 `agent-core/permissions`。本模块**只负责存取**：
 * 增删改查都要"不存在就报错、非法就拒绝"，不静默吞掉 —— 权限规则静默失效比没有规则更危险。
 */
export function registerPermissionRulesIpc(ctx: IpcContext): void {
  const { handle, permissionRules } = ctx;

  handle(IPC.PERMISSION_RULES_LIST, async () => {
    return z.array(permissionRuleViewSchema).parse(await permissionRules.list());
  });

  // T37 的界面一半（R23）：把"从哪一档读出来的"如实递给界面，不含糊
  handle(IPC.PERMISSION_RULES_HEALTH, async () => {
    return permissionRulesHealthSchema.parse(await permissionRules.health());
  });

  handle(IPC.PERMISSION_RULES_ADD, async (_e, input: unknown) => {
    const parsed = permissionRuleInputSchema.parse(input);
    const record = await permissionRules.add(parsed);
    return permissionRuleViewSchema.parse(record);
  });

  handle(IPC.PERMISSION_RULES_REMOVE, async (_e, id: unknown): Promise<boolean> => {
    if (typeof id !== 'string' || id === '') throw new Error('缺少规则 id');
    return permissionRules.remove(id);
  });

  handle(IPC.PERMISSION_RULES_TOGGLE, async (_e, payload: unknown) => {
    const { id, enabled } = (payload ?? {}) as { id?: unknown; enabled?: unknown };
    if (typeof id !== 'string' || id === '') throw new Error('缺少规则 id');
    if (typeof enabled !== 'boolean') throw new Error('缺少 enabled');
    const updated = await permissionRules.setEnabled(id, enabled);
    if (updated === null) throw new Error(`规则不存在: ${id}`);
    return permissionRuleViewSchema.parse(updated);
  });
}
