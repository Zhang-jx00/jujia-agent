import {
  IPC,
  hooksSaveResultSchema,
  hooksStateSchema,
  pluginsStateSchema,
  type HooksState,
} from '@jujia/shared-ipc';
import { parseHookConfig, HOOK_EVENTS, type PermissionRequest } from '@jujia/agent-core';
import { randomUUID } from 'node:crypto';
import { getWorkspaceInfo } from '../workspace';
import {
  assertHooksHardAskInert,
  decideHooksModify,
  hookCommandsOf,
  hooksModifySummary,
  HOOKS_MODIFY_TOOL,
} from '../hooks-gate';
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

  /**
   * 保存钩子配置。**先过权限门，再落盘**（外部审查 T4）。
   *
   * 顺序理由与 git 的 `guardedPaths` 同源：配置一旦写进 `hooks.json` 就再也"没人问过"了 ——
   * 之后每次工具调用都会以宿主环境执行里面的命令。所以这一次确认是整条链上唯一的人工环节。
   * 这里没有 `remembered` 白名单：硬 ask 的语义就是**每次**都要过人手。
   */
  handle(IPC.HOOKS_SET, async (_e, input: unknown) => {
    const policy = await ctx.loadPolicy();
    const gate = decideHooksModify({
      mode: policy.mode,
      rules: policy.rules,
      alwaysAsk: policy.alwaysAsk,
    });

    if (gate.action === 'deny') {
      return hooksSaveResultSchema.parse({
        ok: false,
        errors: [`权限策略拒绝了对 ${HOOKS_MODIFY_TOOL} 的修改：${gate.reason}`],
        state: await hooksState(),
      });
    }

    let payload = input;
    if (gate.action === 'ask') {
      // 档口被别处改松了就会在这里抛 —— 宁可让这次保存失败，也不要"悄悄不问"
      assertHooksHardAskInert(gate);
      const configPath = hooks.filePath();
      const request: PermissionRequest = {
        id: randomUUID(),
        toolName: HOOKS_MODIFY_TOOL,
        kind: 'write',
        summary: hooksModifySummary(hookCommandsOf(input)),
        // 完整新配置放进 args：弹窗的「查看完整参数」原样展开它 —— 看不到内容的审批等于没有审批
        args: { path: configPath, config: input },
        paths: [configPath],
      };
      const answer = await ctx.deps.permission.resolve(request);
      const decision = typeof answer === 'string' ? answer : answer.decision;

      if (decision === 'deny' || decision === 'timeout') {
        return hooksSaveResultSchema.parse({
          ok: false,
          errors: [
            decision === 'timeout'
              ? '确认超时，钩子配置未改动（未执行任何命令）'
              : '你拒绝了这次修改，钩子配置未改动',
          ],
          state: await hooksState(),
        });
      }
      // edit：用户在弹窗里改过的配置照常入库（`hooks.save` 会再校验一遍，不合法就不落盘）
      if (decision === 'edit' && typeof answer !== 'string') {
        const edited = answer.updatedArgs;
        if (typeof edited === 'object' && edited !== null && 'config' in edited) {
          payload = (edited as { config: unknown }).config;
        }
      }
    }

    const saved = await hooks.save(payload);
    return hooksSaveResultSchema.parse({ ok: saved.ok, errors: saved.errors, state: await hooksState() });
  });
}
