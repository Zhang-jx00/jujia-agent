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
