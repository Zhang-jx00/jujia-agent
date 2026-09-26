import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runTool, type PermissionDecision, type PermissionRequest } from '../executor';
import { ToolError, type ToolContext } from '../types';
import { createDefaultRegistry } from '../registry';
import { appendNoteTool, NOTE_MAX_CHARS } from './note-tool';
import { loadNotes } from '../../memory/memory';

/**
 * `append_note` 的验收（M6 记忆写入侧接线）。
 *
 * 这个工具的"正确"只有两件事可验证，两件都围绕**副作用到底发没发生**：
 * ① 批准之后 `.jujia/NOTES.md` 里**真的多了一行**（读盘为证，不看返回值颜色）；
 * ② 拒绝 / 越界 / 非法输入时**磁盘上什么都没发生**（连文件都不该被创建）。
 * 另外三条是这条写路径的边界：写类必须问人、路径守卫必须在写之前、内容长度有上限。
 */

let root = '';
let asked: PermissionRequest[] = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'jujia-note-tool-'));
  asked = [];
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const ctx = (workspaceRoot: string = root): ToolContext => ({ workspaceRoot });

const resolver =
  (decision: PermissionDecision) =>
  (req: PermissionRequest): Promise<PermissionDecision> => {
    asked.push(req);
    return Promise.resolve(decision);
  };

async function notesOnDisk(): Promise<string | null> {
  return readFile(join(root, '.jujia', 'NOTES.md'), 'utf8').catch(() => null);
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

describe('写入真的发生（真值在磁盘上）', () => {
  it('批准后：文件里真的有一行「日期: 内容」', async () => {
    const r = await runTool(appendNoteTool, { text: '用户偏好中文注释' }, ctx(), resolver('allow_once'));
    expect(r.outcome.ok).toBe(true);
    const text = await notesOnDisk();
    expect(text).not.toBeNull();
    expect(text).toMatch(/^- \d{4}-\d{2}-\d{2}: 用户偏好中文注释$/m);
    // 一次问过（写类不能不问就做）
    expect(asked.length).toBe(1);
    expect(asked[0]?.toolName).toBe('append_note');
    expect(asked[0]?.kind).toBe('write');
  });

  it('连写两条：顺序即时间顺序（append-only，不覆盖）', async () => {
    await runTool(appendNoteTool, { text: '第一条' }, ctx(), resolver('allow_once'));
    await runTool(appendNoteTool, { text: '第二条' }, ctx(), resolver('allow_once'));
    const text = (await notesOnDisk()) ?? '';
    expect(text.indexOf('第一条')).toBeLessThan(text.indexOf('第二条'));
    expect(text.split('\n').filter((l) => l.startsWith('- ')).length).toBe(2);
  });

  it('写完能被读侧读回来（写入侧与注入侧是同一份文件，不是两套账）', async () => {
    await runTool(appendNoteTool, { text: '部署目标是内网 Windows' }, ctx(), resolver('allow_once'));
    const notes = await loadNotes(root);
    expect(notes.text).toContain('部署目标是内网 Windows');
    expect(notes.lines).toBe(1);
  });
});

describe('不写的时候，磁盘上必须什么都没有', () => {
  it('用户拒绝 → 文件根本没被创建', async () => {
    const r = await runTool(appendNoteTool, { text: '别记这个' }, ctx(), resolver('deny'));
    expect(r.outcome.ok).toBe(false);
    expect(await exists(join(root, '.jujia'))).toBe(false);
    expect(await notesOnDisk()).toBeNull();
  });

  it('超时同样零副作用', async () => {
    await runTool(appendNoteTool, { text: '超时的那条' }, ctx(), resolver('timeout'));
    expect(await notesOnDisk()).toBeNull();
  });

  it('权限策略直接 deny（不问人也不写）', async () => {
    const r = await runTool(
      appendNoteTool,
      { text: '被策略拦下' },
      ctx(),
      resolver('allow_once'),
      { mode: 'dontAsk' },
    );
    expect(r.outcome.ok).toBe(false);
    expect(asked.length).toBe(0);
    expect(await notesOnDisk()).toBeNull();
  });
});

describe('路径守卫：在写之前就把越界挡掉', () => {
  it('工作区根不存在 → 拒绝，且不会"顺手"把目录创建出来', async () => {
    const missing = join(root, 'never-created');
    const r = await runTool(appendNoteTool, { text: '越界' }, ctx(missing), resolver('allow_once'));
    expect(r.outcome.ok).toBe(false);
    expect(await exists(missing)).toBe(false);
  });

  it('工作区根是个文件 → 拒绝（守卫不看运气）', async () => {
    const asFile = join(root, 'not-a-dir.txt');
    await writeFile(asFile, 'x', 'utf8');
    const r = await runTool(appendNoteTool, { text: '越界' }, ctx(asFile), resolver('allow_once'));
    expect(r.outcome.ok).toBe(false);
  });

  it('appendNote 自己也要拦越界（不依赖调用方先守卫）—— 直接调函数验证', async () => {
    const { appendNote } = await import('../../memory/memory');
    await expect(appendNote(join(root, 'nope'), '一条记忆')).rejects.toThrow(/path_denied|工作区|真实路径|拒绝/);
  });

  it('工具里守卫确实在 appendNote 之前（顺序错的话会先创建目录）', async () => {
    const missing = join(root, 'second-check');
    await runTool(appendNoteTool, { text: '顺序验证' }, ctx(missing), resolver('allow_once'));
    expect(await exists(join(missing, '.jujia'))).toBe(false);
  });
});

describe('输入边界', () => {
  it('纯空白内容：不写，并给出可读回执（不是假装成功）', async () => {
    const r = await runTool(appendNoteTool, { text: '   \n  ' }, ctx(), resolver('allow_once'));
    expect(r.outcome.ok).toBe(false);
    expect(r.outcome.content).toContain('未改动');
    expect(await notesOnDisk()).toBeNull();
  });

  it('超长内容被 parse 拒绝（拿记忆搬运大段内容不是本工具的能力）', () => {
    expect(() => appendNoteTool.parse({ text: 'x'.repeat(NOTE_MAX_CHARS + 1) })).toThrow();
  });

  it('多余字段被拒：JSON Schema 声明 additionalProperties:false，parse 必须真的拒', () => {
    expect(() => appendNoteTool.parse({ text: '一条', path: '../../evil' })).toThrow();
  });

  it('schema 与 parse 的口径一致（声明与执行不能两套）', () => {
    expect(appendNoteTool.parameters.additionalProperties).toBe(false);
    expect(appendNoteTool.parameters.required).toEqual(['text']);
  });
});

describe('注册与档位', () => {
  it('默认注册表里有 append_note（否则模型与界面都调不到）', () => {
    const registry = createDefaultRegistry();
    expect(registry.get('append_note')?.name).toBe('append_note');
  });

  it('kind 是 write（不是 read）：读侧自动放行，写侧必须问人', async () => {
    expect(appendNoteTool.kind).toBe('write');
    await runTool(appendNoteTool, { text: '档位验证' }, ctx(), resolver('allow_once'));
    expect(asked[0]?.kind).toBe('write');
  });

  it('越界抛的是 path_denied（错误类型稳定，界面才给得出准确理由）', async () => {
    const err = await appendNoteTool
      .run({ text: '直接调用' }, ctx(join(root, 'missing-dir')))
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).code).toBe('path_denied');
  });
});
