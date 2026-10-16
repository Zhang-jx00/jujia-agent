import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { JsonStore } from '@jujia/shared';
import {
  connectionInputSchema,
  type ApiFormat,
  type ConnectionInput,
  type ConnectionView,
} from '@jujia/shared-ipc';
import { getDataRoot } from './paths';
import { hintOf, protectSecret, revealSecret, type ProtectedSecret } from './secret';

export const CONNECTIONS_VERSION = 1;

export interface StoredConnection {
  id: string;
  name: string;
  baseUrl: string;
  apiFormat: ApiFormat;
  model: string;
  secret: ProtectedSecret | null;
  createdAt: string;
  updatedAt: string;
}

interface ConnectionsFile {
  connections: StoredConnection[];
}

const emptyFile = (): ConnectionsFile => ({ connections: [] });

let store: JsonStore<ConnectionsFile> | undefined;

function getStore(): JsonStore<ConnectionsFile> {
  store ??= new JsonStore<ConnectionsFile>(join(getDataRoot(), 'connections.json'), {
    version: CONNECTIONS_VERSION,
    defaults: emptyFile,
    validate: (input) => {
      const obj = input as ConnectionsFile;
      if (typeof obj !== 'object' || obj === null || !Array.isArray(obj.connections)) {
        throw new Error('connections.json 结构非法');
      }
      return obj;
    },
  });
  return store;
}

/** 仅用于测试：重置内部单例 */
export function __resetStore(): void {
  store = undefined;
}

async function readAll(): Promise<StoredConnection[]> {
  const { data } = await getStore().read();
  return data.connections;
}

async function writeAll(connections: StoredConnection[]): Promise<void> {
  await getStore().write({ connections });
}

/** 脱敏视图：绝不带出明文密钥 */
export function toView(c: StoredConnection): ConnectionView {
  const plain = revealSecret(c.secret);
  return {
    id: c.id,
    name: c.name,
    baseUrl: c.baseUrl,
    apiFormat: c.apiFormat,
    model: c.model,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    hasApiKey: plain !== '',
    apiKeyHint: hintOf(plain),
  };
}

export async function listConnections(): Promise<ConnectionView[]> {
  const all = await readAll();
  return all.map(toView);
}

export async function listConnectionViews(): Promise<ConnectionView[]> {
  return listConnections();
}

export async function createConnection(input: unknown): Promise<ConnectionView> {
  const parsed: ConnectionInput = connectionInputSchema.parse(input);
  if (!parsed.apiKey) {
    throw new Error('创建连接时必须提供 API Key');
  }
  const now = new Date().toISOString();
  const record: StoredConnection = {
    id: randomUUID(),
    name: parsed.name,
    baseUrl: parsed.baseUrl,
    apiFormat: parsed.apiFormat,
    model: parsed.model,
    secret: protectSecret(parsed.apiKey),
    createdAt: now,
    updatedAt: now,
  };
  const all = await readAll();
  await writeAll([...all, record]);
  return toView(record);
}

export async function updateConnection(id: string, input: unknown): Promise<ConnectionView> {
  const parsed = connectionInputSchema.partial().parse(input);
  const all = await readAll();
  const index = all.findIndex((c) => c.id === id);
  if (index === -1) throw new Error(`连接不存在: ${id}`);

  const current = all[index] as StoredConnection;
  const next: StoredConnection = {
    ...current,
    ...(parsed.name !== undefined ? { name: parsed.name } : {}),
    ...(parsed.baseUrl !== undefined ? { baseUrl: parsed.baseUrl } : {}),
    ...(parsed.apiFormat !== undefined ? { apiFormat: parsed.apiFormat } : {}),
    ...(parsed.model !== undefined ? { model: parsed.model } : {}),
    // apiKey 省略 = 不动；传空串 = 显式清空
    ...(parsed.apiKey !== undefined ? { secret: parsed.apiKey === '' ? null : protectSecret(parsed.apiKey) } : {}),
    updatedAt: new Date().toISOString(),
  };
  all[index] = next;
  await writeAll(all);
  return toView(next);
}

export async function deleteConnection(id: string): Promise<boolean> {
  const all = await readAll();
  const next = all.filter((c) => c.id !== id);
  if (next.length === all.length) return false;
  await writeAll(next);
  return true;
}

/** 仅 main 内部使用：取出可用的连接凭据（含明文密钥） */
export async function resolveConnection(
  id: string,
): Promise<{ record: StoredConnection; apiKey: string }> {
  const all = await readAll();
  const record = all.find((c) => c.id === id);
  if (!record) throw new Error(`连接不存在: ${id}`);
  const apiKey = revealSecret(record.secret);
  if (!apiKey) throw new Error('该连接没有可用的 API Key（可能已更换过系统账户或未填写）');
  return { record, apiKey };
}
