import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { displayPath, guardPath } from '../path-guard';
import { ToolError, type StoredTool, type ToolDefinition, type ToolOutcome } from '../types';

/** 单次读取上限：超出即截断**并如实标注**，绝不假装内容完整 */
export const MAX_READ_BYTES = 256 * 1024;
/** 单次写入上限，防止模型一次写爆磁盘 */
export const MAX_WRITE_BYTES = 2 * 1024 * 1024;

// 注意：可选键显式写 `| undefined` —— zod 的 parse 结果在 exactOptionalPropertyTypes 下
// 会带上显式 undefined，不写会导致赋值不被接受（2026-09-18 实测）
export const readFileTool: ToolDefinition<{ path: string; maxBytes?: number | undefined }> = {
  name: 'read_file',
  description:
    '读取工作区内的文本文件。路径建议使用绝对路径；返回内容可能因大小上限被截断。',
  kind: 'read',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径（工作区内）' },
      maxBytes: { type: 'number', description: `最多读取的字节数，默认 ${MAX_READ_BYTES}` },
    },
    required: ['path'],
    additionalProperties: false,
  },
  // .strict()：JSON Schema 声明了 additionalProperties:false，parse 就必须真的拒绝（K-1 的同类隐患，
  // 与 exec-tool 一起补齐 —— 声明与执行两套口径 = 每天都在的注入面）
  parse: (raw) =>
    z
      .object({ path: z.string().min(1), maxBytes: z.number().int().positive().optional() })
      .strict()
      .parse(raw),
  async run(args, ctx): Promise<ToolOutcome> {
    const abs = await guardPath(ctx.workspaceRoot, args.path);
    const limit = Math.min(args.maxBytes ?? MAX_READ_BYTES, MAX_READ_BYTES);

    const info = await stat(abs).catch(() => null);
    if (!info) throw new ToolError('not_found', `文件不存在：${displayPath(ctx.workspaceRoot, abs)}`);
    if (info.isDirectory()) {
      throw new ToolError('invalid_args', `这是一个目录，请改用 list_dir：${displayPath(ctx.workspaceRoot, abs)}`);
    }

    const buf = await readFile(abs);
    const truncated = buf.byteLength > limit;
    const text = buf.subarray(0, limit).toString('utf8');

    return {
      ok: true,
      content: truncated
        ? `${text}\n\n[已截断：文件共 ${buf.byteLength} 字节，只读取了前 ${limit} 字节]`
        : text,
      evidence: {
        bytes: buf.byteLength,
        paths: [abs],
        ...(truncated ? { truncated: true } : {}),
      },
    };
  },
};

export const writeFileTool: ToolDefinition<{ path: string; content: string }> = {
  name: 'write_file',
  description: '把内容写入工作区内的文件（覆盖已有内容；目录会自动创建）。',
  kind: 'write',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径（工作区内）' },
      content: { type: 'string', description: '要写入的完整内容' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  parse: (raw) => z.object({ path: z.string().min(1), content: z.string() }).strict().parse(raw),
  async run(args, ctx): Promise<ToolOutcome> {
    const abs = await guardPath(ctx.workspaceRoot, args.path);
    const bytes = Buffer.byteLength(args.content, 'utf8');
    if (bytes > MAX_WRITE_BYTES) {
      throw new ToolError(
        'too_large',
        `内容过大（${bytes} 字节，上限 ${MAX_WRITE_BYTES}），请拆分后再写`,
      );
    }

    const existed = (await stat(abs).catch(() => null)) !== null;
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, args.content, 'utf8');

    const rel = displayPath(ctx.workspaceRoot, abs);
    return {
      ok: true,
      content: `${existed ? '已覆盖' : '已创建'}：${rel}（${bytes} 字节）`,
      evidence: { bytes, paths: [abs] },
    };
  },
};

export const listDirTool: ToolDefinition<{
  path?: string | undefined;
  maxEntries?: number | undefined;
}> = {
  name: 'list_dir',
  description: '列出工作区内某个目录的直接子项（不递归）。',
  kind: 'read',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '目录路径，默认工作区根目录' },
      // 可选上限：文件树（M19）用它防"十万个名字跨进程传过来"。
      // **不传 = 列全部** —— 模型今天的行为一字不改。
      maxEntries: { type: 'number', description: '最多返回多少项；不传=全部' },
    },
    required: [],
    additionalProperties: false,
  },
  parse: (raw) =>
    z
      .object({ path: z.string().optional(), maxEntries: z.number().int().positive().optional() })
      .strict()
      .parse(raw ?? {}),
  async run(args, ctx): Promise<ToolOutcome> {
    const abs = await guardPath(ctx.workspaceRoot, args.path ?? '.');
    const info = await stat(abs).catch(() => null);
    if (!info || !info.isDirectory()) {
      throw new ToolError('not_found', `目录不存在：${displayPath(ctx.workspaceRoot, abs)}`);
    }

    const entries = await readdir(abs, { withFileTypes: true });
    const sorted = entries
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));

    const cap = args.maxEntries;
    const shown = cap === undefined ? sorted : sorted.slice(0, cap);
    const clipped = shown.length < sorted.length;
    const body = shown.length > 0 ? shown.join('\n') : '（空目录）';

    return {
      ok: true,
      // 截断就如实说：这句标注界面与模型看到的是同一句，不各写一套
      content: clipped
        ? `${body}\n（共 ${String(sorted.length)} 项，只显示了前 ${String(shown.length)} 项）`
        : body,
      evidence: { paths: [abs] },
    };
  },
};

/** 内置文件工具集合（后续阶段的 run_command / git 等按同一契约追加） */
export const FILE_TOOLS: ReadonlyArray<StoredTool> = [readFileTool, writeFileTool, listDirTool];

/** 供测试用：拼接工作区内的路径 */
export function pathIn(workspaceRoot: string, ...parts: string[]): string {
  return join(workspaceRoot, ...parts);
}
