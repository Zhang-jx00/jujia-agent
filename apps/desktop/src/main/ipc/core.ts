import { app } from 'electron';
import {
  IPC,
  appConfigSchema,
  appInfoSchema,
  configSnapshotSchema,
  permissionDecisionSchema,
  workspaceInfoSchema,
  type AppConfig,
  type AppInfo,
  type ConfigSnapshot,
} from '@jujia/shared-ipc';
import { validateThemePack } from '@jujia/ui-tokens';
import { pickWritableConfig } from '../config-write';
import { getDataRoot } from '../paths';
import { readConfigSnapshot, writeConfig } from '../config-store';
import { clearWorkspace, getWorkspaceInfo, pickWorkspace } from '../workspace';
import type { IpcContext } from './context';

/**
 * 应用信息 / 配置 / 工作区 / 审批回执 —— 这些是"外壳级"通道，几乎每个页面都要用。
 */
export function registerCoreIpc(ctx: IpcContext): void {
  const { handle, deps } = ctx;

  handle(IPC.APP_INFO, (): AppInfo => {
    const payload: AppInfo = {
      name: '俱佳Agent',
      version: app.getVersion(),
      electron: process.versions.electron ?? 'unknown',
      chrome: process.versions.chrome ?? 'unknown',
      node: process.versions.node,
      platform: process.platform,
      security: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
      dataRoot: getDataRoot(),
    };
    return appInfoSchema.parse(payload);
  });

  handle(IPC.CONFIG_GET, async (): Promise<ConfigSnapshot> => {
    return configSnapshotSchema.parse(await readConfigSnapshot());
  });

  /**
   * 允许**渲染层**写入的配置键（白名单在 `config-write.ts`，纯函数、有独立单测）。
   *
   * 关键口径（轨道回归计划 1 修 S1）：**白名单之外的键一律报错，不再静默丢弃**。
   * 此前是"照单收下、只挑几个写进去"，于是权限面板切模式会**成功返回但什么都没改** ——
   * 安全相关的静默失败。为什么 `permissionMode` 可写、`workspace` 不可写，
   * 理由完整写在 `config-write.ts` 与 SECURITY.md，这里不复述（一处一份真相）。
   *
   * **必须调用 `pickWritableConfig`，不许在这里再写一遍白名单** —— 否则单测与变异测的是死代码。
   */
  handle(IPC.CONFIG_SET, async (_e, patch: unknown): Promise<ConfigSnapshot> => {
    // 只接受已知字段，防止渲染层塞任意键污染配置；
    // 显式剔除 undefined 以配合 exactOptionalPropertyTypes
    const parsed = appConfigSchema.partial().parse(patch);
    const { clean: allowed, rejected } = pickWritableConfig(parsed);
    if (rejected.length > 0) {
      throw new Error(
        `这些配置项不允许由界面写入：${rejected.join('、')}。` +
          '工作区请用「选择目录」按钮（主进程对话框）设置；高危清单请直接改配置文件。',
      );
    }

    const clean: Partial<AppConfig> = { ...allowed };
    if (parsed.permissionMode !== undefined && parsed.permissionMode === 'bypassPermissions') {
      // bypassPermissions = 全部放行，值得在日志里留痕（会话之外可回溯"谁在什么时候放开了它"）
      console.warn('[security] 权限模式已切到 bypassPermissions（全部放行）—— 请确认你在可信环境中');
    }
    if (parsed.appearance !== undefined) {
      // 外观必须过一遍受控字段校验才允许落盘：
      // 样式包将来会喂给 CSS 变量，非法内容等于把注入面写进配置（见卡片 013 的 RCE 事件）。
      const raw = parsed.appearance.pack;
      if (raw !== null && raw !== undefined) {
        const check = validateThemePack(raw);
        if (!check.ok || !check.pack) {
          throw new Error(`外观样式包被拒绝：${check.errors.join('；')}`);
        }
        clean.appearance = { packId: parsed.appearance.packId, pack: check.pack };
      } else {
        clean.appearance = { packId: parsed.appearance.packId, pack: null };
      }
    }
    return configSnapshotSchema.parse(await writeConfig(clean));
  });

  /* ---------------------- 工作区（工具的路径边界） ---------------------- */

  handle(IPC.WORKSPACE_GET, async () => workspaceInfoSchema.parse(await getWorkspaceInfo()));

  handle(IPC.WORKSPACE_PICK, async () =>
    workspaceInfoSchema.parse(await pickWorkspace(deps.getWindow?.())),
  );

  handle(IPC.WORKSPACE_CLEAR, async () => workspaceInfoSchema.parse(await clearWorkspace()));

  /* ------------------------- 审批回执（权限桥） ------------------------- */

  /** 渲染层把用户对某个审批的决定送回主进程；未知 id 返回 false（不抛，界面据此清理队列） */
  handle(IPC.PERMISSION_RESOLVE, async (_e, payload: unknown): Promise<boolean> => {
    const { id, decision, updatedArgs } = (payload ?? {}) as {
      id?: unknown;
      decision?: unknown;
      updatedArgs?: unknown;
    };
    if (typeof id !== 'string' || id === '') return false;
    const parsed = permissionDecisionSchema.safeParse(decision);
    if (!parsed.success) return false;
    return deps.permission.settle(id, parsed.data, updatedArgs);
  });
}
