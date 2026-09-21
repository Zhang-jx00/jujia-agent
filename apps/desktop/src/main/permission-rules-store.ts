/**
 * 权限规则表的持久化（W5c / M15）。
 *
 * 与 MCP 服务端配置同样的两条设计：
 * 1. **存储以接口给出**，文件实现才碰 `electron.app`，因此校验逻辑可以被完整单测；
 * 2. 校验（glob 合法性、deny 一切的醒目警告、重复规则）在这里做，UI 与 IPC 都不重复实现。
 */

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { JsonStore } from '@jujia/shared';
import { checkRuleInput, type PermissionRule, type RuleAction } from '@jujia/agent-core';
import { getDataRoot } from './paths';

export const PERMISSION_RULES_VERSION = 1;

export interface PermissionRulesStore {
  list(): Promise<PermissionRule[]>;
  /** 新增；非法输入抛错。返回落盘后的完整记录 */
  add(input: { pattern: string; action: RuleAction; note?: string | undefined }): Promise<PermissionRule>;
  remove(id: string): Promise<boolean>;
  setEnabled(id: string, enabled: boolean): Promise<PermissionRule | null>;
}

/** 内存实现：单测用（行为与文件实现一致，校验走同一段代码） */
export function createMemoryPermissionRulesStore(
  initial: PermissionRule[] = [],
): PermissionRulesStore {
  return createStore(
    async () => [...initial],
    async (next) => {
      initial = next;
    },
  );
}

/** 文件实现：真实运行时用（原子写 + 损坏自愈） */
export function createFilePermissionRulesStore(): PermissionRulesStore {
  interface RulesFile {
    rules: PermissionRule[];
  }
  const store = new JsonStore<RulesFile>(join(getDataRoot(), 'permission-rules.json'), {
    version: PERMISSION_RULES_VERSION,
    defaults: () => ({ rules: [] }),
    validate: (input) => {
      const obj = input as RulesFile;
      if (typeof obj !== 'object' || obj === null || !Array.isArray(obj.rules)) {
        throw new Error('permission-rules.json 结构非法');
      }
      return obj;
    },
  });
  return createStore(
    async () => (await store.read()).data.rules,
    async (rules) => store.write({ rules }),
  );
}

function createStore(
  readAll: () => Promise<PermissionRule[]>,
  writeAll: (rules: PermissionRule[]) => Promise<void>,
): PermissionRulesStore {
  return {
    async list() {
      return readAll();
    },

    async add(input) {
      // 校验在这里做（两个实现共用同一段代码），UI 与 IPC 都不重复实现
      const check = checkRuleInput({ pattern: input.pattern, action: input.action, note: input.note });
      if (!check.ok) throw new Error(`规则被拒绝：${check.errors.join('；')}`);

      const rules = await readAll();
      const pattern = input.pattern.trim();
      // 同模式同动作的启用规则只允许一条：否则列表会出现"看起来生效了两条"的混乱
      const duplicate = rules.find(
        (r) => r.enabled && r.pattern === pattern && r.action === input.action,
      );
      if (duplicate) {
        throw new Error(`已存在相同的启用规则（${duplicate.pattern} → ${duplicate.action}），请直接编辑它`);
      }

      const now = new Date().toISOString();
      const record: PermissionRule = {
        id: randomUUID(),
        pattern,
        action: input.action,
        note: input.note,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      };
      await writeAll([...rules, record]);
      return record;
    },

    async remove(id) {
      const rules = await readAll();
      const next = rules.filter((r) => r.id !== id);
      if (next.length === rules.length) return false;
      await writeAll(next);
      return true;
    },

    async setEnabled(id, enabled) {
      const rules = await readAll();
      const index = rules.findIndex((r) => r.id === id);
      if (index === -1) return null;
      const current = rules[index] as PermissionRule;
      const next: PermissionRule = { ...current, enabled, updatedAt: new Date().toISOString() };
      rules[index] = next;
      await writeAll(rules);
      return next;
    },
  };
}
