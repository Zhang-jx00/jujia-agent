/**
 * 插件服务（W11b/c）：加载插件、把它们的贡献物交给对应子系统。
 *
 * 分层与优先级（**顺序即优先级，越靠后越高**）：
 * - 用户级插件（放在数据目录的 `plugins/`）→ 归入"用户级"
 * - 工作区级插件（放在 `<工作区>/.jujia/plugins/`）→ 归入"工作区级"，可覆盖用户级同名技能
 *
 * 贡献物与去向：
 * - **技能目录** → 技能加载（用户级插件归"用户级"，工作区级插件归"工作区级"）
 * - **MCP 服务端** → MCP 列表与连接流程（W11c 起接入；照常需要连接同意与逐工具批准）
 * - **自定义命令目录** → 已识别（命令执行属后续阶段）
 */

import { join } from 'node:path';
import type { ExternalMcpServer } from './mcp/mcp-service';
import {
  loadPlugins,
  summarizePlugins,
  type PluginLoadResult,
  type SkillSource,
} from '@jujia/agent-core';
import { getDataRoot } from './paths';

/** 用户级插件目录 */
export function userPluginsDir(): string {
  return join(getDataRoot(), 'plugins');
}

/** 工作区级插件目录 */
export function workspacePluginsDir(workspaceRoot: string): string {
  return join(workspaceRoot, '.jujia', 'plugins');
}

const EMPTY: PluginLoadResult = { plugins: [], diagnostics: [], scannedDirs: [] };

export interface PluginsService {
  refresh(workspaceRoot: string | null): Promise<PluginLoadResult>;
  current(): PluginLoadResult;
  /** 供技能服务使用的来源列表（顺序即优先级） */
  skillSources(workspaceRoot: string | null): SkillSource[];
  /**
   * 插件声明的 MCP 服务端（变量已展开）。
   * 它们会出现在 MCP 列表里并走**同样的连接同意与逐工具批准** —— 插件不能自带权限。
   */
  externalServers(): ExternalMcpServer[];
  summary(): string;
}

export function createPluginsService(
  deps: { userDir?: string; workspaceDir?: (ws: string) => string; dataRoot?: string; list?: typeof loadPlugins } = {},
): PluginsService {
  const userDir = deps.userDir ?? userPluginsDir();
  const wsDir = deps.workspaceDir ?? workspacePluginsDir;
  const dataRoot = deps.dataRoot ?? join(getDataRoot(), 'plugin-data');
  const load = deps.list ?? loadPlugins;
  let latest: PluginLoadResult = EMPTY;

  return {
    async refresh(workspaceRoot) {
      const sources = [
        { path: userDir, dataRoot, projectDir: workspaceRoot ?? '' },
        ...(workspaceRoot !== null
          ? [{ path: wsDir(workspaceRoot), dataRoot, projectDir: workspaceRoot }]
          : []),
      ];
      latest = await load(sources);
      return latest;
    },

    current: () => latest,

    skillSources(workspaceRoot) {
      const out: SkillSource[] = [];
      // 先用户级插件、后工作区级插件：后者覆盖前者
      for (const isWorkspace of [false, true]) {
        for (const plugin of latest.plugins) {
          const inWorkspace = workspaceRoot !== null && plugin.dir.startsWith(workspaceRoot);
          if (inWorkspace !== isWorkspace) continue;
          for (const dir of plugin.skillsDirs) {
            out.push({ path: dir, origin: isWorkspace ? 'workspace' : 'user' });
          }
        }
      }
      return out;
    },

    externalServers(): ExternalMcpServer[] {
      const out: ExternalMcpServer[] = [];
      for (const plugin of latest.plugins) {
        for (const server of plugin.mcpServers) {
          // 稳定 id：插件名 + 服务端名。加前缀是为了和用户配置的 id 从根上区分开
          const id = 'plugin:' + plugin.name + ':' + server.name;
          out.push({
            id,
            name: server.name,
            pluginName: plugin.name,
            config: {
              id,
              name: server.name,
              command: server.config.command ?? '',
              args: [...(server.config.args ?? [])],
              env: { ...(server.config.env ?? {}) },
            },
            disabledByPlugin: server.config.enabled === false,
          });
        }
      }
      return out;
    },

    summary: () => summarizePlugins(latest),
  };
}
