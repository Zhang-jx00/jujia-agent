/**
 * MCP 服务端配置的持久化（W10e）。
 *
 * 两条刻意的设计：
 *
 * 1. **只存服务端配置，不存批准结果。** 服务端升级后工具集合可能变化，
 *    用一份旧名单自动放行等于放行了一个你从没看过的工具 —— 因此每次连接都重新征得同意。
 *
 * 2. **存储以接口形式给出，真实实现才碰 Electron。** `getDataRoot()` 依赖 `electron.app`，
 *    在 node 环境的单测里不可用。把存储抽成 `McpStore` 之后，`McpService` 可以注入内存实现
 *    被完整单测，而配置校验（含 shell 元字符拒绝）留在服务层 —— 于是策略也能被单测覆盖。
 */

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { JsonStore } from '@jujia/shared';
import type { McpServerInput } from '@jujia/shared-ipc';
import { getDataRoot } from '../paths';

export const MCP_SERVERS_VERSION = 1;

export interface StoredMcpServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertResult {
  record: StoredMcpServer;
  created: boolean;
  /**
   * 可执行文件、参数或环境变量是否发生变化。
   *
   * 为什么要单独告诉调用方：**命令变了 = 换了一个程序**。
   * 继续沿用旧连接（旧进程、旧工具）等于让用户以为改的是 A、实际在跑 B，
   * 因此调用方必须据此**先断开旧连接**。
   */
  launchChanged: boolean;
}

export interface McpStore {
  list(): Promise<StoredMcpServer[]>;
  find(id: string): Promise<StoredMcpServer | undefined>;
  /** 入参已由服务层校验过形状；这里只负责落盘 */
  upsert(parsed: McpServerInput): Promise<UpsertResult>;
  remove(id: string): Promise<boolean>;
}

function isSameLaunch(
  a: StoredMcpServer,
  parsed: McpServerInput,
): boolean {
  if (a.command !== parsed.command) return false;
  if (JSON.stringify(a.args) !== JSON.stringify(parsed.args)) return false;
  // env 省略表示"不改动"，因此不参与比较
  if (parsed.env !== undefined && JSON.stringify(a.env) !== JSON.stringify(parsed.env)) return false;
  return true;
}

/** 文件存储（真实运行时用）。含原子写入 + 损坏自愈，见 @jujia/shared 的 JsonStore */
export function createFileMcpStore(): McpStore {
  interface McpFile {
    servers: StoredMcpServer[];
  }

  const store = new JsonStore<McpFile>(join(getDataRoot(), 'mcp-servers.json'), {
    version: MCP_SERVERS_VERSION,
    defaults: () => ({ servers: [] }),
    validate: (input) => {
      const obj = input as McpFile;
      if (typeof obj !== 'object' || obj === null || !Array.isArray(obj.servers)) {
        throw new Error('mcp-servers.json 结构非法');
      }
      return obj;
    },
  });

  const readAll = async (): Promise<StoredMcpServer[]> => (await store.read()).data.servers;
  const writeAll = async (servers: StoredMcpServer[]): Promise<void> => store.write({ servers });

  return {
    list: readAll,
    async find(id) {
      return (await readAll()).find((s) => s.id === id);
    },
    async upsert(parsed) {
      const all = await readAll();
      const now = new Date().toISOString();
      const index = parsed.id === undefined ? -1 : all.findIndex((s) => s.id === parsed.id);

      if (index === -1) {
        const record: StoredMcpServer = {
          id: parsed.id ?? randomUUID(),
          name: parsed.name,
          command: parsed.command,
          args: [...parsed.args],
          env: { ...(parsed.env ?? {}) },
          createdAt: now,
          updatedAt: now,
        };
        await writeAll([...all, record]);
        return { record, created: true, launchChanged: true };
      }

      const current = all[index] as StoredMcpServer;
      const next: StoredMcpServer = {
        ...current,
        name: parsed.name,
        command: parsed.command,
        args: [...parsed.args],
        // env 省略 = 保持原值（界面拿不到值，强制传会把值静默清空）
        env: parsed.env === undefined ? { ...current.env } : { ...parsed.env },
        updatedAt: now,
      };
      all[index] = next;
      await writeAll(all);
      return { record: next, created: false, launchChanged: !isSameLaunch(current, parsed) };
    },
    async remove(id) {
      const all = await readAll();
      const next = all.filter((s) => s.id !== id);
      if (next.length === all.length) return false;
      await writeAll(next);
      return true;
    },
  };
}

/** 内存存储：仅用于单测（与文件实现行为一致，但不需要 Electron） */
export function createMemoryMcpStore(initial: StoredMcpServer[] = []): McpStore {
  let servers = [...initial];
  let seq = 0;
  return {
    async list() {
      return [...servers];
    },
    async find(id) {
      return servers.find((s) => s.id === id);
    },
    async upsert(parsed) {
      const now = new Date().toISOString();
      const index = parsed.id === undefined ? -1 : servers.findIndex((s) => s.id === parsed.id);
      if (index === -1) {
        seq += 1;
        const record: StoredMcpServer = {
          id: parsed.id ?? `srv-${seq}`,
          name: parsed.name,
          command: parsed.command,
          args: [...parsed.args],
          env: { ...(parsed.env ?? {}) },
          createdAt: now,
          updatedAt: now,
        };
        servers = [...servers, record];
        return { record, created: true, launchChanged: true };
      }
      const current = servers[index] as StoredMcpServer;
      const next: StoredMcpServer = {
        ...current,
        name: parsed.name,
        command: parsed.command,
        args: [...parsed.args],
        env: parsed.env === undefined ? { ...current.env } : { ...parsed.env },
        updatedAt: now,
      };
      servers = servers.map((s, i) => (i === index ? next : s));
      return { record: next, created: false, launchChanged: !isSameLaunch(current, parsed) };
    },
    async remove(id) {
      const next = servers.filter((s) => s.id !== id);
      if (next.length === servers.length) return false;
      servers = next;
      return true;
    },
  };
}
