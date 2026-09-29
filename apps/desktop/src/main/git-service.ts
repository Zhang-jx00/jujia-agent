import { randomUUID } from 'node:crypto';
import { relative } from 'node:path';
import {
  commit as gitCommitRun,
  getDiffPatch,
  getDiffSummary,
  getStatus,
  getRecentCommits,
  isGitRepo,
  resolveInsideWorkspace,
  stagePaths,
  unstagePaths,
  type PermissionMode,
  type PermissionRequest,
  type PermissionResolver,
  type PermissionRule,
} from '@jujia/agent-core';
import {
  assertHardAskInert,
  decideGitAction,
  gitRequestSummary,
  gitToolName,
  shouldRememberAlwaysAllow,
  type GitAction,
} from './git-gate';

/**
 * git 服务的运行期胶水（M8 接线）。
 *
 * 分工刻意窄：**判档全在 `git-gate.ts`（纯函数，可测、可做变异），git 命令全在 `agent-core/git.ts`（已有测试）**，
 * 这个文件只做三件事：定位仓库 → 过权限门 → 把结果整理成契约里的形状。
 * 任何"看起来顺手"的判断写在这一层，都会变成测不动、变异也咬不到的地方。
 */

export interface GitPolicy {
  mode: PermissionMode;
  rules: ReadonlyArray<PermissionRule>;
  alwaysAsk: ReadonlyArray<string>;
}

export interface GitServiceDeps {
  /** 当前工作区根；null = 还没选目录 */
  getWorkspaceRoot: () => Promise<string | null>;
  /** 权限门上下文（每次现读，配置改了立刻生效） */
  loadPolicy: () => Promise<GitPolicy>;
  /** 权限审批桥 —— 与工具执行共用同一条通道、同一个弹窗 */
  resolvePermission: PermissionResolver;
}

export type GitQuery<T> = { ok: true; data: T } | { ok: false; error: string };

export interface GitActionResult {
  ok: boolean;
  /** 成功时给人看的一行说明（如 commit 的首行输出）；失败为 null */
  data: string | null;
  error: string | null;
  /** 这次是否**真的过了人手**（false = 本来就不用问，或被策略/白名单直接处置） */
  asked: boolean;
  /** 最终决定的来源：`allow_once` / `allow_always` / `deny` / `timeout` / `policy:allow` / `policy:deny` / `allow_always(cached)` */
  decision: string | null;
}

export interface GitService {
  status(): Promise<GitQuery<unknown>>;
  /**
   * `mode` 默认 `summary`（既有关键行摘录）；`patch` 是 M19 的逐行原文（已按行数上限有界）。
   * `onlyPath` 只对 patch 有意义（摘要的路径过滤留给后续轮次，不在这轮扩）。
   */
  diff(staged: boolean, mode?: 'summary' | 'patch', onlyPath?: string): Promise<GitQuery<unknown>>;
  log(count: number): Promise<GitQuery<string[]>>;
  stage(paths: ReadonlyArray<string>): Promise<GitActionResult>;
  unstage(paths: ReadonlyArray<string>): Promise<GitActionResult>;
  commit(message: string): Promise<GitActionResult>;
  /** 会话内「总是允许」白名单（只对软 ask 开放；测试要能看见它） */
  alwaysAllowed(): ReadonlyArray<string>;
}

const NO_WORKSPACE = '还没有选择工作区目录，无法使用 git';
const NOT_A_REPO = '当前工作区不是 Git 仓库';

type GateAction = Extract<GitAction, 'stage' | 'unstage' | 'commit'>;
/** agent-core 各 git 函数的返回形状（`GitResult`）；`data` 对 stage/unstage 就是 null */
type GitOutcome = { ok: boolean; data?: string | null; error?: string };

export function createGitService(deps: GitServiceDeps): GitService {
  /** 软 ask 的「本次会话总是允许」。**硬 ask 永远进不来**（由 shouldRememberAlwaysAllow 把关） */
  const remembered = new Set<string>();

  /** 定位仓库：成功给出根目录，失败给出可以直接展示给用户的理由 */
  const openRepo = async (): Promise<{ ok: true; root: string } | { ok: false; error: string }> => {
    const root = await deps.getWorkspaceRoot();
    if (root === null || root === '') return { ok: false, error: NO_WORKSPACE };
    if (!(await isGitRepo(root))) return { ok: false, error: NOT_A_REPO };
    return { ok: true, root };
  };

  const query = async <T>(run: (root: string) => Promise<{ ok: boolean; data?: T; error?: string }>): Promise<GitQuery<T>> => {
    const opened = await openRepo();
    if (!opened.ok) return { ok: false, error: opened.error };
    const r = await run(opened.root);
    return r.ok ? { ok: true, data: r.data as T } : { ok: false, error: r.error ?? 'git 操作失败' };
  };

  const finish = (r: GitOutcome, asked: boolean, decision: string): GitActionResult => ({
    ok: r.ok,
    data: r.ok ? (r.data ?? null) : null,
    error: r.ok ? null : (r.error ?? 'git 操作失败'),
    asked,
    decision,
  });

  const refused = (error: string, decision: string | null = null): GitActionResult => ({
    ok: false,
    data: null,
    error,
    asked: false,
    decision,
  });

  /**
   * 写操作的权限门。**这是本模块唯一真正过门的路径**，所以写得直白：
   * 判档 → 自证档位没被改松 → 查会话白名单（只有软 ask 查得到）→ 问人 → 按回答决定做不做。
   */
  const guarded = async (
    action: GateAction,
    detail: { paths?: string[]; message?: string },
    execute: (root: string) => Promise<GitOutcome>,
  ): Promise<GitActionResult> => {
    const opened = await openRepo();
    if (!opened.ok) return refused(opened.error);
    const root = opened.root;

    const policy = await deps.loadPolicy();
    const gate = decideGitAction({ action, mode: policy.mode, rules: policy.rules, alwaysAsk: policy.alwaysAsk });
    const toolName = gitToolName(action);

    if (gate.action === 'deny') return refused(`${toolName} 被权限策略拒绝：${gate.reason}`, 'policy:deny');
    if (gate.action === 'allow') return finish(await execute(root), false, 'policy:allow');

    // 走到这里一定是 ask。硬 ask 若被别处改松了，这一行**抛**（fail closed），不会静默放行。
    assertHardAskInert(action, gate);

    if (gate.bypassable === true && remembered.has(toolName)) {
      return finish(await execute(root), false, 'allow_always(cached)');
    }

    const request: PermissionRequest = {
      id: randomUUID(),
      toolName,
      // kind 用 'write'：git 动作不是"执行任意命令"，但确实改状态。
      // "这次要写历史"的提示由 summary 承担 —— commit 那条明确写「会写入仓库历史」。
      kind: 'write',
      summary: gitRequestSummary(action, detail),
      args: { action, paths: detail.paths ?? [], message: detail.message ?? '' },
      paths: detail.paths ?? [],
      // 档位一路带到按钮上：commit 是硬 ask，这里给 false，弹窗就不该长出「总是允许」
      bypassable: gate.bypassable,
    };
    const answer = await deps.resolvePermission(request);
    const decision = typeof answer === 'string' ? answer : answer.decision;

    if (decision === 'deny' || decision === 'timeout') {
      return {
        ok: false,
        data: null,
        error: decision === 'timeout' ? '确认超时，未执行' : '你拒绝了这次操作，未执行',
        asked: true,
        decision,
      };
    }

    if (shouldRememberAlwaysAllow(action, gate, decision)) remembered.add(toolName);
    return finish(await execute(root), true, decision);
  };

  /**
   * 带路径清单的写操作：**先过 path-guard 再进权限门**。
   * 顺序很重要 —— 越界的路径不该有机会弹到用户面前求确认（那等于让用户替越界背书）。
   */
  const guardedPaths = async (
    action: 'stage' | 'unstage',
    inputPaths: ReadonlyArray<string>,
    execute: (root: string, paths: string[]) => Promise<GitOutcome>,
  ): Promise<GitActionResult> => {
    const root = await deps.getWorkspaceRoot();
    if (root === null || root === '') return refused(NO_WORKSPACE);
    if (inputPaths.length === 0) return refused('没有选中任何文件');

    const rel: string[] = [];
    for (const p of inputPaths) {
      try {
        const inside = relative(root, resolveInsideWorkspace(root, p)).split('\\').join('/');
        if (inside === '') return refused('路径指向仓库根，不能整仓暂存 —— 请逐个选择文件');
        rel.push(inside);
      } catch (err) {
        return refused(`路径被拒绝：${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return guarded(action, { paths: rel }, (r) => execute(r, rel));
  };

  return {
    status: () => query((root) => getStatus(root)),
    diff: (staged, mode = 'summary', onlyPath) =>
      // 两个模式的返回形状不同，所以这里显式要 `unknown`：契约上由 `mode` 区分（见 shared-ipc 的联合类型）
      query<unknown>((root) =>
        mode === 'patch' ? getDiffPatch(root, staged, onlyPath) : getDiffSummary(root, staged),
      ),
    log: (count) => query(async (root) => await getRecentCommits(root, count)),
    stage: (paths) => guardedPaths('stage', paths, (root, p) => stagePaths(root, p)),
    unstage: (paths) => guardedPaths('unstage', paths, (root, p) => unstagePaths(root, p)),
    commit: (message) => guarded('commit', { message }, (root) => gitCommitRun(root, message)),
    alwaysAllowed: () => [...remembered],
  };
}
