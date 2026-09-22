/**
 * 插件服务（W11b）：加载插件、把它们的贡献物交给对应子系统。
 *
 * 分层与优先级（**顺序即优先级，越靠后越高**）：
 * - 用户级插件（放在数据目录的 `plugins/`）→ 归入"用户级"
 * - 工作区级插件（放在 `<工作区>/.jujia/plugins/`）→ 归入"工作区级"，可覆盖用户级同名技能
 *
 * 本轮接上了**技能**贡献；**MCP 服务端**贡献已解析出来（含变量展开与缺失变量诊断），
 * 但接入 MCP 列表属于 W11c —— 界面上会显示"已发现 N 个服务端（待接入）"，
 * 不会让用户以为它已经能用了。
 */

import { join } from 'node:path';
import { loadPlugins, summarizePlugins, type PluginLoadResult, type SkillSource } from '@jujia/agent-core';
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

    summary: () => summarizePlugins(latest),
  };
}
