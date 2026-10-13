import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 6b 的接线锁（报备 `docs/DESIGN-COMPACT.md` 已批，七条裁决 + 两条追加验收）。
 *
 * 为什么又是"读源码"而不是跑起来测：`chat-service` 依赖 electron，vitest 里加载不了
 * （6a 的 `session-journal.ts` 就是因为这个才被抽出去的）。
 * 判阈值、算窗口、拼注入段这些**决策**已经全部沉到纯函数层并被单测与变异钉死了；
 * 这里只剩一件纯函数管不到的事：**接线有没有接对地方** ——
 * 也就是"预览真的不写盘""水印推进与摘要写入真的在同一次成功里""退出真的不调模型"。
 * 这三条每一条都是改一行就悄悄破掉、而单测与 e2e 都可能照常绿的那种。
 */

const here = dirname(fileURLToPath(import.meta.url));
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = (...rel: string[]): string => strip(readFileSync(join(here, ...rel), 'utf8'));

const cs = read('chat-service.ts');
const ipcChat = read('ipc', 'chat.ts');

/**
 * 取某个顶层导出函数的那一段：从声明开始，到下一个顶层 `export` 为止。
 * 注释已被 `strip` 去掉，所以边界只能是代码本身 —— 拿注释当边界会静默变成"整文件"，
 * 那正是最坏的一种假断言：禁什么都在里面，于是要么一直红、要么一直测了个寂寞。
 */
function fnBody(name: string): string {
  const at = cs.indexOf(`export async function ${name}(`);
  expect(at, `找不到函数 ${name}`).toBeGreaterThan(-1);
  const rest = cs.slice(at + 1);
  const end = rest.search(/^export /m);
  return end === -1 ? rest : rest.slice(0, end);
}

describe('A：预览与落盘是两个动作，不是同一个', () => {
  it('compactPreview 里没有任何写盘动作（预览 = 一个字节都不落）', () => {
    const body = fnBody('compactPreview');
    for (const forbidden of ['writeSummary(', 'saveMeta(', '.compactedThrough =']) {
      expect(body, `预览阶段出现了 ${forbidden}`).not.toContain(forbidden);
    }
    // 边界自检：这一段得像一个函数，不像整个文件 —— 边界算错时上面的 not.toContain 全是空转
    expect(body.length).toBeLessThan(2_000);
  });

  it('compactApply：先写摘要，再推内存，最后写元信息 —— 顺序反了就留半状态', () => {
    const body = fnBody('compactApply');
    const write = body.indexOf('await store().writeSummary(');
    const advance = body.indexOf('s.compactedThrough = through');
    const meta = body.indexOf('await store().saveMeta(');
    expect(write).toBeGreaterThan(-1);
    expect(write).toBeLessThan(advance);
    expect(advance).toBeLessThan(meta);
    // 失败必须退回压缩前：内存水印倒回去，且把原因说出来
    const rollback = body.indexOf('s.compactedThrough = previous');
    expect(rollback).toBeGreaterThan(meta);
    expect(body.slice(meta, rollback)).toContain('catch (err');
  });

  it('空摘要在写盘之前就被拒（覆盖了旧摘要等于把早先事实抹成空白）', () => {
    const body = fnBody('compactApply');
    const empty = body.indexOf("if (body === '')");
    expect(empty).toBeGreaterThan(-1);
    expect(empty).toBeLessThan(body.indexOf('await store().writeSummary('));
  });
});

describe('A：发给模型的历史只在一个地方被剪', () => {
  it('整轮只有 buildModelHistory 一处产出请求消息，且 runAgentTurn 用的就是它', () => {
    expect([...cs.matchAll(/buildModelHistory\(/g)]).toHaveLength(1);
    // R14 起出站副本 = 窄化窗口 + 本轮 parts（parts 只挂副本，见 M11 那组锁）；锚点跟到新形状
    expect(/withContentParts\(\s*buildModelHistory\(session\.messages, effectiveThrough\)/.test(cs)).toBe(
      true,
    );
    expect(cs).toContain('messages: outbound,');
    // 直接把完整历史递给 loop = 剪枝那一层被绕过，K 与水印同时失效
    expect(cs).not.toContain('messages: session.messages');
  });

  it('一轮结束后只接回新增部分：整体赋值会把窗口当成历史', () => {
    expect([...cs.matchAll(/mergeTurnResult\(/g)]).toHaveLength(1);
    expect(cs).toContain(
      'session.messages = mergeTurnResult(session.messages, outbound, result.messages);',
    );
  });

  it('摘要段挂进系统提示，不伪装成用户说的话', () => {
    expect(cs).toContain('sessionSummary: summarySection');
    // 注入隔离（DESIGN-SESSIONS §五）：摘要一旦变成 user 消息，模型就把它当指令来回应
    expect(cs).not.toContain('content: summarySection');
    expect(cs).not.toContain('role: user\', content: summary');
  });
});

describe('B：退出只记账，写入永远发生在人点过之后', () => {
  it('markAllResidentEnded 不调模型、不碰长期记忆（退出路径上两样都不该做）', () => {
    const body = fnBody('markAllResidentEnded');
    expect(body.length).toBeLessThan(2_000);
    for (const forbidden of ['completeOnce(', 'streamChat(', 'appendNote(', 'runAgentTurn(']) {
      expect(body, `退出路径上出现了 ${forbidden}`).not.toContain(forbidden);
    }
    expect(body).toContain('pendingNotes().mark(');
    // 记过的不再追问第二遍（判据是落盘条数，见 pending-notes.ts 的 shouldAskAgain）
    expect(body).toContain('shouldAskAgain(notedThrough.get(s.id) ?? -1, total)');
  });

  /**
   * 退出留账的接线形状。这条不是洁癖，是探针量出来的洞：`before-quit` 里"发射后不管"地异步写，
   * 进程紧接着就 quit 了，那一次写入**从来没落到盘上**（对照实验：will-quit + preventDefault 才落）。
   * 所以三样缺一就红：等它写完、有上界（不能让应用关不掉）、写完必须真的强制退出。
   */
  it('退出留账接在 will-quit 上，且"等写完 + 有上界 + 然后强退"三样都在', () => {
    const at = ipcChat.indexOf("app.on('will-quit'");
    expect(at).toBeGreaterThan(-1);
    const body = ipcChat.slice(at, at + 1_600);
    expect(body).toContain('event.preventDefault()');
    expect(body).toContain('markAllResidentEnded()');
    expect(body).toContain('Promise.race(');
    expect(body).toContain('app.exit(0)');
    // 写失败也必须有兜底：reject 的 Promise 一旦进 race 就会让整个退出链挂掉
    expect(body).toContain("(err: unknown) =>");
    // 一次性闸门：preventDefault 之后再 app.exit，will-quit 可能还会被走第二次
    expect(ipcChat).toContain('if (ledgerFlushStarted) return;');
  });

  it('工作区路径由主进程现取，渲染层传来的路径直接拒', () => {
    const at = ipcChat.indexOf('handle(IPC.CHAT_PENDING_RESOLVE');
    const body = ipcChat.slice(at);
    expect(at).toBeGreaterThan(-1);
    expect(body).toContain('parsed.data.workspaceRoot !== null');
    expect(body).toContain('await getWorkspaceInfo()');
    expect(body.indexOf('parsed.data.workspaceRoot !== null')).toBeLessThan(
      body.indexOf('await getWorkspaceInfo()'),
    );
  });

  /**
   * 批复⑤："摘要用会话当前那条连接"。渲染层顶部选中的连接可能是**另一条** ——
   * 让它传连接进来，等于让它决定"花谁的钱、用哪份额度"替这段对话写总结。
   */
  it('补问预览的契约里根本没有连接字段', () => {
    const contracts = read('..', '..', '..', '..', 'packages', 'shared-ipc', 'src', 'contracts.ts');
    const at = contracts.indexOf('export const pendingPreviewSchema');
    expect(at).toBeGreaterThan(-1);
    expect(contracts.slice(at, at + 240)).toContain('sessionId: z.string().min(1)');
    expect(contracts.slice(at, at + 240)).not.toContain('connectionId');
    expect(ipcChat).not.toContain('parsed.data.connectionId');
  });

  it('预览（不落盘）与写入（唯一那一下）是两条通道，且都接上了', () => {
    for (const ch of [
      'IPC.CHAT_COMPACT_STATUS',
      'IPC.CHAT_COMPACT_PREVIEW',
      'IPC.CHAT_COMPACT_APPLY',
      'IPC.CHAT_END',
      'IPC.CHAT_PENDING_LIST',
      'IPC.CHAT_PENDING_PREVIEW',
      'IPC.CHAT_PENDING_RESOLVE',
    ]) {
      expect(ipcChat, `通道 ${ch} 没注册`).toContain(`handle(${ch}`);
    }
  });
});
