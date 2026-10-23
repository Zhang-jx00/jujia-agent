import { randomUUID } from 'node:crypto';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { JsonStore } from '@jujia/shared';
import { decideNavigation, type PermissionMode, type PermissionRequest, type PermissionResolver, type PermissionRule } from '@jujia/agent-core';
import { getDataRoot } from './paths';
import {
  assertOpenHardAskInert,
  decideOpenTarget,
  openRequestSummary,
  openToolName,
  type OpenTarget,
} from './open-with-gate';
import { auditedGateRun, type GateAuditMarks } from './audit-gate';
import type { AuditService } from './audit-service';

/**
 * 「打开方式」的运行期胶水（M10 收尾）。
 *
 * 分工与 git 那块完全一致：**判档在 `open-with-gate.ts`（纯函数、可做变异）**，
 * 这里只做四件事：验网址 → 验自选程序 → 过权限门 → 真的交出去。
 *
 * 为什么**不走 `run_command` 工具**（虽然那也能启动进程）：
 * `run_command` 的命令是**模型提出**的，审批弹窗上给人看的是"模型想跑这条命令"；
 * 而这里是**用户亲手点的动作**，两者授权来源不同。混用会让"模型也能调起外部浏览器"
 * 变成一个事实 —— 那不是本次要开的能力。
 */

export interface OpenWithPolicy {
  mode: PermissionMode;
  rules: ReadonlyArray<PermissionRule>;
  alwaysAsk: ReadonlyArray<string>;
  /** **规则表这次读不出来**（T74）⇒ 非只读一律硬 ask；不传 = 可信 */
  rulesUntrusted?: boolean;
}

export type OpenWithResult =
  | { ok: true; target: OpenTarget; asked: boolean; decision: string | null }
  | { ok: false; error: string };

export interface OpenWithDeps {
  loadPolicy: () => Promise<OpenWithPolicy>;
  resolvePermission: PermissionResolver;
  getWorkspaceRoot: () => Promise<string | null>;
  /** 真正"交给本机"的两个动作 —— 单测里换成假实现，运行时是真 shell / 真 spawn */
  openInSystemBrowser: (url: string) => Promise<void>;
  launchProgram: (exePath: string, url: string) => Promise<void>;
  exeStore?: ExePathStore;
  /** 执行审计（R8.6）：地址交给外部这件事必须留一条判定账。必填，理由见 `git-service.ts` 同名那格 */
  audit: AuditService;
}

export interface OpenWithService {
  openWith(target: OpenTarget, url: string): Promise<OpenWithResult>;
  currentExePath(): Promise<string | null>;
  /** 只接受**由主进程原生文件对话框选出来**的路径（校验 + 落盘），界面填的不算 */
  acceptPickedExe(pickedPath: string): Promise<{ ok: true; path: string } | { ok: false; error: string }>;
  clearExePath(): Promise<void>;
}

/* ------------------------------------------------------------------ *
 * 自选程序路径的存储
 *
 * 单列一个极小的存储：这个值**不能进 AppConfig 的白名单**。
 * `theme` / `permissionMode` 之类写在配置里没问题，而"哪个可执行文件"是一条
 * 会直接导致本机进程被启动的输入 —— 渲染层一旦被注入就能改写它，等于把
 * "选程序"这一步的授权悄悄转移给了界面。所以它只有一条写入路径：
 * 用户在主进程弹出的文件对话框里亲手选定。
 * ------------------------------------------------------------------ */

export interface ExePathStore {
  read(): Promise<string | null>;
  write(value: string | null): Promise<void>;
}

export function createFileExePathStore(
  file: string = join(getDataRoot(), 'browser-exe.json'),
): ExePathStore {
  const store = new JsonStore<{ path: string | null }>(file, {
    version: 1,
    defaults: () => ({ path: null }),
    validate: (input) => {
      const obj = input as { path?: unknown };
      if (typeof obj.path !== 'string' && obj.path !== null) throw new Error('browser-exe.json 结构非法');
      return { path: obj.path };
    },
  });
  return {
    read: async () => {
      // R25：**只看主文件** —— 这个值决定"启动哪个进程"，从 `.bak` 回退等于让"已清除 / 已损坏"
      // 被一份旧值悄悄顶掉（e2e [20]⑤ 现场形状：清除已成功、随后打开仍带着旧 exe 弹确认框；
      // 机制 = `readJsonSafe` 的备份回退撞上原子写的换名窗口）。拿不到 = null = 让用户重选，
      // 比"复活一个旧程序"更安全；损坏的原件仍由 json-store 在写入路径隔离（`.corrupt-*`）。
      const s = await store.read();
      return s.source === 'primary' ? s.data.path : null;
    },
    write: async (value) => {
      await store.write({ path: value });
    },
  };
}

function createMemoryExePathStore(): ExePathStore {
  let value: string | null = null;
  return {
    read: async () => value,
    write: async (next) => {
      value = next;
    },
  };
}

/** rel 是否落在 root 之内（含相等）；用 resolve 归一化，防 `..` 与大小写分隔符差异 */
function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * 自选程序的静态校验。每一条都对应一个"如果不拦会怎样"：
 * - 非绝对路径 → 会按进程工作目录解析，用户根本不知道启动了哪个文件；
 * - 不存在 / 不是普通文件 → 启动报错，理由不可读；
 * - **在工作区里** → 仓库带一个 exe 就能被"打开网页"这个动作调起来，等于执行仓库内容；
 * - Windows 上的 `.cmd` / `.bat` → 不经 shell 启不动（Node 会 EINVAL），
 *   而为了启它去开 shell 就等于把网址拼进命令行 —— 直接拒绝并说清原因。
 */
export async function checkExePath(
  rawPath: string,
  workspaceRoot: string | null,
  platform: NodeJS.Platform = process.platform,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const path = rawPath.trim();
  if (path === '') return { ok: false, error: '没有选择程序路径' };
  if (!isAbsolute(path)) return { ok: false, error: `必须是绝对路径（收到：${path}）` };
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(path)) {
    return { ok: false, error: '不支持 .cmd / .bat 脚本（启动它需要拼命令行，注入面太大）—— 请选择浏览器自己的 .exe' };
  }
  if (workspaceRoot !== null && workspaceRoot !== '' && isInside(workspaceRoot, path)) {
    return { ok: false, error: '自选程序不能放在工作区里 —— 那等于允许"打开网页"去执行仓库带来的文件' };
  }
  try {
    const st = await stat(path);
    if (!st.isFile()) return { ok: false, error: '所选路径不是单个文件' };
  } catch {
    return { ok: false, error: `文件不存在或读不到：${basename(path)}` };
  }
  return { ok: true, path };
}

export function createOpenWithService(deps: OpenWithDeps): OpenWithService {
  const exeStore = deps.exeStore ?? createMemoryExePathStore();

  const refused = (error: string): OpenWithResult => ({ ok: false, error });

  /**
   * **网址先过浏览器策略层，再谈权限**（与 git 的"路径守卫在弹窗之前"同一顺序理由）：
   * 一个连我们自己都判定不该打开的网址，不该有机会弹到用户面前求确认 ——
   * 那等于让用户替一个畸形输入背书。
   */
  const safeUrl = (url: string): { ok: true; url: string } | { ok: false; error: string } => {
    const nav = decideNavigation(url);
    return nav.allow ? { ok: true, url } : { ok: false, error: nav.reason };
  };

  /**
   * 真的交出去。失败**不吞**：用户已经批过了，这时候"点了没反应"是最糟的结果 ——
   * 把失败原样说成一句可读的理由（自选程序被挪走 / 没权限最常见）。
   */
  const handOver = async (target: OpenTarget, exePath: string | null, url: string): Promise<string | null> => {
    try {
      if (target === 'custom') await deps.launchProgram(exePath ?? '', url);
      else await deps.openInSystemBrowser(url);
      return null;
    } catch (err) {
      return `已经确认，但交给外部程序时失败：${err instanceof Error ? err.message : String(err)}`;
    }
  };

  /**
   * 过门 + 交出去 + **记一笔**（R8.6）。
   *
   * 记账在 `auditedGateRun` 的 `finally` 里，不在下面每条 return 之前 ——
   * 这个函数有九条出口（网址不合法、internal、没选程序、程序不可用、策略拒、允许、
   * 自证失败、人拒、超时、交给外部时失败、成功），逐条插迟早漏一条。
   * 网址那一格走 `commandKey`：**与工具命令同一个摘要**（剔密 + 长度上限），不另写一份。
   */
  const openWith = async (target: OpenTarget, url: string): Promise<OpenWithResult> =>
    auditedGateRun(deps.audit, openToolName(target), (mark) => openWithCore(target, url, mark));

  const openWithCore = async (
    target: OpenTarget,
    url: string,
    mark: (patch: GateAuditMarks) => void,
  ): Promise<OpenWithResult> => {
    const checked = safeUrl(url);
    if (!checked.ok) return checked;
    const finalUrl = checked.url;

    // 内置那一档就是现有主链路：不额外索求授权，交由 IPC 层去开视图
    // （也不进权限门，所以账上不会凭空多出一条"问过人的判定"）
    if (target === 'internal') return { ok: true, target, asked: false, decision: null };

    let exePath: string | null = null;
    if (target === 'custom') {
      const stored = await exeStore.read();
      if (stored === null || stored === '') {
        return refused('还没有选定本机浏览器程序 —— 请先在「打开方式」里用文件对话框选一个');
      }
      const ok = await checkExePath(stored, await deps.getWorkspaceRoot());
      if (!ok.ok) return refused(`自选程序不可用：${ok.error}`);
      exePath = ok.path;
    }

    const policy = await deps.loadPolicy();
    const gate = decideOpenTarget({
      target,
      mode: policy.mode,
      rules: policy.rules,
      alwaysAsk: policy.alwaysAsk,
      // T74：规则表读不出来 ⇒ 非只读一律硬 ask（exactOptionalPropertyTypes ⇒ 只在真的降级时传）
      ...(policy.rulesUntrusted ? { rulesUntrusted: true } : {}),
    });
    const gateArgs: Record<string, unknown> = {
      target,
      url: finalUrl,
      ...(exePath !== null ? { exePath } : {}),
    };
    mark({ gate, args: gateArgs, commandKey: 'url' });

    if (gate.action === 'deny') return refused(`${target === 'custom' ? '自选程序' : '系统浏览器'}被权限策略拒绝：${gate.reason}`);
    if (gate.action === 'allow') {
      const failure = await handOver(target, exePath, finalUrl);
      return failure !== null ? refused(failure) : { ok: true, target, asked: false, decision: 'policy:allow' };
    }

    // 走到这里一定是 ask。被别处改松了就在这一行抛（fail closed），不会静默放行。
    assertOpenHardAskInert(target, gate);

    const request: PermissionRequest = {
      id: randomUUID(),
      toolName: openToolName(target),
      kind: 'exec',
      summary: openRequestSummary(target, { url: finalUrl, ...(exePath !== null ? { exePath } : {}) }),
      args: gateArgs,
      paths: [],
      // 外发档位永远是硬 ask：false 由自证保证（上面那行 assert 不通过就到不了这里）
      bypassable: gate.bypassable,
    };
    const answer = await deps.resolvePermission(request);
    const decision = typeof answer === 'string' ? answer : answer.decision;
    mark({ asked: true, answer: decision });

    if (decision === 'deny' || decision === 'timeout') {
      return refused(decision === 'timeout' ? '确认超时，未交给外部程序' : '你拒绝了，地址未交给任何外部程序');
    }

    // **这里没有"记住"这条路**（两档都是硬 ask）：界面点了「本次会话总是允许」也只算这一次。
    // 下一次换别的网址仍然是新的授权对象 —— 一次授权外溢到下一个网址，就是审批疲劳的成因。
    const failure = await handOver(target, exePath, finalUrl);
    return failure !== null ? refused(failure) : { ok: true, target, asked: true, decision };
  };

  return {
    openWith,
    currentExePath: () => exeStore.read(),
    acceptPickedExe: async (picked) => {
      const ok = await checkExePath(picked, await deps.getWorkspaceRoot());
      if (!ok.ok) return { ok: false, error: ok.error };
      await exeStore.write(ok.path);
      return { ok: true, path: ok.path };
    },
    clearExePath: async () => {
      await exeStore.write(null);
    },
  };
}
