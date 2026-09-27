import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 会话持久化（6a）的接线锁。
 *
 * 这里要拦的是两类"看起来做了"的形状：
 * ① 存储层写好了但**没人调** —— 于是重启照样丢，而单测全绿（M6 那条 `appendNote` 的同款事故）；
 * ② 把"分页"实现成"前端数组再切一刀" —— 数据其实全在内存里，规模上界没变，只是不显示。
 */

const here = dirname(fileURLToPath(import.meta.url));
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = (...rel: string[]): string => strip(readFileSync(join(here, ...rel), 'utf8'));

const chatService = read('chat-service.ts');
const chatIpc = read('ipc', 'chat.ts');
const preload = read('..', 'preload', 'index.ts');
const panel = read('..', 'renderer', 'src', 'features', 'chat', 'ChatPanel.tsx');
const policy = read('..', '..', '..', '..', 'packages', 'agent-core', 'src', 'permissions', 'policy.ts');
const executor = read('..', '..', '..', '..', 'packages', 'agent-core', 'src', 'tools', 'executor.ts');

describe('存储层确实被用（不是躺在文件里的死代码）', () => {
  it('一轮结束时落盘、重启后能装回内存、清单与分页都读磁盘', () => {
    expect(chatService).toContain('await flushSession(session)');
    expect(chatService).toContain('export async function hydrateSession');
    expect(chatService).toContain('export async function historyPage');
    expect(chatService).toContain('export async function listSessions');
    expect(chatService).toContain('sessions.delete(victim)');
    // 淘汰前先把没写完的部分保住（卸载 ≠ 删除）
    expect(chatService).toContain('if (doomed !== undefined && !doomed.running) void flushSession(doomed)');
  });

  it('system 那条不入库（每轮重新装配，存下来只会留下旧版本副本）', () => {
    expect(chatService).toContain("s.messages.filter((m) => m.role !== 'system')");
  });

  it('IPC 层把三条能力接上，且发送前先 hydrate', () => {
    expect(chatIpc).toContain('handle(IPC.CHAT_LIST,');
    expect(chatIpc).toContain('historyPage(sessionId, page)');
    expect(chatIpc).toContain('await hydrateSession(sessionId, connectionId)');
  });

  it('预加载桥暴露的是具体方法（不泄漏 ipcRenderer 本体）', () => {
    expect(preload).toContain('async chatList()');
    expect(preload).toContain('async chatHistory(query: ChatHistoryQuery)');
    expect(preload).toContain('chatHistoryPageSchema.parse(');
  });

  it('界面往前翻时**先读磁盘**，读完了才放宽渲染窗口', () => {
    expect(panel).toContain('chatHistory({ sessionId, before, limit: 120 })');
    expect(panel).toContain('if (loadedFrom <= 0) {');
    expect(panel).toContain('resume(pickId)');
  });
});

describe('记忆与权限判定之间不给入口（6a 追加验收，防跨会话持久注入）', () => {
  it('权限策略与工具执行器都不读笔记 / 不引记忆模块', () => {
    for (const [name, src] of [
      ['policy.ts', policy],
      ['executor.ts', executor],
    ] as const) {
      expect(src, name).not.toMatch(/loadNotes|NOTES\.md|appendNote|notes\b/);
    }
  });
});

describe('落盘记账与"历史没装回来"不许静默（外部审查 T6）', () => {
  it('chat-service 用 session-journal 管计数，自己不再算"新增了什么"', () => {
    expect(chatService).toContain("from './session-journal'");
    expect(chatService).toContain('await journal.flush(s.id, all.map(toStored)');
    // 计数只剩一处：Session 上不再挂 persistedCount（两处记账迟早对不上）
    expect(chatService).not.toContain('persistedCount');
    expect(chatService).not.toContain('store().record(');
  });

  it('装回来的会话把账对齐到盘上已有条数（否则第一flush就会重放历史）', () => {
    expect(chatService).toContain('journal.restored(sessionId, loaded.messages.length)');
  });

  it('hydrate 失败必须带出提示：既 catch 了，也把 warning 送进返回值', () => {
    expect(chatIpc).toContain('historyWarning');
    expect(chatIpc).toContain('历史未能恢复，这一轮从空上下文继续');
    expect(chatIpc).toContain('warning: historyWarning');
    // 反向锁：以前那行"吞掉错误"的写法不许回来
    expect(chatIpc).not.toMatch(/hydrateSession\([^)]*\)\.catch\(\(\) => undefined\)/);
  });

  it('契约里 warning 是 nullable 而不是 optional（"没提示"与"少传一格"必须是两件事）', () => {
    const here2 = dirname(fileURLToPath(import.meta.url));
    const contracts = strip(
      readFileSync(join(here2, '..', '..', '..', '..', 'packages', 'shared-ipc', 'src', 'contracts.ts'), 'utf8'),
    );
    const block = contracts.slice(
      contracts.indexOf('export const chatSendResultSchema'),
      contracts.indexOf('export type ChatSendResult'),
    );
    expect(block).toContain('warning: z.string().nullable()');
  });

  it('界面真的把这条提示画出来（不是只塞进返回值没人看）', () => {
    expect(panel).toContain('setHistoryHint(res.warning)');
    expect(panel).toContain('{historyHint !== null &&');
    expect(panel).toContain('role="alert"');
  });
});
