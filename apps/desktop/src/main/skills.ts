/**
 * 技能服务（W11a）：把"技能目录从哪来、什么时候刷新、工具怎么拿目录"收在一处。
 *
 * 为什么不做后台文件监听：技能是"你偶尔才会加一个"的东西，
 * 每轮对话前扫一次目录（几个目录、几个小文件，毫秒级）比维护一个跨平台的监听器
 * 更简单也更不容易出错 —— 而且**每次读到的一定是最新的**，没有"监听到了但状态没同步"的中间态。
 * 真要做监听，等目录规模真的变大再说。
 */

import { join } from 'node:path';
import {
  createSkillTool,
  loadSkillCatalog,
  renderSkillCatalog,
  type SkillCatalog,
  type SkillSource,
  type ToolRegistry,
} from '@jujia/agent-core';
import { getDataRoot } from './paths';

/** 用户级技能目录（跨工作区可用） */
export function userSkillsDir(): string {
  return join(getDataRoot(), 'skills');
}

/** 工作区级技能目录（只在该工作区生效，优先级更高） */
export function workspaceSkillsDir(workspaceRoot: string): string {
  return join(workspaceRoot, '.jujia', 'skills');
}

const EMPTY: SkillCatalog = { skills: [], skipped: [], scannedDirs: [] };

export interface SkillsService {
  /** 重新扫描并返回最新目录；同时保证 `load_skill` 工具已注册进注册表 */
  refresh(workspaceRoot: string | null): Promise<SkillCatalog>;
  /** 最近一次扫描结果（`load_skill` 的即时取值来源） */
  current(): SkillCatalog;
  /** 注入系统提示的清单文本（无技能时为空串） */
  catalogText(): string;
}

export interface SkillsServiceDeps {
  /** 用户级技能目录（默认取数据目录下的 skills/）；可注入，便于端到端验证 */
  userDir?: string;
  /** 工作区级技能目录（默认 <工作区>/.jujia/skills） */
  workspaceDir?: (workspaceRoot: string) => string;
  /**
   * 完整来源列表（按优先级从低到高）。
   * 默认是 [用户级, 工作区级]；接入插件后由调用方把插件贡献的技能目录按插件所在层插进去。
   */
  sourcesFor?: (workspaceRoot: string | null) => SkillSource[];
}

export function createSkillsService(registry: ToolRegistry, deps: SkillsServiceDeps = {}): SkillsService {
  const userDir = deps.userDir ?? userSkillsDir();
  const wsDir = deps.workspaceDir ?? workspaceSkillsDir;
  let latest: SkillCatalog = EMPTY;
  let toolRegistered = false;

  return {
    async refresh(workspaceRoot) {
      // 顺序即优先级（越靠后越高）：默认「用户级 → 工作区级」；
      // 接入插件后由 sourcesFor 把插件贡献的目录按插件所在层插进去。
      const sources: SkillSource[] =
        deps.sourcesFor !== undefined
          ? deps.sourcesFor(workspaceRoot)
          : [
              { path: userDir, origin: 'user' },
              ...(workspaceRoot !== null ? [{ path: wsDir(workspaceRoot), origin: 'workspace' as const }] : []),
            ];
      latest = await loadSkillCatalog(sources);

      // 工具在第一次刷新时注册；取值用函数而不是快照，因此**新装的技能立刻可见**
      if (!toolRegistered) {
        registry.register(createSkillTool(() => latest));
        toolRegistered = true;
      }
      return latest;
    },

    current: () => latest,

    catalogText: () => renderSkillCatalog(latest),
  };
}
