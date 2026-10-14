import { execFile } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
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
  /** 成功但发生过等待时的一句话（目前只有 index.lock 重试会产生它） */
  note?: string;
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
/**
 * 逐行 patch 每个文件最多多少行（M19 的 diff 视图用）。
 * 上限归**读侧**所有：渲染层拿到的 patch 早已有界，不必也不该再存一份。
 */
export const DIFF_PATCH_MAX_LINES = 2000;

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

/**
 * index.lock 的「可见地等」（R24 · 十轮遗留候选，R2 的 e2e 侧同类修复的产品侧对应物）：
 * 另一个 git 进程短暂占着索引锁时，**有界等待后重试** —— 而不是当场把原始报错甩给用户
 * （旧行为：撞锁即失败，"重试"全靠人手动再来一遍）。
 *
 * 两条口径：① **等是有界的**（5 次、300ms 起步线性退避，总计约 3s —— 真被长任务占着就快速失败）；
 * ② **等要说出来** —— 成功把"等过多久"带在 note 里（commit 的成功消息会带上；
 * stage/unstage 的 note 由调用方决定要不要再展示，见 git-service）；最终等不到时，
 * 错误里写清"被谁挡着、等了多久、怎么办"（这条 100% 会显示给用户）。
 */
export const INDEX_LOCK_RETRY_TRIES = 5;
export const INDEX_LOCK_RETRY_BASE_MS = 300;

export function isIndexLockError(text: string): boolean {
  return /index\.lock/i.test(text);
}

async function gitWithIndexLockWait(
  cwd: string,
  args: string[],
): Promise<{ ok: true; stdout: string; note?: string } | { ok: false; error: string }> {
  let waitedMs = 0;
  for (let attempt = 0; attempt < INDEX_LOCK_RETRY_TRIES; attempt += 1) {
    const r = await git(cwd, args);
    if (r.ok) {
      return waitedMs === 0
        ? r
        : { ok: true, stdout: r.stdout, note: `等待 index.lock 释放约 ${String(waitedMs)}ms 后完成` };
    }
    if (!isIndexLockError(r.error)) return r;
    if (attempt === INDEX_LOCK_RETRY_TRIES - 1) {
      return {
        ok: false,
        error:
          `索引被锁（index.lock 还在，通常是另一个 git 进程正在操作同一仓库）——` +
          `已等待约 ${String(waitedMs)}ms；请稍后重试。原始报错：${r.error}`,
      };
    }
    const wait = INDEX_LOCK_RETRY_BASE_MS * (attempt + 1);
    waitedMs += wait;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  return { ok: false, error: '索引等待重试异常终止（不该发生）' };
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
 * 读一个未跟踪条目的内容 —— **只跟普通文件，符号链接一律不读**（外部审查 T29）。
 *
 * 报告的原话是"软链会把工作区外的内容带进 git 历史"，这一半实测不成立
 * （`git add` 之后索引里是 mode 120000，`cat-file` 拿到的是链接目标那串文本）。
 * 成立的是另一半：`getDiffSummary` 原来直接 `readFile(join(cwd, e.path))`，
 * 跟着软链就把**外部文件的内容**读进 diff 界面 —— 拦这一处就够了，
 * 而 `git add` 不动（提交一个软链是正常需求，拦它会把真仓库打死）。
 *
 * 顺带修掉"同一个条目读两遍磁盘"（原来计数一遍、摘录一遍）：
 * 两处各读各的判断迟早分叉，这里收敛成一次读、一份结果。
 *
 * `fs` 参数是为测试留的注入点：Windows 建真软链要开发者模式，
 * 用真链路测出来的绿不可靠（换台机器就红），而这条判据本身是纯逻辑。
 */
export interface UntrackedRead {
  added: number;
  highlights: string[];
  truncated: boolean;
  /** 为什么不读 / 读成什么样：`symbolic-link` 与 `unreadable` 都要在界面上说出来，不许静默当空文件 */
  note: 'symbolic-link' | 'unreadable' | null;
}

/** 注入点用的最小结构类型（真实 `node:fs/promises` 的 `lstat` / `readFile` 都满足它） */
export interface UntrackedFs {
  lstat: (p: string) => Promise<{ isSymbolicLink(): boolean }>;
  readFile: (p: string, encoding: 'utf8') => Promise<string>;
}

export async function readUntrackedFile(
  absPath: string,
  fs: UntrackedFs = { lstat, readFile },
  limit: number = DIFF_HIGHLIGHTS_PER_FILE,
): Promise<UntrackedRead> {
  let isLink: boolean;
  try {
    isLink = (await fs.lstat(absPath)).isSymbolicLink();
  } catch {
    isLink = false; // lstat 都失败：下面按"读不到"处理，不静默当空文件
  }
  if (isLink) {
    return {
      added: 0,
      highlights: ['→ 符号链接：内容未读取（它可能指向工作区之外）'],
      truncated: false,
      note: 'symbolic-link',
    };
  }
  try {
    const content = await fs.readFile(absPath, 'utf8');
    const lines = content.split('\n');
    const informative = lines.filter((l) => l.trim() !== '' && !/^[{}()\];,]+$/.test(l.trim()));
    return {
      added: lines.filter((l) => l.trim() !== '').length,
      highlights: informative.slice(0, limit).map((l) => `+ ${l.trim().slice(0, 160)}`),
      truncated: informative.length > limit,
      note: null,
    };
  } catch {
    return { added: 0, highlights: [], truncated: false, note: 'unreadable' };
  }
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
  // T50：失败不许折成空字符串。旧写法返回仍是 `ok:true`，于是"这次改动没有关键行"与
  // "关键行读不出来（正文超过 maxBuffer）"在界面上长得分毫不差 —— 静默失败 + 谎报，
  // 正是 2026-10-09 审计里 B7 那一族在核心包里的同形。
  const rawError = rawRes.ok ? null : rawRes.error;
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
  // 这里从 status 补齐：行数与摘录**一次读完**（T29 —— 原来各读一遍，且跟着软链读进外部内容）。
  interface UntrackedEntry {
    path: string;
    added: number;
    removed: number;
    highlights: string[];
    truncated: boolean;
    note: 'symbolic-link' | 'unreadable' | null;
  }
  const untracked: UntrackedEntry[] = [];
  const statusRes = await getStatus(cwd);
  if (statusRes.ok && statusRes.data) {
    for (const e of statusRes.data.entries) {
      if (e.code !== '??') continue;
      const read = await readUntrackedFile(join(cwd, e.path));
      untracked.push({
        path: e.path,
        added: read.added,
        removed: 0,
        highlights: read.highlights,
        truncated: read.truncated,
        note: read.note,
      });
    }
  }

  const files: DiffFileSummary[] = [];
  let totalAdded = 0;
  let totalRemoved = 0;
  let noiseFiles = 0;

  // 未跟踪文件排在前面（"新文件"优先级更高）
  let skippedUntracked = 0;
  for (const item of untracked) {
    if (files.length >= DIFF_MAX_FILES) {
      skippedUntracked += 1;
      continue;
    }
    const noise = isNoisePath(item.path);
    if (noise) noiseFiles += 1;
    totalAdded += item.added;
    files.push({
      path: item.path,
      added: item.added,
      removed: 0,
      noise,
      highlights: item.highlights,
      truncated: item.truncated,
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
  // T50：正文读不出来必须单独说一句。上面每个文件的 highlights 此刻都是空的，
  // 而"空"有两种意思（没有关键行 / 关键行读不出来）—— 界面分辨不了，就得由数据说清。
  // 与下一条同一口径（"不读的内容必须说出来，只把行数写成 0 会让人以为新文件是空的"）。
  if (rawError !== null) {
    notes.push(`改动正文读不出来（${rawError}）：关键行一栏为空，行数仍按统计计`);
  }
  if (truncatedFiles || skippedUntracked > 0) {
    notes.push(`改动文件超过 ${DIFF_MAX_FILES} 个，只汇总了前 ${DIFF_MAX_FILES} 个`);
  }
  // 不读的内容必须说出来：只把行数写成 0 会让人以为"新文件是空的"（T29）
  const linkFiles = untracked.filter((u) => u.note === 'symbolic-link').length;
  if (linkFiles > 0) {
    notes.push(`${linkFiles} 个未跟踪条目是符号链接：内容没有读取，它可能指向工作区之外`);
  }
  const unreadableFiles = untracked.filter((u) => u.note === 'unreadable').length;
  if (unreadableFiles > 0) {
    notes.push(`${unreadableFiles} 个未跟踪条目读不到内容（目录或权限受限），行数按 0 计`);
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

/** 逐行 patch 的一个文件（`text` 已按行数上限截断，截断时会在文本里如实说明） */
export interface DiffPatchFile {
  path: string;
  text: string;
  /** `text` 里实际包含的行数 */
  lines: number;
  truncated: boolean;
}

/**
 * 逐行 patch（只读）—— M19 的 diff 视图用它。
 *
 * 与 `getDiffSummary` 的分别只有一句：摘录**只留关键行**（省上下文），
 * patch 要**逐行原文**（给人看改动）。两者共用同一个 `git diff` 口径，
 * 所以这不是新增能力，只是不再精简；上限从"每文件 12 行摘录"换成"每文件 2000 行原文"。
 *
 * 未跟踪的新文件不会出现在这里（`git diff` 不显示它们）——
 * 界面上要按摘要那一份的说法呈现，不能假装"这个文件没有改动"。
 */
export async function getDiffPatch(
  cwd: string,
  staged = false,
  onlyPath?: string,
  maxLines = DIFF_PATCH_MAX_LINES,
): Promise<GitResult<DiffPatchFile[]>> {
  if (!(await isGitRepo(cwd))) return { ok: false, error: '当前工作区不是 Git 仓库' };

  const args = ['diff', ...(staged ? ['--cached'] : []), '--no-color', '--unified=3'];
  if (onlyPath !== undefined && onlyPath !== '') args.push('--', onlyPath);
  const res = await git(cwd, args);
  if (!res.ok) return { ok: false, error: res.error };

  const limit = Math.max(1, Math.floor(maxLines));
  const files: DiffPatchFile[] = [];
  let current: { path: string; kept: string[]; total: number } | null = null;

  const seal = (): void => {
    if (current === null) return;
    const truncated = current.total > current.kept.length;
    const body = current.kept.join('\n');
    files.push({
      path: current.path,
      // 截断必须写在正文里：界面与任何别的消费者看到的是同一句话
      text: truncated
        ? `${body}\n（已截断：本文件共 ${String(current.total)} 行 patch，只显示了前 ${String(current.kept.length)} 行）`
        : body,
      lines: current.kept.length,
      truncated,
    });
    current = null;
  };

  for (const line of res.stdout.split('\n')) {
    if (line.startsWith('diff --git ')) {
      seal();
      const m = / b\/(.+)$/.exec(line);
      current = { path: m?.[1] ?? '(未知路径)', kept: [], total: 0 };
      continue;
    }
    if (current === null) continue; // 头部杂项（如 `warning:` 之类）不进任何文件
    current.total += 1;
    if (current.kept.length < limit) current.kept.push(line);
  }
  seal();

  return { ok: true, data: files };
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
  const r = await gitWithIndexLockWait(cwd, ['add', '--', ...paths]);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, data: null, ...(r.note === undefined ? {} : { note: r.note }) };
}

export async function unstagePaths(cwd: string, paths: string[]): Promise<GitResult<null>> {
  if (paths.length === 0) return { ok: false, error: '未指定要取消暂存的路径' };
  const r = await gitWithIndexLockWait(cwd, ['restore', '--staged', '--', ...paths]);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, data: null, ...(r.note === undefined ? {} : { note: r.note }) };
}

/** 提交（**写操作**：调用方必须先过权限门；消息长度受控，避免塞入超长内容） */
export async function commit(cwd: string, message: string): Promise<GitResult<string>> {
  const msg = message.trim();
  if (msg === '') return { ok: false, error: '提交信息不能为空' };
  if (msg.length > 2000) return { ok: false, error: '提交信息过长（上限 2000 字符）' };
  const r = await gitWithIndexLockWait(cwd, ['commit', '-m', msg]);
  if (!r.ok) return { ok: false, error: r.error };
  const firstLine = r.stdout.split('\n')[0] ?? '';
  // 等过就把"等过"写进成功消息里（可见地等：不是静默重试）
  return r.note === undefined
    ? { ok: true, data: firstLine }
    : { ok: true, data: `${firstLine}（${r.note}）`, note: r.note };
}

/**
 * 远端名 / 分支名的允许形状（M8 `push`）。
 *
 * **为什么要在过命令之前先校验形状**：`execFile` 不经过 shell，所以没有"注入一条命令"这回事，
 * 但 git 会把以 `-` 开头的参数**读成选项** —— 一个叫 `--all` 的"远端名"实际会是 `git push --all`，
 * 一个叫 `--force` 的"分支名"实际会是强推。名字必须只能**是名字**，不能是选项。
 * 首字符限定为字母或数字（顺带排掉 `.` 与 `-` 开头），其后允许 `._-/`（分支里常见 `feature/x`）。
 */
const SAFE_REMOTE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SAFE_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;

/**
 * 推送到远端（**外发、别人看得见、撤回需要远端配合**）。
 *
 * 调用方**必须先过硬 ask 权限门**（`main/git-gate.ts` 把 `push` 钉成不可被「总是允许」压掉的那一档），
 * 这里只负责"形状对不对"和"命令怎么跑"：
 * - 参数走数组、不拼 shell，也不接受任意 git 参数（与 `stage`/`commit` 同一套做法）；
 * - **不做 force / --mirror / 删除远端分支**这些形态 —— 形状校验已经把它们挡在名字之外；
 * - 分支名为空 = 推 `HEAD`（当前这条分支），我们不去猜分支名。
 */
export async function push(
  cwd: string,
  remote: string,
  branch: string | null,
): Promise<GitResult<string>> {
  const r = remote.trim();
  if (!SAFE_REMOTE.test(r)) {
    return { ok: false, error: `远端名不被允许：「${r.slice(0, 40)}」（只允许字母数字开头，后接 . _ - 的名字）` };
  }
  const b = branch === null || branch === '' ? null : branch.trim();
  if (b !== null && !SAFE_BRANCH.test(b)) {
    return { ok: false, error: `分支名不被允许：「${b.slice(0, 40)}」（不许以 - 或 . 开头，也不能含空格）` };
  }
  if (!(await isGitRepo(cwd))) return { ok: false, error: '当前目录不是 Git 仓库' };

  /**
   * 分支留空时用 `HEAD` 而不是"什么都不传"：
   * `git push origin`（无 refspec）走 `push.default=simple`，**要求当前分支已有同名上游**，
   * 第一次推一条新分支会直接失败在"The current branch xxx has no upstream branch" ——
   * 那是配置课，不是用户此刻想做的事。`git push origin HEAD` 的语义正好是我们想要的：
   * 把"现在这条"推到远端同名的那条，没有就建，且不需要同名上游。（这条是单测跑出来的，不是想出来的。）
   */
  const args = b === null ? ['push', r, 'HEAD'] : ['push', r, b];
  // 8MB 上限：一次 push 的输出是远端那几行进度，正常远小于此；给大是为了"大量对象"时不被截成半成品
  const res = await git(cwd, args, 8 * 1024 * 1024);
  if (!res.ok) return { ok: false, error: res.error };
  // git 把进度写到 stderr，成功时给人看的那一行取最后一行非空输出
  const last = res.stdout.split('\n').map((l) => l.trim()).filter((l) => l !== '').pop() ?? '';
  return { ok: true, data: last === '' ? `已推送到 ${r}` : last };
}
