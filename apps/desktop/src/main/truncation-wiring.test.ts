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

describe('截断这个事实一路传得出去', () => {
  it('provider 不再把 content_filter 归并成 stop', () => {
    expect(provider).toContain("onFinish('content_filter')");
    // 顺序锁：content_filter 必须判在"任何字符串都算 stop"那条兜底**之前**，
    // 否则分支写了也轮不到它 —— 这正是 T26 原本的形状
    expect(provider.indexOf("onFinish('content_filter')")).toBeLessThan(
      provider.indexOf("else if (typeof reason === 'string')"),
    );
  });

  it('循环把它作为独立一格带出来（不挤进 reason）', () => {
    expect(loop).toContain("else if (ev.reason === 'length' || ev.reason === 'content_filter') truncated = ev.reason;");
    expect(loop).toContain('truncated: TruncationReason | null;');
  });

  it('chat-service 读的是那一格，而不是自己再判一次', () => {
    expect(chatService).toContain('result.truncated !== null');
    expect(chatService).toContain('resolved = result.truncated;');
    // 那句"两个分支都写 stop"的假判断不许回来 —— 它正是截断被抹平的地方
    expect(chatService).not.toContain("? 'stop' : 'stop'");
  });

  it('契约的 done 原因里有 content_filter 这一格（不然主进程的话传不到界面）', () => {
    expect(contracts).toContain("'length', 'content_filter', 'aborted'");
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
