import {
  IPC,
  gitActionResultSchema,
  gitCommitSchema,
  gitDiffResultSchema,
  gitDiffSchema,
  gitLogResultSchema,
  gitLogSchema,
  gitPathsSchema,
  gitPushSchema,
  gitStatusResultSchema,
} from '@jujia/shared-ipc';
import { createGitService } from '../git-service';
import { getWorkspaceInfo } from '../workspace';
import type { IpcContext } from './context';

/**
 * git 模块（M8 接线）。
 *
 * 权限档位（所有者给定，`git-gate.ts` 是**唯一**判档处）：
 * `status`/`diff`/`log` 只读 → **不问**；`stage`/`unstage` 可逆 → **软 ask**；
 * `commit` 会写入仓库历史 → **硬 ask**（任何「总是允许」都压不掉，且弹窗文案必须点明）。
 *
 * 这里**不开"通用 git 命令"通道**：那等于把 `push -f`、`reset --hard` 一起放进来，
 * 档位就没法按动作分。要加动作就加一条通道 + 一行档位 + 一条测试。
 */
export function registerGitIpc(ctx: IpcContext): void {
  const { handle, deps, loadPolicy, audit } = ctx;

  const git = createGitService({
    getWorkspaceRoot: async () => (await getWorkspaceInfo()).root,
    loadPolicy,
    resolvePermission: (req) => deps.permission.resolve(req),
    audit,
  });

  handle(IPC.GIT_STATUS, async () => gitStatusResultSchema.parse(await git.status()));

  handle(IPC.GIT_DIFF, async (_e, payload: unknown) => {
    const parsed = gitDiffSchema.safeParse(payload ?? {});
    const staged = parsed.success ? (parsed.data.staged ?? false) : false;
    const mode = parsed.success ? (parsed.data.mode ?? 'summary') : 'summary';
    const onlyPath = parsed.success ? parsed.data.path : undefined;
    const r = await git.diff(staged, mode, onlyPath);
    // patch 与摘要的返回形状不同，用 `mode` 明确标出来（老调用点看不到这个字段也照常工作）
    return gitDiffResultSchema.parse(r.ok === true ? { ok: true, mode, data: r.data } : r);
  });

  handle(IPC.GIT_LOG, async (_e, payload: unknown) => {
    const parsed = gitLogSchema.safeParse(payload ?? {});
    const count = parsed.success ? (parsed.data.count ?? 20) : 20;
    return gitLogResultSchema.parse(await git.log(count));
  });

  /** 写操作的共用入口：入参先过 zod，越界与空清单在服务层拦（不问用户） */
  const gitWrite = async (
    payload: unknown,
    run: (paths: string[]) => Promise<unknown>,
  ): Promise<unknown> => {
    const parsed = gitPathsSchema.safeParse(payload);
    if (!parsed.success) {
      return gitActionResultSchema.parse({
        ok: false,
        data: null,
        error: '路径清单不合法（为空、过长或形态不对）',
        asked: false,
        decision: null,
      });
    }
    return gitActionResultSchema.parse(await run(parsed.data.paths));
  };

  handle(IPC.GIT_STAGE, async (_e, payload: unknown) => gitWrite(payload, (p) => git.stage(p)));
  handle(IPC.GIT_UNSTAGE, async (_e, payload: unknown) => gitWrite(payload, (p) => git.unstage(p)));

  handle(IPC.GIT_COMMIT, async (_e, payload: unknown) => {
    const parsed = gitCommitSchema.safeParse(payload);
    if (!parsed.success) {
      return gitActionResultSchema.parse({
        ok: false,
        data: null,
        error: '提交信息为空或过长（上限 2000 字）',
        asked: false,
        decision: null,
      });
    }
    return gitActionResultSchema.parse(await git.commit(parsed.data.message));
  });

  /**
   * 推送（M8 收口）。入参先过 zod 收窄形状，**再进服务层的权限门** ——
   * 顺序是刻意的：一个连形状都不对的参数（比如把 `--force` 当远端名传进来）
   * 不该有机会弹到用户面前求确认，那等于让用户替越界背书（与 `gitWrite` 同一个理由）。
   */
  handle(IPC.GIT_PUSH, async (_e, payload: unknown) => {
    const parsed = gitPushSchema.safeParse(payload);
    if (!parsed.success) {
      return gitActionResultSchema.parse({
        ok: false,
        data: null,
        error: '推送参数不合法（远端名为空或过长；分支可留空）',
        asked: false,
        decision: null,
      });
    }
    const branch = parsed.data.branch ?? null;
    return gitActionResultSchema.parse(await git.push(parsed.data.remote, branch));
  });
}
