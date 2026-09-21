/**
 * MCP（Model Context Protocol）宿主适配层 —— 纯逻辑部分（W10a）。
 *
 * 这里**不碰子进程、不碰网络**，只做可单测的三件事：
 * 1. **JSON-RPC 2.0 报文**的构造与解析（`initialize` / `tools/list` / `tools/call`）；
 * 2. **启动命令的跨平台适配** —— Windows 上 `npx` 实际是 `npx.cmd`，
 *    直接 spawn 会失败，必须走 `cmd /c`（本项目在 Windows 上实测过的坑）；
 * 3. **MCP 工具的权限分级推断** —— 这是**安全关键**：
 *    MCP 工具来自**第三方**，能力未知。默认一律按**最严格**的 `exec` 处理（每次都问），
 *    只有当服务端在注解里**明确声明只读**时才降级为 `read`。
 *    **绝不因为"看起来像读操作"就放行。**
 *
 * 设计依据（与项目既有原则一致）：
 * - 权限判定用**确定性规则**，不交给模型（见 `docs/PRODUCT-GOAL.md`）；
 * - 外部来源的能力必须**用户明确同意**才接入（连接同意 UI 在 W10b）。
 */

/**
 * 工具分级**复用工具层的定义**（单一来源，避免两处 `ToolKind` 各自漂移）。
 * 之前这里漏了复用、自己又声明了一遍，导致包根出现同名重复导出（typecheck 报 TS2308）。
 */
import type { ToolKind } from '../tools/types';

export type { ToolKind };

/** JSON-RPC 2.0 报文 */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: number;
  result: unknown;
}

export interface JsonRpcError {
  jsonrpc: '2.0';
  id: number;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

/** MCP 协议版本：以服务端回包为准，这里作为我们发起时声明的版本 */
export const MCP_PROTOCOL_VERSION = '2025-06-18';

/** 服务端配置（用户填入；持久化在配置里） */
export interface McpServerConfig {
  /** 用户可读的标识 */
  id: string;
  /** 展示名 */
  name: string;
  /** 启动命令，如 `npx` */
  command: string;
  /** 参数，如 `['-y', '@modelcontextprotocol/server-filesystem', 'D:\\ws']` */
  args: string[];
  /** 额外环境变量（**不要放密钥**；密钥走独立的凭据存储） */
  env?: Record<string, string>;
}

export interface CommandSpec {
  file: string;
  args: string[];
}

/**
 * 把服务端配置映射成可 spawn 的命令。
 *
 * **Windows 关键适配**：`npx` / `npm` / `yarn` 在 Windows 上是 `.cmd` 批处理，
 * `child_process.spawn` 直接调用会报 `ENOENT`。正确做法是经 `cmd.exe /c` 执行。
 * 这是本项目在 Windows 上的实测结论，不是推测。
 *
 * 非 Windows 平台原样返回。**不做 shell 拼接**：args 以数组传递，杜绝注入。
 */
export function buildServerCommand(
  config: McpServerConfig,
  platform: NodeJS.Platform = process.platform,
): CommandSpec {
  const isWin = platform === 'win32';
  if (!isWin) return { file: config.command, args: [...config.args] };

  // Windows：批处理包装器需要 cmd /c
  const needsCmd = /\.(cmd|bat)$/i.test(config.command) || /^(npx|npm|yarn|pnpm)$/i.test(config.command);
  if (!needsCmd) return { file: config.command, args: [...config.args] };
  return { file: 'cmd.exe', args: ['/c', config.command, ...config.args] };
}

/** 服务端配置校验结果 */
export interface ConfigCheck {
  ok: boolean;
  errors: string[];
}

/**
 * 校验服务端配置。
 * 拒绝项：空命令、含 shell 元字符的命令、参数里出现明显的管道/重定向
 * （我们已用数组传参，但仍拒绝可疑串，防止有人把 shell 语法写进 args 再被 `cmd /c` 执行）。
 */
export function validateServerConfig(input: unknown): ConfigCheck {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null) return { ok: false, errors: ['配置必须是对象'] };
  const c = input as Record<string, unknown>;

  for (const k of ['id', 'name', 'command']) {
    if (typeof c[k] !== 'string' || (c[k] as string).trim() === '') errors.push(`${k} 必须是非空字符串`);
  }
  if (!Array.isArray(c['args']) || (c['args'] as unknown[]).some((a) => typeof a !== 'string')) {
    errors.push('args 必须是字符串数组');
  }

  const danger = /[|&;<>`$]|\r|\n/;
  if (typeof c['command'] === 'string' && danger.test(c['command'])) {
    errors.push('command 含 shell 元字符，已拒绝（防止命令注入）');
  }
  if (Array.isArray(c['args'])) {
    for (const a of c['args'] as unknown[]) {
      if (typeof a === 'string' && danger.test(a)) {
        errors.push(`args 含 shell 元字符，已拒绝：${a.slice(0, 40)}`);
      }
    }
  }
  if (c['env'] !== undefined) {
    if (typeof c['env'] !== 'object' || c['env'] === null || Array.isArray(c['env'])) {
      errors.push('env 必须是对象');
    }
  }
  return { ok: errors.length === 0, errors };
}

/* ------------------------------------------------------------------ *
 * JSON-RPC 报文
 * ------------------------------------------------------------------ */

export function buildRequest(id: number, method: string, params?: unknown): JsonRpcRequest {
  return params === undefined
    ? { jsonrpc: '2.0', id, method }
    : { jsonrpc: '2.0', id, method, params };
}

/** `initialize` 请求：声明客户端信息与协议版本 */
export function buildInitialize(id: number, clientName = 'jujia-agent', clientVersion = '0.1.0'): JsonRpcRequest {
  return buildRequest(id, 'initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: { tools: {} },
    clientInfo: { name: clientName, version: clientVersion },
  });
}

export function buildToolsList(id: number): JsonRpcRequest {
  return buildRequest(id, 'tools/list', {});
}

export function buildToolsCall(
  id: number,
  name: string,
  args: Record<string, unknown>,
): JsonRpcRequest {
  return buildRequest(id, 'tools/call', { name, arguments: args });
}

export type ParseResult =
  | { type: 'response'; value: JsonRpcResponse }
  | { type: 'invalid'; reason: string };

/**
 * 解析一行 JSON-RPC 报文。
 *
 * 严格之处：**必须**是 `jsonrpc: '2.0'` 且有数字 `id` 或 `method`（通知）。
 * 外部进程可能吐出各种东西（日志、调试输出、半截 JSON），
 * 因此这里**不抛异常**，而是返回 `invalid` 让上层决定如何处理（通常记日志并跳过）。
 */
export function parseMessage(line: string): ParseResult {
  const text = line.trim();
  if (text === '') return { type: 'invalid', reason: '空行' };
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return { type: 'invalid', reason: '不是合法 JSON' };
  }
  // 注意：数组也是 object，必须显式排除，否则 [1,2,3] 会被当成合法对象继续往下走
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return { type: 'invalid', reason: '不是对象' };
  }
  const o = obj as Record<string, unknown>;
  if (o['jsonrpc'] !== '2.0') return { type: 'invalid', reason: '缺少 jsonrpc: 2.0' };
  const hasId = typeof o['id'] === 'number';
  const hasMethod = typeof o['method'] === 'string';
  if (!hasId && !hasMethod) return { type: 'invalid', reason: '既无数字 id 也无 method' };
  if (!hasMethod) {
    if ('error' in o) {
      const e = o['error'] as Record<string, unknown>;
      return {
        type: 'response',
        value: {
          jsonrpc: '2.0',
          id: o['id'] as number,
          error: {
            code: typeof e['code'] === 'number' ? e['code'] : -1,
            message: typeof e['message'] === 'string' ? e['message'] : '未知错误',
          },
        },
      };
    }
    return { type: 'response', value: { jsonrpc: '2.0', id: o['id'] as number, result: o['result'] } };
  }
  return { type: 'invalid', reason: '服务端发来的请求暂不支持（本宿主只消费响应）' };
}

/* ------------------------------------------------------------------ *
 * 工具发现与权限分级（安全关键）
 * ------------------------------------------------------------------ */

/** MCP 工具注解（服务端可选提供） */
export interface McpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: McpToolAnnotations;
}

/** 我们内部的工具档案（与 agent-core 的工具层解耦，便于单测） */
export interface McpToolProfile {
  /** 加上服务端前缀，避免不同服务端的同名工具互相覆盖 */
  qualifiedName: string;
  serverId: string;
  rawName: string;
  kind: ToolKind;
  description: string;
  inputSchema: unknown;
  /** 分级依据，便于 UI 向用户解释"为什么这个工具每次都要问" */
  kindReason: string;
}

/**
 * 从 `tools/list` 的返回里取出工具描述。
 * 外部数据形形色色，这里**只做防御性解析**：拿不到必要字段就跳过该项，绝不让一条脏数据毁掉整个列表。
 */
export function parseToolList(result: unknown): McpToolDescriptor[] {
  const list = (result as { tools?: unknown } | null)?.tools;
  if (!Array.isArray(list)) return [];
  const out: McpToolDescriptor[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const t = item as Record<string, unknown>;
    if (typeof t['name'] !== 'string' || t['name'].trim() === '') continue;
    const desc: McpToolDescriptor = { name: t['name'] };
    if (typeof t['description'] === 'string') desc.description = t['description'];
    if (t['inputSchema'] !== undefined) desc.inputSchema = t['inputSchema'];
    const ann = t['annotations'];
    if (typeof ann === 'object' && ann !== null) {
      const a = ann as Record<string, unknown>;
      desc.annotations = {
        ...(typeof a['readOnlyHint'] === 'boolean' ? { readOnlyHint: a['readOnlyHint'] } : {}),
        ...(typeof a['destructiveHint'] === 'boolean' ? { destructiveHint: a['destructiveHint'] } : {}),
        ...(typeof a['idempotentHint'] === 'boolean' ? { idempotentHint: a['idempotentHint'] } : {}),
        ...(typeof a['openWorldHint'] === 'boolean' ? { openWorldHint: a['openWorldHint'] } : {}),
      };
    }
    out.push(desc);
  }
  return out;
}

/**
 * **权限分级推断**（安全关键，务必按此实现）。
 *
 * 规则（确定性、可测、不交给模型）：
 * 1. **默认 `exec`** —— MCP 工具来自第三方，行为未知，一律按最严格处理（每次都问）；
 * 2. 仅当服务端**明确**声明 `readOnlyHint: true` **且**未声明 `destructiveHint: true` 时，降为 `read`；
 * 3. 若声明了 `destructiveHint: true` —— 保持 `exec`，并在理由里标明"服务端自述具破坏性"；
 * 4. 注解缺失、类型不对、自相矛盾（同时 readOnly 与 destructive）→ **一律 `exec`**。
 */
export function inferToolKind(descriptor: McpToolDescriptor): { kind: ToolKind; reason: string } {
  const a = descriptor.annotations;
  if (!a) return { kind: 'exec', reason: '服务端未提供注解 → 默认按最严格处理' };

  if (a.readOnlyHint === true && a.destructiveHint === true) {
    return { kind: 'exec', reason: '注解自相矛盾（只读 + 破坏性）→ 取更严格的一侧' };
  }
  if (a.destructiveHint === true) {
    return { kind: 'exec', reason: '服务端自述具破坏性' };
  }
  if (a.readOnlyHint === true) {
    return { kind: 'read', reason: '服务端明确声明只读' };
  }
  return { kind: 'exec', reason: '注解未声明只读 → 默认按最严格处理' };
}

/** 把服务端工具列表转成我们内部的工具档案（含前缀与分级理由） */
export function toToolProfiles(
  serverId: string,
  descriptors: readonly McpToolDescriptor[],
): McpToolProfile[] {
  return descriptors.map((d) => {
    const { kind, reason } = inferToolKind(d);
    return {
      qualifiedName: `${serverId}__${d.name}`,
      serverId,
      rawName: d.name,
      kind,
      description: d.description ?? `（${serverId} 提供的工具，无描述）`,
      inputSchema: d.inputSchema ?? { type: 'object', properties: {} },
      kindReason: reason,
    };
  });
}
