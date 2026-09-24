import {
  IPC,
  hooksSaveResultSchema,
  hooksStateSchema,
  pluginsStateSchema,
  type HooksState,
} from '@jujia/shared-ipc';
import { parseHookConfig, HOOK_EVENTS } from '@jujia/agent-core';
import { getWorkspaceInfo } from '../workspace';
import type { IpcContext } from './context';

/**
 * 插件清单（W11b）与生命周期钩子（W5d）的读页面。
 *
 * 两者都是"用户写文件 / 写配置，应用照单解析并如实报告诊断"的形态，
 * 所以这里的核心职责是**把解析失败原样端出来**，而不是包装成"保存失败"。
 */
export function registerExtensionIpc(ctx: IpcContext): void {
  const { handle, plugins, hooks } = ctx;

  const hooksState = async (): Promise<HooksState> => {
    const raw = hooks.raw();
    const check = parseHookConfig(raw);
    const events = (check.config?.events ?? {}) as Record<string, unknown>;
    const counts: Record<string, number> = {};
    for (const ev of HOOK_EVENTS) {
      const groups = Array.isArray(events[ev]) ? (events[ev] as { hooks?: unknown[] }[]) : [];
      counts[ev] = groups.reduce((n, g) => n + (Array.isArray(g.hooks) ? g.hooks.length : 0), 0);
    }
    return hooksStateSchema.parse({
      raw,
      errors: check.errors,
      enabled: check.config?.enabled === true,
      filePath: hooks.filePath(),
      counts,
    });
  };

  handle(IPC.PLUGINS_GET, async () => {
    const ws = await getWorkspaceInfo();
    const result = await plugins.refresh(ws.valid ? ws.root : null);
    return pluginsStateSchema.parse({
      summary: plugins.summary(),
      scannedDirs: result.scannedDirs,
      plugins: result.plugins.map((pl) => ({
        name: pl.name,
        version: pl.manifest.version ?? null,
        description: pl.manifest.description ?? null,
        dir: pl.dir,
        skillsCount: pl.skillsDirs.length,
        commandsCount: pl.commandsDirs.length,
        mcpServers: pl.mcpServers.map((s) => s.name),
        diagnostics: pl.diagnostics,
      })),
      diagnostics: result.diagnostics,
    });
  });

  handle(IPC.HOOKS_GET, async () => await hooksState());

  handle(IPC.HOOKS_SET, async (_e, input: unknown) => {
    const saved = await hooks.save(input);
    return hooksSaveResultSchema.parse({ ok: saved.ok, errors: saved.errors, state: await hooksState() });
  });
}
