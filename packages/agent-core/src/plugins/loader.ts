/**
 * 插件加载器（W11b）：扫描插件根目录 → 解析 `plugin.json` → 展开变量 → 产出可用的贡献物。
 *
 * 与技能加载器同样的两条纪律：
 * - **诊断必须可见**：清单坏了、变量缺了、路径不存在，都要记诊断（"我装了插件怎么没效果"要能查到）；
 * - **顺序确定**：结果按插件名排序 —— 贡献物会进系统提示，顺序不定就等于前缀不稳。
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import {
  checkPluginName,
  expandServerConfig,
  toStringArray,
  type LoadedPlugin,
  type PluginDiagnostic,
  type PluginLoadResult,
  type PluginManifest,
  type PluginMcpServerConfig,
} from './types';

/** 插件清单文件名（放在插件根目录） */
export const PLUGIN_MANIFEST_FILE = 'plugin.json';

export interface PluginSource {
  /** 插件根目录（其下每个子目录若含 plugin.json 即视为一个插件） */
  path: string;
  /** 插件数据根（运行时输出写这里；与源码目录分开） */
  dataRoot: string;
  /** 当前工作区（用于 `${JUJIA_PROJECT_DIR}`） */
  projectDir: string;
  /** 用户配置（`${user_config.key}` 优先取值） */
  userConfig?: Record<string, string | number | boolean>;
}

async function readJson(path: string): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const text = await readFile(path, 'utf8').catch((err: unknown) => err as Error);
  if (text instanceof Error) return { ok: false, error: `无法读取：${text.message}` };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: `不是合法 JSON：${err instanceof Error ? err.message : String(err)}` };
  }
}

/** 校验清单的形状（只校验我们真的会用到的字段，不做无谓的严格） */
export function validateManifest(input: unknown): { ok: boolean; manifest: PluginManifest | null; errors: string[] } {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, manifest: null, errors: ['plugin.json 必须是一个 JSON 对象'] };
  }
  const m = input as Record<string, unknown>;

  const name = typeof m['name'] === 'string' ? m['name'].trim() : '';
  const nameError = checkPluginName(name);
  if (nameError !== null) errors.push(`name 不合法：${nameError}`);

  for (const key of ['version', 'description', 'author', 'license']) {
    if (m[key] !== undefined && typeof m[key] !== 'string') errors.push(`${key} 必须是字符串`);
  }
  for (const key of ['skills', 'commands']) {
    const v = m[key];
    if (v !== undefined && typeof v !== 'string' && !Array.isArray(v)) {
      errors.push(`${key} 必须是字符串或字符串数组`);
    }
  }
  const servers = m['mcpServers'];
  if (servers !== undefined) {
    // 数组也是 object，必须单独挡掉 —— 否则 `mcpServers: []` 会被当成"合法对象"放过去
    const okShape =
      typeof servers === 'string' ||
      (typeof servers === 'object' && servers !== null && !Array.isArray(servers));
    if (!okShape) errors.push('mcpServers 必须是对象或指向 JSON 文件的路径字符串');
  }
  const userConfig = m['userConfig'];
  if (userConfig !== undefined) {
    if (typeof userConfig !== 'object' || userConfig === null || Array.isArray(userConfig)) {
      errors.push('userConfig 必须是对象');
    } else {
      for (const [k, v] of Object.entries(userConfig as Record<string, unknown>)) {
        if (typeof v !== 'object' || v === null) {
          errors.push(`userConfig.${k} 必须是对象`);
          continue;
        }
        const type = (v as Record<string, unknown>)['type'];
        if (type !== 'string' && type !== 'number' && type !== 'boolean') {
          errors.push(`userConfig.${k}.type 只能是 string / number / boolean`);
        }
      }
    }
  }

  if (errors.length > 0) return { ok: false, manifest: null, errors };
  return { ok: true, manifest: input as PluginManifest, errors: [] };
}

/** 清单里声明的 MCP 服务端（内联对象，或指向一个 JSON 文件） */
async function resolveMcpServers(
  manifest: PluginManifest,
  pluginDir: string,
): Promise<{ servers: Record<string, PluginMcpServerConfig>; error: string | null }> {
  const raw = manifest.mcpServers;
  if (raw === undefined) return { servers: {}, error: null };

  if (typeof raw === 'string') {
    const path = resolve(pluginDir, raw);
    const parsed = await readJson(path);
    if (!parsed.ok) return { servers: {}, error: `mcpServers 指向的文件不可用：${parsed.error}` };
    if (typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value)) {
      return { servers: {}, error: 'mcpServers 指向的文件必须是一个 JSON 对象' };
    }
    return { servers: parsed.value as Record<string, PluginMcpServerConfig>, error: null };
  }

  return { servers: raw, error: null };
}

export async function loadPlugins(sources: ReadonlyArray<PluginSource>): Promise<PluginLoadResult> {
  const diagnostics: PluginDiagnostic[] = [];
  const byName = new Map<string, LoadedPlugin>();
  const scannedDirs: string[] = [];

  for (const source of sources) {
    scannedDirs.push(source.path);
    const entries = await readdir(source.path, { withFileTypes: true }).catch(() => null);
    if (entries === null) continue;

    const dirNames = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();

    for (const dirName of dirNames) {
      const dir = join(source.path, dirName);
      const manifestPath = join(dir, PLUGIN_MANIFEST_FILE);
      const info = await stat(manifestPath).catch(() => null);
      // 没有 plugin.json 的子目录只是普通目录，安静跳过
      if (info === null) continue;

      const parsed = await readJson(manifestPath);
      if (!parsed.ok) {
        diagnostics.push({ plugin: dirName, dir, severity: 'error', message: parsed.error });
        continue;
      }
      const checked = validateManifest(parsed.value);
      if (!checked.ok || checked.manifest === null) {
        for (const e of checked.errors) {
          diagnostics.push({ plugin: dirName, dir, severity: 'error', message: e });
        }
        continue;
      }
      const manifest = checked.manifest;
      const own: PluginDiagnostic[] = [];
      const pluginData = join(source.dataRoot, manifest.name);

      // skills / commands：相对路径；只有**真实存在**的目录才算贡献物
      const resolveDirs = async (value: unknown, label: string): Promise<string[]> => {
        const out: string[] = [];
        for (const rel of toStringArray(value)) {
          const abs = isAbsolute(rel) ? rel : resolve(dir, rel);
          const st = await stat(abs).catch(() => null);
          if (st === null || !st.isDirectory()) {
            own.push({
              plugin: manifest.name,
              dir,
              severity: 'warning',
              message: `${label} 目录不存在或不是目录，已忽略：${rel}`,
            });
            continue;
          }
          out.push(abs);
        }
        return out;
      };

      const skillsDirs = await resolveDirs(manifest.skills, 'skills');
      const commandsDirs = await resolveDirs(manifest.commands, 'commands');

      // MCP 服务端：展开变量；**缺失变量 → 剔除该服务端并记诊断**（fail-closed 且可见）
      const resolved = await resolveMcpServers(manifest, dir);
      if (resolved.error !== null) {
        own.push({ plugin: manifest.name, dir, severity: 'error', message: resolved.error });
      }
      const userConfig: Record<string, string | number | boolean> = {};
      for (const [key, opt] of Object.entries(manifest.userConfig ?? {})) {
        if (opt.default !== undefined) userConfig[key] = opt.default;
      }

      const mcpServers: { name: string; config: PluginMcpServerConfig }[] = [];
      for (const [serverName, serverConfig] of Object.entries(resolved.servers).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      )) {
        const expanded = expandServerConfig(serverConfig, {
          pluginRoot: dir,
          pluginData,
          projectDir: source.projectDir,
          userConfig,
        });
        if (expanded.missing.length > 0) {
          own.push({
            plugin: manifest.name,
            dir,
            severity: 'error',
            message:
              `MCP 服务端「${serverName}」引用了缺失的变量：${expanded.missing.join(', ')}` +
              ' —— 已禁用该服务端（不会拿空串去启动）',
          });
          continue;
        }
        if (expanded.config.command === undefined || expanded.config.command.trim() === '') {
          own.push({
            plugin: manifest.name,
            dir,
            severity: 'error',
            message: `MCP 服务端「${serverName}」缺少 command，已跳过`,
          });
          continue;
        }
        mcpServers.push({ name: serverName, config: expanded.config });
      }

      const plugin: LoadedPlugin = {
        name: manifest.name,
        dir,
        manifest,
        skillsDirs,
        commandsDirs,
        mcpServers,
        diagnostics: own,
      };

      const existing = byName.get(manifest.name);
      if (existing !== undefined) {
        // 后者覆盖前者（sources 顺序即优先级）；同名冲突必须可见
        diagnostics.push({
          plugin: manifest.name,
          dir,
          severity: 'warning',
          message: `与 ${existing.dir} 的同名插件冲突，已采用后者`,
        });
      }
      byName.set(manifest.name, plugin);
      diagnostics.push(...own);
    }
  }

  const plugins = [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { plugins, diagnostics, scannedDirs };
}

/** 供诊断/界面用的一行摘要 */
export function summarizePlugins(result: PluginLoadResult): string {
  const errs = result.diagnostics.filter((d) => d.severity === 'error').length;
  const skills = result.plugins.reduce((n, p) => n + p.skillsDirs.length, 0);
  const servers = result.plugins.reduce((n, p) => n + p.mcpServers.length, 0);
  return `已加载 ${result.plugins.length} 个插件（技能目录 ${skills} 个 · MCP 服务端 ${servers} 个）${
    errs > 0 ? `；${errs} 条错误` : ''
  }`;
}
