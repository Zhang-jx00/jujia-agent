import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * T26 的接线锁：截断这个事实从 provider 一路走到界面，中间**任何一环掉出去都会静默**。
 *
 * 为什么又是"读源码"而不是只跑单测：每一环单独看都有单测（provider 分出原因、
 * 循环带出 truncated、界面函数给得出话），但"值传到了却没画出来"这种错，
 * 只有钉住接线才抓得到 —— 与 6b 的预览不落盘、6a 的分页走主进程是同一种锁。
 */

const here = dirname(fileURLToPath(import.meta.url));
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = (...rel: string[]): string => strip(readFileSync(join(here, ...rel), 'utf8'));

const chatService = read('chat-service.ts');
const contracts = read('..', '..', '..', '..', 'packages', 'shared-ipc', 'src', 'contracts.ts');
const panel = read('..', 'renderer', 'src', 'features', 'chat', 'ChatPanel.tsx');
const loop = read('..', '..', '..', '..', 'packages', 'agent-core', 'src', 'loop', 'agent-loop.ts');
const provider = read('..', '..', '..', '..', 'packages', 'agent-core', 'src', 'providers', 'openai-compat.ts');
const providerTypes = read('..', '..', '..', '..', 'packages', 'agent-core', 'src', 'providers', 'types.ts');

describe('截断这个事实一路传得出去', () => {
  it('provider 不再把 content_filter 归并成 stop', () => {
    expect(provider).toContain("onFinish('content_filter')");
    // 顺序锁：content_filter 必须判在"任何字符串都算 stop"那条兜底**之前**，
    // 否则分支写了也轮不到它 —— 这正是 T26 原本的形状
    expect(provider.indexOf("onFinish('content_filter')")).toBeLessThan(
      provider.indexOf("else if (typeof reason === 'string')"),
    );
  });

  /**
   * 这两条在 R31 换了判据（**改的是判据，不是清单**）。
   *
   * 旧写法把 `length || content_filter` 那行与契约数组的字面量抄进了锁里 ——
   * 本轮合法地新增第三种"没完整交出来"（`no_end_marker`）时，两条同时当堂红。
   * 这正是本仓第五、第六次撞见同一个形状（写死现状清单 = 会被合法增长养瞎），
   * 而它教出来的错误动作是"把清单再抄一遍"。继任判据是**结构关系**：
   * 循环用"除这两种之外的全部"来判，契约必须**装得下循环能带出的每一种**。
   */
  it('循环按"除写完/停在工具处之外的全部"判截断（点名清单不许回来）', () => {
    expect(loop).toMatch(
      /else if \(ev\.reason !== 'stop' && ev\.reason !== 'tool_calls'\) truncated = ev\.reason;/,
    );
    // 反向锁：逐点名的旧写法不许回来 —— 它会让第四种原因安静地掉进 stop
    expect(loop).not.toMatch(/ev\.reason === 'length' \|\| ev\.reason === 'content_filter'/);
    expect(loop).toContain('truncated: TruncationReason | null;');
  });

  it('循环能带出的每一种截断原因，契约的 done 里都得有那一格（现扫对账，不抄清单）', () => {
    const decl = (name: string): string =>
      new RegExp(`export type ${name} =([^;]+);`, 's').exec(providerTypes)?.[1] ?? '';
    // StreamEnd 的成员分布在两个声明上（`FinishReason | 'tool_calls' | ...`），只扫一行会漏三个
    const ends = [
      ...`${decl('StreamEnd')} ${decl('FinishReason')}`.matchAll(/'([a-z_]+)'/g),
    ].map((m) => m[1] as string);
    // 循环吞掉的那三个不会成为 result.truncated：stop 是"写完了"、
    // tool_calls 由循环自己执行工具继续跑、aborted 走"用户中止"那条独立格子
    const carried = ends.filter((r) => r !== 'stop' && r !== 'tool_calls' && r !== 'aborted');
    // 防失焦：扫不出任何东西时不许算过（"锁读不到就默认绿"是另一类假锁）
    expect(carried.length, 'StreamEnd 里一个截断原因都没扫到 —— 定位器失效了').toBeGreaterThanOrEqual(2);
    const declared = /\[\s*([^\]]+)\]/.exec(
      contracts.slice(contracts.indexOf('DONE_END_REASONS')),
    )?.[1] ?? '';
    for (const reason of carried) {
      expect(declared, `截断原因 "${reason}" 到了主进程就没地方放（界面永远说不出这句）`).toContain(
        `'${reason}'`,
      );
    }
  });

  it('chat-service 读的是那一格，而不是自己再判一次', () => {
    expect(chatService).toContain('result.truncated !== null');
    expect(chatService).toContain('resolved = result.truncated;');
    // 那句"两个分支都写 stop"的假判断不许回来 —— 它正是截断被抹平的地方
    expect(chatService).not.toContain("? 'stop' : 'stop'");
  });

  it('契约的 done 原因里有 content_filter 这一格（不然主进程的话传不到界面）', () => {
    // 这一条**保持字面量**是有意的：它是 T26 那一次实病的靶心（content_filter 被归并成 stop），
    // 而不是"成员清单"。清单交给上面那条现扫对账，这里只钉"这个具体的值别又没了地方放"。
    expect(contracts).toContain("'content_filter'");
    expect(contracts).toContain("'no_end_marker'"); // T55（R31）新增的那一格
  });

  it('界面既调用那句话、也真的把它画出来（两条缺一就还是静默）', () => {
    expect(panel).toContain('truncationNotice(event.reason)');
    expect(panel).toContain('{b.notice && <div className="p0-warn">{b.notice}</div>}');
    expect(panel).toContain("from './done-notice'");
    // 第三环：算出来的那句话必须**挂到气泡上**。只锁"调用了"与"画了"，中间漏掉赋值一样看不见
    expect(panel).toContain('...(truncation === null ? {} : { notice: truncation })');
  });
});

describe('T25/T27 的判据只写在一处', () => {
  it('"有没有产出"由一个函数判，两条收尾路径都调它', () => {
    const calls = provider.split('assertProduced(ledger, toolCalls)').length - 1;
    expect(calls).toBe(2);
    // 反向锁：原先那行写在收尾路径里的"只判垃圾数"的写法不许回来
    expect(provider).not.toContain('received === 0 && skipped > 0');
  });

  it('mapPayload 返回的是一组事件（同帧的 usage 才不会被吞）', () => {
    expect(provider).toContain('events: ProviderEvent[]');
    expect(provider).toContain('for (const ev of mapped.events) yield ev;');
  });
});
