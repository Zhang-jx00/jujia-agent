/**
 * 钩子配置的持有者（W5d）。
 *
 * 与权限规则表同样的两条设计：
 * 1. 落盘用 `JsonStore`（原子写 + 损坏自愈），文件独立成 `hooks.json`；
 * 2. **保存时立刻更新内存副本**，运行器每次取配置都读到最新值 ——
 *    用户改完钩子必须立刻生效，缓存过期会让"我明明删了它还在跑"变成灵异事件。
 *
 * 与 MCP / 规则表的差别：钩子配置是**嵌套结构**（事件 → matcher 组 → 钩子列表），
 * 因此界面以 JSON 为准（见 HooksPanel），本模块负责校验与落盘。
 */

import { join } from 'node:path';
import { JsonStore } from '@jujia/shared';
import { emptyHookConfig, parseHookConfig, type HookConfig } from '@jujia/agent-core';
import { getDataRoot } from './paths';

export const HOOKS_VERSION = 1;

export interface HooksSaveOutcome {
  ok: boolean;
  errors: string[];
  config: HookConfig;
}

export interface HooksService {
  /** 启动时读一次；损坏时回落默认（关闭）并记诊断 */
  load(): Promise<void>;
  /** 同步取当前配置：运行器在每次事件里调用，不能是异步 */
  getConfig(): HookConfig;
  /** 当前配置的原始 JSON（给界面编辑用） */
  raw(): Record<string, unknown>;
  /** 保存：校验失败则**不落盘**，并把错误逐条返回 */
  save(input: unknown): Promise<HooksSaveOutcome>;
  /** 配置文件绝对路径（界面上告诉用户"文件在哪"） */
  filePath(): string;
}

export function createFileHooksService(): HooksService {
  interface HooksFile {
    hooks: Record<string, unknown>;
  }
  const path = join(getDataRoot(), 'hooks.json');
  const store = new JsonStore<HooksFile>(path, {
    version: HOOKS_VERSION,
    defaults: () => ({ hooks: {} as Record<string, unknown> }),
    validate: (input) => {
      const obj = input as HooksFile;
      if (typeof obj !== 'object' || obj === null || typeof obj.hooks !== 'object' || obj.hooks === null) {
        throw new Error('hooks.json 结构非法：应有 hooks 对象');
      }
      return obj;
    },
  });

  let current: HookConfig = emptyHookConfig();
  let currentRaw: Record<string, unknown> = {};

  return {
    async load() {
      try {
        const data = (await store.read()).data;
        const check = parseHookConfig(data.hooks);
        if (check.ok && check.config !== null) {
          current = check.config;
          currentRaw = data.hooks;
        } else {
          // 配置写坏时**不静默**：回落"关闭"并保留原文，界面会把错误显示出来
          current = emptyHookConfig();
          currentRaw = data.hooks;
        }
      } catch {
        current = emptyHookConfig();
        currentRaw = {};
      }
    },

    getConfig() {
      return current;
    },

    raw() {
      return currentRaw;
    },

    async save(input) {
      const check = parseHookConfig(input);
      if (!check.ok || check.config === null) {
        return { ok: false, errors: check.errors, config: current };
      }
      const normalized = input as Record<string, unknown>;
      await store.write({ hooks: normalized });
      current = check.config;
      currentRaw = normalized;
      return { ok: true, errors: [], config: current };
    },

    filePath() {
      return path;
    },
  };
}

/** 内存实现：单测与无 electron 环境用（行为与文件实现一致，校验同一段代码） */
export function createMemoryHooksService(initial: Record<string, unknown> = {}): HooksService {
  let currentRaw: Record<string, unknown> = initial;
  let current: HookConfig = emptyHookConfig();
  const refresh = (): void => {
    const check = parseHookConfig(currentRaw);
    current = check.ok && check.config !== null ? check.config : emptyHookConfig();
  };
  refresh();
  return {
    load: async (): Promise<void> => {
      refresh();
    },
    getConfig: (): HookConfig => current,
    raw: (): Record<string, unknown> => currentRaw,
    save: async (input: unknown): Promise<HooksSaveOutcome> => {
      const check = parseHookConfig(input);
      if (!check.ok || check.config === null) return { ok: false, errors: check.errors, config: current };
      currentRaw = input as Record<string, unknown>;
      refresh();
      return { ok: true, errors: [], config: current };
    },
    filePath: (): string => '(memory)',
  };
}
