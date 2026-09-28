import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 记忆写入侧（M6）的接线锁。
 *
 * 三件事各钉一颗钉子，全都是"改一行就悄悄破掉"的类型：
 * ① `appendNote` 真的过路径守卫（不是只在文档里说它过了）；
 * ② 工具真的注册进默认注册表（否则界面与模型都调不到，而单测照样绿）；
 * ③ **写入只能由人显式触发** —— 对话页里那条 `append_note` 调用必须待在点击处理函数里，
 *    不允许出现在发送消息的流程中。这是所有者定的红线（"不要每条消息自动写"），
 *    而"自动写"恰恰是最容易在重构时顺手长出来的东西。
 */

const here = dirname(fileURLToPath(import.meta.url));

const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const read = (rel: string[]): string => strip(readFileSync(join(here, ...rel), 'utf8'));

const memorySource = read(['..', '..', '..', '..', 'packages', 'agent-core', 'src', 'memory', 'memory.ts']);
const toolSource = read(['..', '..', '..', '..', 'packages', 'agent-core', 'src', 'tools', 'builtin', 'note-tool.ts']);
const registrySource = read(['..', '..', '..', '..', 'packages', 'agent-core', 'src', 'tools', 'registry.ts']);
const chatSource = read(['..', 'renderer', 'src', 'features', 'chat', 'ChatPanel.tsx']);

describe('写入侧的地基', () => {
  it('appendNote 内部真的调路径守卫', () => {
    expect(memorySource).toContain("guardPath(workspaceRoot, join(NOTES_DIR, NOTES_FILE))");
    expect(memorySource).toContain("from '../tools/path-guard'");
  });

  it('工具里守卫在 appendNote 之前（越界时连目录都不该被创建）', () => {
    const runBody = toolSource.slice(toolSource.indexOf('async run(args, ctx)'));
    expect(runBody.indexOf('guardPath(')).toBeLessThan(runBody.indexOf('appendNote('));
  });

  it('工具注册进默认注册表（不注册 = 界面上有按钮但调不动）', () => {
    expect(registrySource).toContain('...NOTE_TOOLS');
    expect(toolSource).toContain("name: 'append_note'");
    expect(toolSource).toContain("kind: 'write'");
  });
});

describe('红线：写入只能由人显式点，不许跟着消息走', () => {
  it('对话页确实把入口挂在按钮上（不是只在文档里写着）', () => {
    expect(chatSource).toContain('记住这一点');
    expect(chatSource).toContain("toolRun('append_note'");
  });

  it('append_note 调用只出现在 remember 这个点击处理函数里', () => {
    const callAt = chatSource.indexOf("toolRun('append_note'");
    expect(callAt).toBeGreaterThan(-1);
    const owner = chatSource.lastIndexOf('async function', callAt);
    expect(chatSource.slice(owner, owner + 40)).toContain('async function remember');
    // 发送消息的函数体里不许出现这条调用
    const sendBody = chatSource.slice(
      chatSource.indexOf('async function send'),
      chatSource.indexOf('async function stop'),
    );
    expect(sendBody).not.toContain('append_note');
  });

  it('按钮只在**已经完成的助手回答**上出现（流式中与出错的气泡不给写入口）', () => {
    const gate = chatSource.slice(
      chatSource.indexOf("{b.role === 'assistant'"),
      chatSource.indexOf('记住这一点'),
    );
    expect(gate).toContain('!b.streaming');
    expect(gate).toContain('b.error === undefined');
    expect(gate).toContain("b.content !== ''");
  });
});

/**
 * 6b 起的**第三个**写入口（报备 §四，批复④已准）。
 *
 * 原来这一句锁的是"全仓只有两处写：界面按钮 + `append_note` 工具"。第三处出现时
 * 不许把那句话擦掉继续跑绿 —— 那正是这条锁存在的意义，所以改成把新出处一起钉住：
 * `chat-service.pendingNoteResolve` 里的那一次 `appendNote` 必须
 * ① 真的走 `appendNote`（= 过路径守卫），不走第二条自造写文件路径；
 * ② 只在 `action === 'remember'` 那一条支上，且在"预览文本为空就拒"之后 ——
 *    这两条一起成立，才等于"永远发生在人点了「记」并且看过内容之后"。
 */
const chatServiceSource = read(['chat-service.ts']);

describe('6b 第三个写入口：退出后补问的「记」', () => {
  it('长期记忆的写函数仍然只有这三处调用者', () => {
    const callers = [memorySource, toolSource, chatServiceSource].reduce(
      (acc, src) => acc + [...src.matchAll(/\bappendNote\(/g)].length,
      0,
    );
    // memory.ts 里是定义 + 工具里 1 次 + chat-service 里 1 次 = 3；多一个就是长了第四个入口
    expect(callers).toBe(3);
  });

  it('这一处仍在 pendingNoteResolve 里面，且走的是 appendNote（不是自己拼路径写文件）', () => {
    const at = chatServiceSource.indexOf('await appendNote(');
    expect(at).toBeGreaterThan(-1);
    const owner = chatServiceSource.lastIndexOf('export async function', at);
    expect(chatServiceSource.slice(owner, owner + 60)).toContain('pendingNoteResolve');
    expect(chatServiceSource).not.toContain('writeFileSync');
  });

  it('「记」之前必须先有非空预览文本：空文本直接拒，等于没看过就不能写', () => {
    const body = chatServiceSource.slice(
      chatServiceSource.indexOf('export async function pendingNoteResolve'),
    );
    const guardAt = body.indexOf("if (body === '') return");
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(body.indexOf('await appendNote('));
    // 三个动作分支都在写入之前返回：never / skip 碰不到 appendNote
    expect(body.indexOf("args.action === 'never'")).toBeLessThan(guardAt);
    expect(body.indexOf("args.action === 'skip'")).toBeLessThan(guardAt);
  });
});
