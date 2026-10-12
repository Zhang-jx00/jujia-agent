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
/**
 * M7 · R9：`hydrateSession` 与"装不回来要带出 warning"这一段，从 `ipc/chat.ts`
 * 搬进了 `ipc/turn-trigger.ts`（定时任务与用户敲字共用一个起轮入口）。
 * 判据一字未改，只是跟着搬：catch 在触发器里、`warning` 仍必须一路送到返回值。
 */
const turnTrigger = read('ipc', 'turn-trigger.ts');
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
    // hydrate 这一句跟着"起一轮"搬进了 turn-trigger —— 判据不变：**发问之前必须先把历史装回来**
    expect(turnTrigger).toContain('await hydrateSession(sid, connectionId)');
    expect(turnTrigger.indexOf('await hydrateSession(sid, connectionId)')).toBeLessThan(
      turnTrigger.indexOf('sendMessage('),
    );
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

describe('历史分页口径只剩一处（外部审查 T33 / T34）', () => {
  it('chat-service 把窗口与计数交给纯函数，自己不再算 limit、不再切数组', () => {
    const body = chatService.slice(chatService.indexOf('export async function historyPage'));
    const fn = body.slice(0, body.indexOf('\nexport '));
    expect(fn).toContain('pickHistoryPage(all, opts)');
    // 反向锁：调用点自己算窗口 = 口径重新分叉，正是 T33 的病根本身
    expect(fn).not.toMatch(/Math\.max\(\s*end\s*-\s*limit/);
    expect(fn).not.toContain('opts.limit ?? 120');
    expect(chatService).toContain("from './history-window'");
  });

  it('界面用可见历史数组的起始下标当 key 偏移，页内下标那套不许回来', () => {
    expect(panel).toContain('toHistoryBubbles(page.messages, page.hasMore)');
    expect(panel).not.toMatch(/id: `h-\$\{String\(i\)\}-/);
    expect(panel).toContain("from './history-bubbles'");
  });

  it('翻到一页没有可显示内容时必须有一行话，换会话时清掉', () => {
    expect(panel).toContain('olderPageNotice({');
    expect(panel).toContain('{pageHint !== null &&');
    expect(panel).toContain('setPageHint(null)');
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
    // 计数只剩一处：Journal 持有。`Session` 上不许再挂一份，读也必须走 `journal.persistedCount(...)`
    // （6b 的水印就用这个坐标 —— 它是"落盘行号"的唯一权威，另算一个数就会有两套坐标）
    expect(chatService).not.toMatch(/(^\s*|[,{])persistedCount\??\s*:/m);
    const everyRead = chatService.match(/persistedCount/g) ?? [];
    const viaJournal = chatService.match(/journal\.persistedCount\(/g) ?? [];
    expect(everyRead.length).toBe(viaJournal.length);
    expect(chatService).not.toContain('store().record(');
  });

  it('装回来的会话把账对齐到盘上已有条数（否则第一flush就会重放历史）', () => {
    expect(chatService).toContain('journal.restored(sessionId, loaded.messages.length)');
  });

  it('hydrate 失败必须带出提示：既 catch 了，也把 warning 送进返回值', () => {
    // catch 与那句话在 turn-trigger（起轮的汇聚点），送进通道返回值那一跳在 ipc/chat.ts ——
    // 这条链**两环都要钉**：只钉一端的话，中间丢了 warning 照样全绿（T35 同族：接线锁要钉住每一环）
    expect(turnTrigger).toContain('历史未能恢复，这一轮从空上下文继续');
    expect(turnTrigger).toContain('return { ...result, warning }');
    expect(chatIpc).toContain('warning: result.warning');
    // 反向锁：以前那行"吞掉错误"的写法不许回来
    expect(turnTrigger).not.toMatch(/hydrateSession\([^)]*\)\.catch\(\(\) => undefined\)/);
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
