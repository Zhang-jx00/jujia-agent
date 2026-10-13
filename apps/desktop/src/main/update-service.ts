import { compareVersions } from '@jujia/agent-core';

/**
 * 更新检查（M12 批二 · R11）—— **无依赖最小形态**。
 *
 * 评估结论（详见 `docs/DESIGN-UPDATE.md`）：自动下载并执行安装包那一档要引入
 * `electron-updater`（新依赖）且会把"执行外部代码"带进进程生命周期 —— 属**停牌②**，本轮不开。
 * 最小形态只做三件事：**查一次**（拿最新 release 的 tag）· **说一句**（有没有新版本）·
 * **指条路**（把发布页地址交给用户自己去看）—— **不下载、不执行、不改任何东西**。
 *
 * 请求是**用户点一次、发一次**：没有后台轮询（轮询=第二个定时器，且会在没人要求时出站）。
 * 失败一律说话：404 分"查不到（仓库尚未公开 / 还没有发布）"、网络错带原因、超时 8 秒有上界。
 */

export interface UpdateCheckResult {
  ok: boolean;
  current: string;
  /** 查到的最新 tag（查不到为空串） */
  latest: string;
  hasUpdate: boolean;
  /** 发布页地址（交给人自己去看，应用不代劳） */
  url: string;
  /** 给人读的一句话（ok 时为空串） */
  error: string;
}

export interface UpdateServiceOptions {
  currentVersion: string;
  fetchImpl: typeof fetch;
  apiUrl?: string;
  timeoutMs?: number;
}

/** 生产默认指向本仓的 releases/latest（仓库公开后即可用；私有时 API 会 404，界面如实说） */
export const DEFAULT_UPDATE_API =
  'https://api.github.com/repos/Zhang-jx00/jujia-agent/releases/latest';

const DEFAULT_TIMEOUT_MS = 8_000;

export function createUpdateService(opts: UpdateServiceOptions): { check(): Promise<UpdateCheckResult> } {
  const apiUrl = opts.apiUrl ?? DEFAULT_UPDATE_API;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const fail = (error: string): UpdateCheckResult => ({
    ok: false,
    current: opts.currentVersion,
    latest: '',
    hasUpdate: false,
    url: '',
    error,
  });

  return {
    async check() {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await opts.fetchImpl(apiUrl, {
          headers: {
            accept: 'application/vnd.github+json',
            'user-agent': 'JujiaAgent-update-check',
          },
          signal: controller.signal,
        });
        if (!res.ok) {
          return fail(
            res.status === 404
              ? '查不到最新发布（HTTP 404 —— 仓库可能尚未公开、或还没有发布过）'
              : `查询失败（HTTP ${String(res.status)}）`,
          );
        }
        const data = (await res.json()) as { tag_name?: unknown; html_url?: unknown };
        const latest = typeof data.tag_name === 'string' ? data.tag_name : '';
        const url = typeof data.html_url === 'string' ? data.html_url : '';
        if (latest === '') return fail('返回里没有版本号（发布页格式不认识）');
        const cmp = compareVersions(latest, opts.currentVersion);
        if (cmp === null) {
          return fail(`读不懂版本号「${latest}」—— 没法比，就不说"已是最新"`);
        }
        return {
          ok: true,
          current: opts.currentVersion,
          latest,
          hasUpdate: cmp > 0,
          url,
          error: '',
        };
      } catch (err) {
        const reason = controller.signal.aborted
          ? `查询超时（${String(Math.round(timeoutMs / 1000))} 秒没有回应）`
          : `查询失败：${err instanceof Error ? err.message : String(err)}`;
        return fail(reason);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
