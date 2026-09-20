import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * Git 队列与 diff 审阅（W9a）。
 *
 * 设计依据 2026-09-20 联网核实（卡片 015）：**不把整个 diff 灌回上下文**——
 * 那是 token 黑洞。做法是「**关键代码块摘录**」：只保留新增/修改的关键行，
 * 并把自动生成文件（lockfile、构建产物）识别为噪音单独计数。
 *
 * 安全约束（对齐 W3 的路径沙箱与 W5a 的权限分级）：
 * - 全部用 `execFile` + **参数数组**，绝不拼 shell 字符串（避免命令注入）；
 * - 只暴露**只读**查询（status/diff/log）为自动放行；写操作（stage/commit）由调用方
 *   经权限门放行后再调，本模块不做权限判断（保持单一职责）；
 * - 输出一律**设上限并如实标注截断**，不静默丢内容。
 */

const run = promisify(execFile);

export interface GitResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface GitStatusEntry {
  /** 相对仓库根的路径 */
  path: string;
  /** 两字符状态码（XY），例如 ' M'、'??'、'A ' */
  code: string;
  /** 人类可读说明 */
  label: string;
}

export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  entries: GitStatusEntry[];
  /** 是否因超出上限被截断 */
  truncated: boolean;
}

export interface DiffFileSummary {
  path: string;
  /** 新增行数 / 删除行数 */
  added: number;
  removed: number;
  /** 是否为噪音文件（lockfile / 构建产物 / 生成物） */
  noise: boolean;
  /** 关键行摘录（受上限约束） */
  highlights: string[];
  truncated: boolean;
}

export interface DiffSummary {
  files: DiffFileSummary[];
  totalAdded: number;
  totalRemoved: number;
  /** 噪音文件数（已计入 files，但业务上通常不看） */
  noiseFiles: number;
  /** 整体截断说明（若有） */
  note: string | null;
}

/** 行数上限：diff 摘录每文件最多取多少行 */
export const DIFF_HIGHLIGHTS_PER_FILE = 12;
/** 文件数上限 */
export const DIFF_MAX_FILES = 60;

/** 噪音路径：lockfile 与构建产物——它们行数极大但对审阅几乎无价值 */
const NOISE_PATTERNS: ReadonlyArray<RegExp> = [
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|poetry\.lock|composer\.lock)$/i,
  /(^|\/)(dist|build|out|coverage|node_modules)\//i,
  /\.(min\.js|min\.css|map|snap)$/i,
];

export function isNoisePath(path: string): boolean {
  return NOISE_PATTERNS.some((re) => re.test(path));
}

const LABELS: Record<string, string> = {
  '??': '未跟踪',
  ' M': '已修改',
  M: '已修改',
  A: '已暂存新增',
  D: '已删除',
  R: '已重命名',
  UU: '冲突',
  AA: '冲突（双方新增）',
};

function labelOf(code: string): string {
  const two = code.slice(0, 2);
  return LABELS[two] ?? LABELS[code.trim()] ?? '状态未知';
}

async function git(
  cwd: string,
  args: string[],
  maxBuffer = 4 * 1024 * 1024,
): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  try {
    const { stdout } = await run('git', args, { cwd, maxBuffer, windowsHide: true });
    return { ok: true, stdout };
  } catch (err) {
    const e = err as { stderr?: string; message?: string; code?: string };
    // git 未安装 / 不是仓库 / 无权限，都要给出可读原因，而不是抛异常
    return { ok: false, error: (e.stderr ?? e.message ?? String(err)).trim().slice(0, 300) };
  }
}

/** 是否是一个 git 仓库 */
export async function isGitRepo(cwd: string): Promise<boolean> {
  const r = await git(cwd, ['rev-parse', '--is-inside-work-tree']);
  return r.ok && r.stdout.trim() === 'true';
}

/** 仓库状态（只读，可自动放行） */
export async function getStatus(cwd: string): Promise<GitResult<GitStatus>> {
  if (!(await isGitRepo(cwd))) {
    return { ok: false, error: '当前工作区不是 Git 仓库' };
  }

  // 空仓库（还没有任何提交）时 `rev-parse --abbrev-ref HEAD` 会失败，
  // 但用户仍然想知道自己在哪个分支上 —— 用 symbolic-ref 兜底（单测实测差异）
  let branch: string | null;
  const symRes = await git(cwd, ['symbolic-ref', '--short', '-q', 'HEAD']);
  if (symRes.ok && symRes.stdout.trim() !== '') {
    branch = symRes.stdout.trim();
  } else {
    const branchRes = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
    branch = branchRes.ok && branchRes.stdout.trim() !== 'HEAD' ? branchRes.stdout.trim() : null;
  }

  // -z 用 NUL 分隔，避免文件名含空格/中文被拆错
  const statusRes = await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (!statusRes.ok) return { ok: false, error: statusRes.error };

  const parts = statusRes.stdout.split('\0').filter((s) => s !== '');
  const entries: GitStatusEntry[] = [];
  let truncated = false;

  for (const part of parts) {
    // porcelain -z 格式：XY<space>path（重命名会多一段原始路径，这里只取目标路径）
    const code = part.slice(0, 2);
    const path = part.slice(3);
    if (path === '') continue;
    if (entries.length >= 500) {
      truncated = true;
      break;
    }
    entries.push({ path, code, label: labelOf(code) });
  }

  return { ok: true, data: { isRepo: true, branch, entries, truncated } };
}

/** 逐文件统计增删行数（用于概览，不返回正文） */
export async function getDiffStat(cwd: string, staged = false): Promise<GitResult<Array<{ path: string; added: number; removed: number }>>> {
  const args = ['diff', '--numstat', ...(staged ? ['--cached'] : [])];
  const r = await git(cwd, args);
  if (!r.ok) return { ok: false, error: r.error };

  const out: Array<{ path: string; added: number; removed: number }> = [];
  for (const line of r.stdout.split('\n')) {
    if (line.trim() === '') continue;
    const [a, b, ...rest] = line.split('\t');
    const path = rest.join('\t');
    if (path === '') continue;
    // 二进制文件会是 '-'，按 0 计但保留文件条目
    out.push({ path, added: Number(a) === Number(a) ? Number(a) : 0, removed: Number(b) === Number(b) ? Number(b) : 0 });
  }
  return { ok: true, data: out };
}

/**
 * diff 摘录：**只保留关键行**，并把噪音文件单独标出。
 *
 * 取舍（对齐卡片 015）：不返回完整 diff。每个文件最多取 `DIFF_HIGHLIGHTS_PER_FILE` 行
 * "有信息量"的行（新增/删除且不是纯空行/纯括号），超出如实标注截断。
 */
export async function getDiffSummary(cwd: string, staged = false): Promise<GitResult<DiffSummary>> {
  const statRes = await getDiffStat(cwd, staged);
  if (!statRes.ok || statRes.data === undefined) return { ok: false, error: statRes.error ?? '无法读取 diff 统计' };

  const stat = statRes.data;
  const truncatedFiles = stat.length > DIFF_MAX_FILES;
  const picked = stat.slice(0, DIFF_MAX_FILES);

  const rawRes = await git(cwd, ['diff', ...(staged ? ['--cached'] : []), '--no-color', '--unified=0']);
  const raw = rawRes.ok ? rawRes.stdout : '';

  // 按 'diff --git' 切块
  const blocks = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = / b\/(.+)$/.exec(line);
      current = m?.[1] ?? null;
      if (current) blocks.set(current, []);
      continue;
    }
    if (current) blocks.get(current)?.push(line);
  }

  // **未跟踪文件**：`git diff` 不会显示它们，但用户最关心的恰恰是"新增了什么文件"。
  // 这里从 status 补齐：行数按实际文件内容计，摘录取前若干非空行。（单测实测缺口）
  const untracked: Array<{ path: string; added: number; removed: number }> = [];
  const statusRes = await getStatus(cwd);
  if (statusRes.ok && statusRes.data) {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    for (const e of statusRes.data.entries) {
      if (e.code !== '??') continue;
      let added: number;
      try {
        const content = await readFile(join(cwd, e.path), 'utf8');
        added = content.split('\n').filter((l) => l.trim() !== '').length;
      } catch {
        added = 0; // 目录或不可读文件：计 0 但仍列出
      }
      untracked.push({ path: e.path, added, removed: 0 });
    }
  }

  const files: DiffFileSummary[] = [];
  let totalAdded = 0;
  let totalRemoved = 0;
  let noiseFiles = 0;

  // 未跟踪文件排在前面（"新文件"优先级更高）
  for (const item of untracked.slice(0, DIFF_MAX_FILES)) {
    const noise = isNoisePath(item.path);
    if (noise) noiseFiles += 1;
    totalAdded += item.added;
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    let highlights: string[];
    try {
      const content = await readFile(join(cwd, item.path), 'utf8');
      highlights = content
        .split('\n')
        .filter((l) => l.trim() !== '' && !/^[{}()\];,]+$/.test(l.trim()))
        .slice(0, DIFF_HIGHLIGHTS_PER_FILE)
        .map((l) => `+ ${l.trim().slice(0, 160)}`);
    } catch {
      highlights = [];
    }
    files.push({
      path: item.path,
      added: item.added,
      removed: 0,
      noise,
      highlights,
      truncated: highlights.length >= DIFF_HIGHLIGHTS_PER_FILE,
    });
  }

  for (const item of picked) {
    const noise = isNoisePath(item.path);
    if (noise) noiseFiles += 1;
    totalAdded += item.added;
    totalRemoved += item.removed;

    const lines = blocks.get(item.path) ?? [];
    const highlights: string[] = [];
    let truncated = false;
    for (const line of lines) {
      if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) continue;
      const isChange = line.startsWith('+') || line.startsWith('-');
      if (!isChange) continue;
      const body = line.slice(1).trim();
      // 跳过纯括号 / 纯空行这类低信息量内容
      if (body === '' || /^[{}()[\];,]+$/.test(body)) continue;
      if (highlights.length >= DIFF_HIGHLIGHTS_PER_FILE) {
        truncated = true;
        break;
      }
      highlights.push(`${line.slice(0, 1)} ${body.slice(0, 160)}`);
    }

    files.push({ path: item.path, added: item.added, removed: item.removed, noise, highlights, truncated });
  }

  const notes: string[] = [];
  if (truncatedFiles || untracked.length > DIFF_MAX_FILES) {
    notes.push(`改动文件超过 ${DIFF_MAX_FILES} 个，只汇总了前 ${DIFF_MAX_FILES} 个`);
  }
  if (noiseFiles > 0) notes.push(`其中 ${noiseFiles} 个是 lockfile/构建产物等噪音文件（已标出，通常无需逐个审阅）`);

  return {
    ok: true,
    data: {
      files,
      totalAdded,
      totalRemoved,
      noiseFiles,
      note: notes.length > 0 ? notes.join('；') : null,
    },
  };
}

/** 最近提交（只读） */
export async function getRecentCommits(cwd: string, count = 10): Promise<GitResult<string[]>> {
  const r = await git(cwd, ['log', `-n${Math.max(1, Math.min(count, 100))}`, '--pretty=format:%h %ad %s', '--date=short']);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, data: r.stdout.split('\n').filter((l) => l.trim() !== '') };
}

/**
 * 暂存 / 取消暂存（**写操作**：调用方必须先过权限门）。
 * 路径逐个作为独立参数传入，永远不拼 shell。
 */
export async function stagePaths(cwd: string, paths: string[]): Promise<GitResult<null>> {
  if (paths.length === 0) return { ok: false, error: '未指定要暂存的路径' };
  const r = await git(cwd, ['add', '--', ...paths]);
  return r.ok ? { ok: true, data: null } : { ok: false, error: r.error };
}

export async function unstagePaths(cwd: string, paths: string[]): Promise<GitResult<null>> {
  if (paths.length === 0) return { ok: false, error: '未指定要取消暂存的路径' };
  const r = await git(cwd, ['restore', '--staged', '--', ...paths]);
  return r.ok ? { ok: true, data: null } : { ok: false, error: r.error };
}

/** 提交（**写操作**：调用方必须先过权限门；消息长度受控，避免塞入超长内容） */
export async function commit(cwd: string, message: string): Promise<GitResult<string>> {
  const msg = message.trim();
  if (msg === '') return { ok: false, error: '提交信息不能为空' };
  if (msg.length > 2000) return { ok: false, error: '提交信息过长（上限 2000 字符）' };
  const r = await git(cwd, ['commit', '-m', msg]);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, data: r.stdout.split('\n')[0] ?? '' };
}
