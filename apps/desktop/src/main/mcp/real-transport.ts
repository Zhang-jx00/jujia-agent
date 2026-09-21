/**
 * 真实传输的组装（W10e）—— 把「用户配置」→「跨平台可执行命令」→「stdio 传输」串起来。
 *
 * 单独成文件是为了让 `McpService` 保持纯净：它只依赖抽象（`createTransport` 由外部注入），
 * 因此可以在纯 node 环境里被完整单测，而这一层才碰 `child_process`。
 */

import { buildServerCommand, type McpServerConfig } from '@jujia/agent-core';
import type { McpTransportHooks } from './mcp-service';
import { createStdioTransport, type StdioTransportHandle } from './stdio-transport';

export function createRealTransport(
  config: McpServerConfig,
  hooks: McpTransportHooks,
  onDebug?: (message: string) => void,
): StdioTransportHandle {
  const spec = buildServerCommand(config);
  return createStdioTransport({
    file: spec.file,
    args: spec.args,
    ...(config.env !== undefined ? { env: config.env } : {}),
    onExit: hooks.onExit,
    // 多数 MCP 服务端把日志写 stderr：归入诊断日志，绝不混进协议通道
    onStderr: (line) => onDebug?.(`[mcp:${config.id}] stderr: ${line}`),
    ...(onDebug ? { onDebug } : {}),
  });
}
