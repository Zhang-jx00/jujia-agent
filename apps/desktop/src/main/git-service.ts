import { randomUUID } from 'node:crypto';
import { relative } from 'node:path';
import {
  commit as gitCommitRun,
  getDiffPatch,
  getDiffSummary,
  getStatus,
  getRecentCommits,
  isGitRepo,
  push as gitPushRun,
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
import { auditedGateRun, type GateAuditMarks } from './audit-gate';
import type { AuditService } from './audit-service';
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
  /** **规则表这次读不出来**（T74）⇒ 非只读一律硬 ask；不传 = 可信 */
  rulesUntrusted?: boolean;
}

export interface GitServiceDeps {
  /** 当前工作区根；null = 还没选目录 */
  getWorkspaceRoot: () => Promise<string | null>;
  /** 权限门上下文（每次现读，配置改了立刻生效） */
  loadPolicy: () => Promise<GitPolicy>;
  /** 权限审批桥 —— 与工具执行共用同一条通道、同一个弹窗 */
  resolvePermission: PermissionResolver;
  /**
   * 执行审计（R8.5 建账、本轮把 git 门接进来）。
   * **必填**：可选参数会变成"忘了传也照样跑"，那就又回到"判定发生过但账上没有"。
   */
  audit: AuditService;
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
  /**
   * 推送到远端（M8 收口）。`branch` 传 null = 推 `HEAD`（当前分支），
   * 我们不去猜分支名。**这是外发不可逆动作，硬 ask 且永不可被「总是允许」压掉**（判档在 `git-gate.ts`）。
   */
  push(remote: string, branch: string | null): Promise<GitActionResult>;
  /** 会话内「总是允许」白名单（只对软 ask 开放；测试要能看见它） */
  alwaysAllowed(): ReadonlyArray<string>;
}

const NO_WORKSPACE = '还没有选择工作区目录，无法使用 git';
const NOT_A_REPO = '当前工作区不是 Git 仓库';

type GateAction = Extract<GitAction, 'stage' | 'unstage' | 'commit' | 'push'>;
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
   *
   * 外面这一层只做一件事：**把判定事实记进审计账本**（R8.6）。
   * 记账放在 `finally` 而不是散在下面各条 return 之前，是因为这个函数有六条出口，
   * 逐条插 = 迟早漏一条（工具侧同一结论见 `executor.ts` 的 `runTool`）。
   */
  const guarded = async (
    action: GateAction,
    detail: { paths?: string[]; message?: string; remote?: string; branch?: string | null },
    execute: (root: string) => Promise<GitOutcome>,
  ): Promise<GitActionResult> =>
    auditedGateRun(deps.audit, gitToolName(action), (mark) => guardedCore(action, detail, execute, mark));

  const guardedCore = async (
    action: GateAction,
    detail: { paths?: string[]; message?: string; remote?: string; branch?: string | null },
    execute: (root: string) => Promise<GitOutcome>,
    mark: (patch: GateAuditMarks) => void,
  ): Promise<GitActionResult> => {
    const opened = await openRepo();
    if (!opened.ok) return refused(opened.error);
    const root = opened.root;

    const policy = await deps.loadPolicy();
    const gate = decideGitAction({
      action,
      mode: policy.mode,
      rules: policy.rules,
      alwaysAsk: policy.alwaysAsk,
      // T74：规则表读不出来 ⇒ 非只读一律硬 ask（exactOptionalPropertyTypes ⇒ 只在真的降级时传）
      ...(policy.rulesUntrusted ? { rulesUntrusted: true } : {}),
    });
    const toolName = gitToolName(action);
    // 弹窗与账本用的是**同一份** args —— 两处各拼一份早晚漂移（账上记的却不是问过人的那份）
    const gateArgs: Record<string, unknown> = {
      action,
      paths: detail.paths ?? [],
      message: detail.message ?? '',
      // push 的两个参数进 args：弹窗与审计都要能看见"发到哪个远端、哪条分支"，
      // 而不是只有一句文案 —— 事后对账看的是字段。
      ...(detail.remote === undefined ? {} : { remote: detail.remote }),
      ...(detail.branch === undefined ? {} : { branch: detail.branch }),
    };
    mark({ gate, args: gateArgs });

    if (gate.action === 'deny') return refused(`${toolName} 被权限策略拒绝：${gate.reason}`, 'policy:deny');
    if (gate.action === 'allow') return finish(await execute(root), false, 'policy:allow');

    // 走到这里一定是 ask。硬 ask 若被别处改松了，这一行**抛**（fail closed），不会静默放行。
    assertHardAskInert(action, gate);

    if (gate.bypassable === true && remembered.has(toolName)) {
      // 软 ask 被会话白名单压掉：**没问过人**，所以只标 executed（由返回的 ok 推出），不许标 answer
      return finish(await execute(root), false, 'allow_always(cached)');
    }

    const request: PermissionRequest = {
      id: randomUUID(),
      toolName,
      // kind 用 'write'：git 动作不是"执行任意命令"，但确实改状态。
      // "这次要写历史"的提示由 summary 承担 —— commit 那条明确写「会写入仓库历史」。
      kind: 'write',
      summary: gitRequestSummary(action, detail),
      args: gateArgs,
      paths: detail.paths ?? [],
      // 档位一路带到按钮上：commit 是硬 ask，这里给 false，弹窗就不该长出「总是允许」
      bypassable: gate.bypassable,
    };
    const answer = await deps.resolvePermission(request);
    const decision = typeof answer === 'string' ? answer : answer.decision;
    mark({ asked: true, answer: decision });

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
    /**
     * push 与 commit **共用同一个 `guarded`** —— 这是刻意的：外发动作绝不能有第二条路
     * （`git-wiring.test.ts` 钉这一条：服务里 `gitPushRun` 只出现在 `guarded` 的回调里）。
     */
    push: (remote, branch) =>
      guarded('push', { remote, branch }, (root) => gitPushRun(root, remote, branch)),
    alwaysAllowed: () => [...remembered],
  };
}
