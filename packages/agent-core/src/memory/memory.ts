import { readFile, readdir, appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join, relative, sep, dirname } from 'node:path';
import { guardPath } from '../tools/path-guard';

/**
 * 记忆模块（W8）。
 *
 * 设计依据 2026-09-20 联网核实（见 knowledge/cards/015），要点：
 * 1. **AGENTS.md 只写「不可见的逻辑」**（沉默约束），不写技术栈/目录说明——
 *    agent 自己读得出来，重复注入只是稀释注意力（ETH Zurich 2026 研究：自动生成的
 *    上下文文件会让成功率降 2-3%、成本升 20%+）；
 * 2. **递归查找每一级 AGENTS.md**，最近的优先，并标注出处 `# From <path>`；
 * 3. 篇幅有护栏（默认 600 行），超了**如实截断并标注**，不静默丢；
 * 4. 长期记忆是 **append-only 的带日期 bullet**（NOTES.md），
 *    硬上限 200 行 / 25KB，**超出丢最旧**；
 * 5. 压缩走「**滚动摘要**」：任务结束用一句话替代原始对话，而不是逐行压缩历史
 *    （逐行压缩会破坏隐藏推理与缓存前缀 —— 见卡片 013）。
 */

export const PROJECT_INSTRUCTION_FILE = 'AGENTS.md';
export const NOTES_DIR = '.jujia';
export const NOTES_FILE = 'NOTES.md';

/** 护栏：AGENTS.md 超过该行数就截断并标注（业界建议 <300 行，护栏 600） */
export const PROJECT_CONTEXT_MAX_LINES = 600;
/** 长期记忆硬上限 */
export const NOTES_MAX_LINES = 200;
export const NOTES_MAX_BYTES = 25_000;

export interface LoadedFile {
  /** 相对工作区的路径 */
  from: string;
  content: string;
  truncated: boolean;
  lines: number;
}

export interface ProjectContext {
  files: LoadedFile[];
  /** 拼装好的文本（已带 `# From <path>` 出处）；无文件时为空串 */
  text: string;
  /** 是否发生过截断 */
  truncated: boolean;
}

/** 判断是否为「不可见逻辑」之外的噪声行（技术栈/目录说明类），用于给出提示而非删除 */
const NOISE_HINT = /^(this is a|这是(一个)?)\s*(react|vue|node|python|spring|typescript)/i;

/**
 * 递归查找并加载工作区内的 AGENTS.md。
 *
 * 顺序：**根目录优先**（root-most first），越靠近当前目录的越靠后（优先级越高）。
 * 不自动生成、不自动改写用户文件 —— 这一点是刻意的：自动生成反而降低效果。
 */
export async function loadProjectContext(
  workspaceRoot: string,
  maxLines = PROJECT_CONTEXT_MAX_LINES,
): Promise<ProjectContext> {
  const found = await findInstructionFiles(workspaceRoot);
  const files: LoadedFile[] = [];
  let remaining = maxLines;
  let truncated = false;

  for (const abs of found) {
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const raw = await readFile(abs, 'utf8').catch(() => '');
    if (raw.trim() === '') continue;
    const allLines = raw.split(/\r?\n/);
    const take = allLines.slice(0, Math.max(0, remaining));
    const cut = take.length < allLines.length;
    if (cut) truncated = true;
    remaining -= take.length;
    files.push({
      from: relative(workspaceRoot, abs).split(sep).join('/'),
      content: take.join('\n'),
      truncated: cut,
      lines: take.length,
    });
  }

  const parts = files.map((f) => {
    const flag = f.truncated ? '\n（本文件因超出注入上限被截断）' : '';
    return `# From ${f.from}${flag}\n${f.content}`;
  });

  return {
    files,
    text: parts.join('\n\n'),
    truncated,
  };
}

/** 广度优先、逐层向下找 AGENTS.md；根目录优先 */
async function findInstructionFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const queue: string[] = [root];
  let guard = 0;
  while (queue.length > 0 && guard < 200) {
    guard += 1;
    const dir = queue.shift() as string;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const names = new Set(entries.map((e) => e.name));
    if (names.has(PROJECT_INSTRUCTION_FILE)) {
      out.push(join(dir, PROJECT_INSTRUCTION_FILE));
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      // 跳过明显的重型目录，避免无谓遍历
      if (['node_modules', '.git', 'out', 'dist', '.trash', '.jujia'].includes(e.name)) continue;
      queue.push(join(dir, e.name));
    }
  }
  return out;
}

export interface NotesState {
  text: string;
  lines: number;
  bytes: number;
  /** 是否因超出上限发生过裁剪（真删掉了最旧的条目） */
  trimmed: boolean;
}

function notesPath(workspaceRoot: string): string {
  return join(workspaceRoot, NOTES_DIR, NOTES_FILE);
}

/** 读取长期记忆（NOTES.md）；超上限时**丢最旧**并报告 trimmed */
export async function loadNotes(
  workspaceRoot: string,
  maxLines = NOTES_MAX_LINES,
  maxBytes = NOTES_MAX_BYTES,
): Promise<NotesState> {
  const raw = await readFile(notesPath(workspaceRoot), 'utf8').catch(() => '');
  if (raw === '') return { text: '', lines: 0, bytes: 0, trimmed: false };

  // 注释行是元数据（如文件头说明），不计入条目数、也不占上限
  let lines = raw
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '' && !l.trim().startsWith('<!--'));
  let trimmed = false;
  while (lines.length > maxLines || Buffer.byteLength(lines.join('\n'), 'utf8') > maxBytes) {
    lines = lines.slice(1);
    trimmed = true;
  }
  // 单独对「单行超长」的极端情况兜底
  let text = lines.join('\n');
  while (Buffer.byteLength(text, 'utf8') > maxBytes && lines.length > 1) {
    lines = lines.slice(1);
    text = lines.join('\n');
    trimmed = true;
  }
  return { text, lines: lines.length, bytes: Buffer.byteLength(text, 'utf8'), trimmed };
}

/**
 * 追加一条带日期的记忆（append-only）。
 *
 * **写入前先过路径守卫**（M6 接线时补的）：目标虽然是模块自己拼出来的 `.jujia/NOTES.md`，
 * 但"工作区根"是外部输入，而且符号链接 / junction 能让一个看起来在工作区内的路径
 * 实际落到外面 —— 长期记忆是一份会被反复注入给模型的文件，绝不能变成"任意路径写盘"的口子。
 * 越界一律抛 `ToolError('path_denied')`，调用方（工具执行器）把它当成一次失败的写入报给用户。
 */
export async function appendNote(
  workspaceRoot: string,
  summary: string,
  now: Date = new Date(),
): Promise<boolean> {
  const clean = summary.replace(/\s+/g, ' ').trim();
  if (clean === '') return false;
  const day = now.toISOString().slice(0, 10);
  const path = await guardPath(workspaceRoot, join(NOTES_DIR, NOTES_FILE));
  await mkdir(dirname(path), { recursive: true });
  const header = '<!-- 俱佳Agent 长期记忆：append-only，带日期；超出上限丢最旧 -->\n';
  const existed = await readFile(path, 'utf8').catch(() => null);
  if (existed === null) await writeFile(path, header, 'utf8');
  await appendFile(path, `- ${day}: ${clean}\n`, 'utf8');
  return true;
}

/**
 * 纯函数：把各层记忆拼成系统提示。
 *
 * 分层顺序（越靠后越靠近模型当前注意力）：基础人格 → 项目指令 → 长期记忆。
 * 每一层都**标注来源**，便于用户核查「模型为什么这么说」。
 */
export interface MemoryLayers {
  base: string;
  project?: string | undefined;
  notes?: string | undefined;
}

export function assembleSystemPrompt(layers: MemoryLayers): string {
  const parts: string[] = [layers.base.trim()];
  if (layers.project && layers.project.trim() !== '') {
    parts.push(`## 项目指令（来自工作区 AGENTS.md）\n${layers.project.trim()}`);
  }
  if (layers.notes && layers.notes.trim() !== '') {
    parts.push(`## 长期记忆（来自本工作区的 .jujia/NOTES.md，带日期）\n${layers.notes.trim()}`);
  }
  return parts.join('\n\n');
}

/** 给用户的提示：AGENTS.md 里出现「技术栈/目录介绍」这类 agent 自己能读出来的内容 */
export function projectContextHints(text: string): string[] {
  const hints: string[] = [];
  const lines = text.split('\n');
  const noisy = lines.filter((l) => NOISE_HINT.test(l.trim()));
  if (noisy.length > 0) {
    hints.push(
      `检测到 ${noisy.length} 行「技术栈/项目介绍」类内容。AGENTS.md 建议只写**不可见的约束**` +
        '（如「/legacy 被 CI 依赖，别删」），技术栈与目录结构 agent 自己读得出来，重复注入会稀释注意力。',
    );
  }
  if (lines.length >= PROJECT_CONTEXT_MAX_LINES) {
    hints.push(`AGENTS.md 已达注入上限（${PROJECT_CONTEXT_MAX_LINES} 行），建议拆分或精简。`);
  }
  return hints;
}
