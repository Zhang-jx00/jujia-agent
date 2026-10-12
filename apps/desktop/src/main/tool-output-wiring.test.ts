import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 实时输出的**整条链**接线锁（R8.7 · M4 收尾其三）。
 *
 * 各段自己都有测试（工具层 / 循环层 / 契约层 / 中转层 / 界面层），这里只回答一个问题：
 * **这一条链是不是真的从头接到尾**。本轮最典型的失败形态不是"哪一段写错了"，
 * 而是"某一段忘了接" —— 而它恰恰是全绿最安静的形状：契约里没有这一类事件时，
 * preload 会把它当"不合契约的流式事件"丢掉，界面上就是"实时输出这一格从来不出现"。
 *
 * 判据一律现扫源码、按区间判定（不写死清单、不按"文件里出现过"下结论 —— 那是被 M7 教育过的错法）。
 */

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const EXEC = strip(read('../../../../packages/agent-core/src/tools/builtin/exec-tool.ts'));
const LOOP = strip(read('../../../../packages/agent-core/src/loop/agent-loop.ts'));
const CHAT = strip(read('./chat-service.ts'));
const RELAY = strip(read('./tool-output-relay.ts'));
const CONTRACTS = strip(read('../../../../packages/shared-ipc/src/contracts.ts'));
const PUMP = strip(read('../../../../packages/agent-core/src/tools/output-pump.ts'));
const PANEL = strip(read('../renderer/src/features/chat/ChatPanel.tsx'));
const CARD = strip(read('../renderer/src/features/chat/ToolCard.tsx'));
const HISTORY = strip(read('../renderer/src/features/chat/history-bubbles.ts'));

describe('实时输出的链条', () => {
  it('工具层：每条流都把块交给通道，且到达上限时说明一次为什么后面不滚了', () => {
    expect(EXEC).toContain('ctx.onToolOutput?.(text)');
    expect(EXEC).toContain('ctx.onToolOutput?.(EXEC_STREAM_STOP_NOTICE)');
    // 上限判据仍然长在原来那一处（字节数、追加之后判）—— 不能因为加了流就挪走守卫
    expect(EXEC).toContain('if (Buffer.byteLength(stdout, \'utf8\') > MAX_EXEC_OUTPUT_BYTES)');
  });

  it('循环层：只加一个出口，不在这里加工内容', () => {
    // 只数"事件从这里发出去"那一处（类型联合里也写了这个名字，不能按名字计数）
    const emitters = (LOOP.match(/params\.emit\(\{ type: 'tool_output'/g) ?? []).length;
    expect(emitters).toBe(1);
    expect(LOOP).toContain('{ workspaceRoot: deps.workspaceRoot, onToolOutput: onOutput }');
    expect(LOOP).toContain("if (text === '') return;");
  });

  it('中转层：尾部上限复用终端那份 trimTail，不在这里再写一份切片', () => {
    expect(PUMP).toContain('trimTail(tail, batch, options.maxTailChars)');
    expect(PUMP).toContain("import { trimTail } from '../terminal/terminal'");
    // 攒批与快照只有一处定义：中转层自己不碰内容
    expect(RELAY).not.toContain('slice(');
  });

  it('服务层：三类工具事件都接上，且收尾顺序与真实发生顺序一致', () => {
    const chunkAt = CHAT.indexOf("outputStreams.onChunk(ev.callId, ev.name, ev.chunk)");
    const endAt = CHAT.indexOf('outputStreams.onEnd(ev.callId)');
    const toolEndEmit = CHAT.indexOf("type: 'tool_end'");
    expect(chunkAt).toBeGreaterThan(-1);
    expect(endAt).toBeGreaterThan(-1);
    // 先补发尾巴、再发 tool_end —— 反过来的话界面会先看到"完成"再冒出一段输出
    expect(endAt).toBeLessThan(toolEndEmit);
    // closeAll 必须在 finally 里（用户停止 / 出错都走这条路）
    const finallyAt = CHAT.indexOf('} finally {');
    const closeAllAt = CHAT.indexOf('outputStreams.closeAll()');
    expect(finallyAt).toBeGreaterThan(-1);
    expect(closeAllAt).toBeGreaterThan(finallyAt);
  });

  it('契约层与界面层都认这一类事件（少任何一环都是静默失败）', () => {
    expect(CONTRACTS).toContain("type: z.literal('tool_output')");
    expect(CONTRACTS).toContain('tail: z.string().max(TOOL_OUTPUT_TAIL_CHARS)');
    expect(PANEL).toContain("if (event.type === 'tool_output')");
    expect(CARD).toContain('data-tool-tail={data.callId}');
  });

  it('半截输出不持久化：历史气泡的映射里没有 tail 这一格（喂模型的永远是跑完那一份）', () => {
    // 判据取"对象键"形态而不是"出现过 tail 这个词"—— 那个文件里本来就有叫 tail 的局部变量
    expect(HISTORY).not.toMatch(/\btail\s*:/);
  });
});
