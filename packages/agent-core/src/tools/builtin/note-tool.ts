import { z } from 'zod';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { appendNote, NOTES_DIR, NOTES_FILE } from '../../memory/memory';
import { guardPath, displayPath } from '../path-guard';
import type { StoredTool, ToolDefinition, ToolOutcome } from '../types';

/**
 * `append_note`：把一句话写进工作区内的长期记忆（`.jujia/NOTES.md`，append-only、带日期）。
 *
 * **为什么做成工具，而不是新开一条 IPC 通道**：这条动作的三件要件 ——
 * 权限门（写类要问人）、路径守卫（越界必须拒）、审计与弹窗摘要 —— 全都在
 * `tools/executor.ts` 的 `runTool` 里实现并测过了。再写一条 `memory:append-note`
 * 就是给同一件事配第二套口径：两边一漂，"不问了"或"守卫没跑"就会从缝里长出来
 * （本项目为此专门有一条"唯一判档处"的规矩）。界面按钮与模型提议因此**共用同一条链路**。
 *
 * **顺序要紧**：守卫在 `appendNote` 之前跑。越界时连文件都不会被创建，
 * 而不是"写完了再报错" —— 后者等于已经污染了磁盘。
 *
 * 描述里那句"只在用户明确要求时使用"是**行为约束**，不是装饰：
 * 模型若能自行决定"这条聊天值得记"，长期记忆就会被聊天流水灌满（`knowledge/cards/015` 里
 * 把它叫 context sludge）。写入时机由人发起，这一条靠界面按钮 + 描述 + 权限门三层共同兜住。
 */

/** 单条记忆的长度上限：比一条笔记长、比一段对话短，防止有人拿它搬运内容 */
export const NOTE_MAX_CHARS = 500;

export const appendNoteTool: ToolDefinition<{ text: string }> = {
  name: 'append_note',
  description:
    '把**一句话**追加到工作区内的长期记忆文件（.jujia/NOTES.md，带日期、append-only、超上限丢最旧）。' +
    '只在用户明确要求"记住这件事"时使用；不要主动把聊天内容写进来。',
  kind: 'write',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: `要记住的那一句话（不超过 ${String(NOTE_MAX_CHARS)} 字，会被压成单行）`,
      },
    },
    required: ['text'],
    additionalProperties: false,
  },
  parse: (raw) =>
    z
      .object({ text: z.string().min(1).max(NOTE_MAX_CHARS) })
      .strict()
      .parse(raw),
  async run(args, ctx): Promise<ToolOutcome> {
    const relTarget = join(NOTES_DIR, NOTES_FILE);
    // ① 先守卫：不通过就抛 path_denied，后面那一步根本不会执行
    const target = await guardPath(ctx.workspaceRoot, relTarget);
    // ② 写之前的字节数只为给出"这次真的追加了"的诚实回执（读不到按 0 算）
    const before = await readFile(target, 'utf8').catch(() => '');

    const wrote = await appendNote(ctx.workspaceRoot, args.text);
    if (!wrote) {
      return {
        ok: false,
        content: `没有写入：内容压成单行之后是空的（${displayPath(ctx.workspaceRoot, target)} 未改动）`,
      };
    }
    return {
      ok: true,
      content: `已写入长期记忆：${displayPath(ctx.workspaceRoot, target)}（追加 1 条，原有 ${String(before.split(/\r?\n/).filter((l) => l.trim() !== '').length)} 行）`,
      evidence: { paths: [target], bytes: Buffer.byteLength(args.text, 'utf8') },
    };
  },
};

export const NOTE_TOOLS: ReadonlyArray<StoredTool> = [appendNoteTool as unknown as StoredTool];
