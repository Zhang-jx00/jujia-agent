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

/** 规则文件这次是从哪一档读出来的（T37：读坏了不许静默当成"没有规则"） */
export interface PermissionRulesHealth {
  source: 'primary' | 'backup' | 'default';
  recovered: boolean;
}

export interface PermissionRulesStore {
  list(): Promise<PermissionRule[]>;
  /**
   * 规则表的健康度。**先只给执行审计用**（每条账带上"当时是从哪一档读的"）；
   * 把它显示到权限页上属 T37 的剩余部分（那一半要改契约与界面，排在 R10）。
   */
  health(): Promise<PermissionRulesHealth>;
  /** 新增；非法输入抛错。返回落盘后的完整记录 */
  add(input: {
    pattern: string;
    action: RuleAction;
    note?: string | undefined;
    argPrefix?: string | undefined;
  }): Promise<PermissionRule>;
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
    async () => ({ source: 'primary' as const, recovered: false }),
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
    async () => {
      const snapshot = await store.read();
      return { source: snapshot.source, recovered: snapshot.recovered };
    },
  );
}

function createStore(
  readAll: () => Promise<PermissionRule[]>,
  writeAll: (rules: PermissionRule[]) => Promise<void>,
  readHealth: () => Promise<PermissionRulesHealth>,
): PermissionRulesStore {
  return {
    async list() {
      return readAll();
    },

    async health() {
      return readHealth();
    },

    async add(input) {
      // 校验在这里做（两个实现共用同一段代码），UI 与 IPC 都不重复实现
      const check = checkRuleInput({
        pattern: input.pattern,
        action: input.action,
        note: input.note,
        argPrefix: input.argPrefix,
      });
      if (!check.ok) throw new Error(`规则被拒绝：${check.errors.join('；')}`);

      const rules = await readAll();
      const pattern = input.pattern.trim();
      // 前缀按字面存一份规范化后的文本（匹配时还会再比一次，但列表里要看得准）
      const argPrefix = input.argPrefix?.trim();
      // 同模式同动作同前缀的启用规则只允许一条：否则列表会出现"看起来生效了两条"的混乱。
      // 前缀必须进比较键 —— 同一个工具的 `rm -rf` 与 `git push` 是两条都成立的规则，
      // 不把前缀算进去就等于一个工具只能有一条 deny，第二条会被误判成重复。
      const samePrefix = (r: PermissionRule): boolean => {
        const rp = r.argPrefix?.trim();
        if (argPrefix === undefined || argPrefix === '') return rp === undefined || rp === '';
        return rp === argPrefix;
      };
      const duplicate = rules.find(
        (r) => r.enabled && r.pattern === pattern && r.action === input.action && samePrefix(r),
      );
      if (duplicate) {
        const scope = duplicate.argPrefix ? `（前缀 ${duplicate.argPrefix}）` : '';
        throw new Error(`已存在相同的启用规则（${duplicate.pattern}${scope} → ${duplicate.action}），请直接编辑它`);
      }

      const now = new Date().toISOString();
      const record: PermissionRule = {
        id: randomUUID(),
        pattern,
        action: input.action,
        note: input.note,
        ...(argPrefix === undefined || argPrefix === '' ? {} : { argPrefix }),
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
