/**
 * 诚实化源锁（加固14 · 2026-10-14，T40 审计项：
 * "工作区提示每轮追加且永不退场" + "淘汰日志无条件断言历史已落盘"）。
 *
 * 为什么用扫源码：chat-service 起不了 vitest（需要 Electron 环境），
 * 但这两条的**不变量**非常明确 —— 旧的坏写法必须绝迹、新的好写法必须留在原位。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync(new URL('./chat-service.ts', import.meta.url), 'utf8');

describe('工作区提示与淘汰话术（chat-service 源锁）', () => {
  it('未选工作区的提示不往消息数组里逐轮追加', () => {
    // 旧形态：push 一条 role:'system' 的"尚未选择工作区"（每轮一条、永不退场）
    expect(src).not.toMatch(/messages\.push\(\{[\s\S]{0,80}尚未选择工作区/);
    // 新形态：常量并入系统提示的一次性重拼（headParts）
    expect(src).toContain('NO_WORKSPACE_NOTICE');
    expect(src).toMatch(/headParts = \[[\s\S]{0,120}NO_WORKSPACE_NOTICE/);
  });

  it('淘汰日志不再无条件声称"历史已落盘"', () => {
    expect(src).toContain('已从内存卸载最久未使用的会话');
    // flush 是异步的，写失败另有单独报错 —— "已落盘"这个无条件断言不许回来
    expect(src).not.toContain('历史已落盘，重启后仍可继续');
  });

  it('落盘失败经 done.notice 上界面（R25：不再只进 console）', () => {
    expect(src).toContain('这一轮没能写进磁盘历史');
    expect(src).toMatch(/async function flushSession\(s: Session\): Promise<string \| null>/);
    expect(src).toMatch(/const persistError = await flushSession\(session\);/);
    // done 事件契约里这条通道在位（渲染层才有得读）
    const contracts = readFileSync(
      new URL('../../../../packages/shared-ipc/src/contracts.ts', import.meta.url),
      'utf8',
    );
    const doneBlock = contracts.slice(
      contracts.indexOf("type: z.literal('done')"),
      contracts.indexOf('export type StreamEvent'),
    );
    expect(doneBlock).toContain('notice: z.string().nullable().default(null)');
    // 渲染层真的把它说出来了（不是契约里挂着一个没人读的字段）
    const panel = readFileSync(
      new URL('../renderer/src/features/chat/ChatPanel.tsx', import.meta.url),
      'utf8',
    );
    expect(panel).toContain('setHistoryHint(event.notice)');
  });
});

/**
 * T47（审计清零批 · 2026-10-14）：R25 把"这一轮没写进去"接上了 done.notice，
 * 但审计原文那条**"落盘失败只进 console"**并没有全清 —— 模块级函数里还留着六处：
 * 轮末历史写失败、元信息写失败、任务记录写失败、起轮补写失败、摘要读不出来、
 * 记忆装配与 SessionStart 钩子失败。淘汰路径 `void flushSession(doomed)` 丢掉返回值也属同一族。
 * 打包后的 Electron 里 `console.warn` 不进任何文件，所以这六处今天等于"没人知道"。
 *
 * 修法是把出口收到**一个** `fail()`：console（开发期）+ 结构化日志（打包后唯一翻查的地方）。
 * 刻意不做成 deps 一路传 —— 这六点都不在 `ChatDeps` 的调用链上，为传一个出口改六处签名，
 * 代价比一个装配期 setter 大，风险却相同。
 *
 * 覆盖面要如实说：**这是源锁，不是运行期真值**。`chat-service` 在 vitest 里 import 不动
 * （它依赖 electron），所以"日志真的落到文件、按级别过滤、剔密在落盘前"由
 * `logger.test.ts` 与 `log-store.test.ts` 各自守住；这里只钉"失败点接没接上那个出口"。
 */
describe('落盘与降级失败要进结构化日志（T47 源锁）', () => {
  it('裸 console.warn 只许剩两处：fail() 自己 + 淘汰那条信息行', () => {
    // 计数而不是逐条：新增一处"顺手 console.warn 一下"的失败点会直接把这里打死 ——
    // 那正是本条要拦的行为（失败点必须走 fail，才有文件里那一行）。
    const warns = [...src.matchAll(/console\.warn\(/g)].map((m) => m.index);
    expect(warns.length, `chat-service 里 console.warn 出现了 ${String(warns.length)} 次，只许 2 次`).toBe(2);
    expect(src).toMatch(/function fail\(/);
    expect(src).toMatch(/persistLogger\?\.warn\(/);
  });

  it('装配根把 logger 接了进来（否则默认出口仍然只进 console）', () => {
    expect(src).toContain('export function setPersistLogger(');
    const index = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(index).toMatch(/setPersistLogger\(logger\)/);
  });

  it('六类失败的说法一个都不许在改造中丢掉', () => {
    for (const phrase of [
      '历史没写进去',
      '元信息没写进去',
      '任务记录没写进去',
      '起轮时会话元信息没写进去',
      '摘要读不出来',
      '装配失败',
      'SessionStart 失败',
    ]) {
      expect(src, phrase).toContain(phrase);
    }
    // 淘汰路径照旧走同一个 flushSession：失败怎么算、怎么说，只有一处定义
    expect(src).toMatch(/void flushSession\(doomed\)/);
  });
});
