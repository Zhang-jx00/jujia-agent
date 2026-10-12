import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 定时任务（M7）的接线锁。
 *
 * 抓的是两类"看着做了"的形状：
 * ① 三层里少一层（通道名写了、handler 没接、或 preload 没露）—— 表现为界面上永远转圈，
 *    而每一层自己的单测都是绿的；
 * ② **第二套算式或第二套触发路径**：界面自己算一遍"下次几点"，或定时这边另起一条对话路。
 *    这两件事都不是 bug 现场，而是设计现场 —— 所以只能用"扫源码找不该出现的东西"来钉。
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (...rel: string[]): string => readFileSync(join(here, ...rel), 'utf8');
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const channels = read('..', '..', '..', '..', 'packages', 'shared-ipc', 'src', 'channels.ts');
const scheduleIpc = strip(read('ipc', 'schedule.ts'));
const preload = strip(read('..', 'preload', 'index.ts'));
const panel = strip(read('..', 'renderer', 'src', 'features', 'schedule', 'SchedulePanel.tsx'));
const app = strip(read('..', 'renderer', 'src', 'App.tsx'));
const context = strip(read('ipc', 'context.ts'));
const service = strip(read('schedule-service.ts'));

describe('通道三层都接齐（缺一层就是界面上永远读不出东西）', () => {
  for (const [name, literal] of [
    ['SCHEDULE_LIST', 'schedule:list'],
    ['SCHEDULE_SAVE', 'schedule:save'],
    ['SCHEDULE_TOGGLE', 'schedule:toggle'],
    ['SCHEDULE_DELETE', 'schedule:delete'],
    ['SCHEDULE_EVENT', 'schedule:event'],
  ] as const) {
    it(`${name}（${literal}）在通道表、主进程或发送点、预加载桥各有一处`, () => {
      expect(channels).toContain(`${name}: '${literal}'`);
      const wired =
        scheduleIpc.includes(`handle(IPC.${name},`) || scheduleIpc.includes(`send(IPC.${name},`);
      expect(wired, `${literal} 没有主进程侧的注册点或发送点`).toBe(true);
      // 预加载桥：请求型有方法名，推送型有订阅方法
      const exposed =
        preload.includes(`IPC.${name}`) ||
        (name === 'SCHEDULE_EVENT' && preload.includes('onScheduleEvent'));
      expect(exposed, `${literal} 没通过预加载桥露出去`).toBe(true);
    });
  }

  it('页签挂上了，名字就叫「定时」（e2e 按文字点它）', () => {
    expect(app).toContain("schedule: '定时',");
    expect(app).toContain("tab === 'schedule' && <SchedulePanel />");
  });
});

describe('到点这一轮不许另起第二条路', () => {
  it('服务只用 startTurn，不碰引擎的其它入口', () => {
    expect(service).toContain('deps.startTurn(');
    for (const forbidden of ['sendMessage', 'streamChat', 'runTool', 'runAgentTurn']) {
      expect(service, `schedule-service 里出现了 ${forbidden} = 第二条触发路径`).not.toContain(forbidden);
    }
  });

  it('装配时就把发动机点上（等界面第一次打开才起 = 没人点的那天整天不跑）', () => {
    const at = scheduleIpc.indexOf('service();');
    expect(at, 'registerScheduleIpc 里没有 service() 这一句').toBeGreaterThan(-1);
    expect(at).toBeLessThan(scheduleIpc.indexOf('handle(IPC.SCHEDULE_LIST'));
    expect(scheduleIpc).toContain("app.on('before-quit'");
  });

  it('退出时撤定时器：stop 与 start 都在，且没有第二条 start 的入口', () => {
    expect(service).toContain('stop(): void');
    expect(scheduleIpc).toContain('serviceRef?.stop()');
    expect(scheduleIpc).toContain('serviceRef.start()');
  });

  it('审计出口不重复建（到点这一轮的判定仍进同一本账）', () => {
    // 判定事实的出口只有 startTurn 那一条，服务与通道层都不自己记账
    expect(service).not.toContain('recordTool');
    expect(scheduleIpc).not.toContain('recordGate');
    expect(context).toContain('createTurnTrigger(');
  });
});

describe('「下一次是几点」只有一套算式', () => {
  it('界面不算时间：不引 decideFire、不引 nextOccurrence，也不改分钟数', () => {
    for (const forbidden of ['decideFire', 'nextOccurrence', 'countOccurrences', 'occurrenceAtOrBefore', 'parseRule']) {
      expect(panel, `渲染层出现了 ${forbidden} = 第二套算式`).not.toContain(forbidden);
    }
    // 允许 new Date(...) 做格式化，但不许自己往前推分钟（那是在算下一次）
    expect(panel).not.toContain('setMinutes(');
  });

  it('主进程才算下一次，且算完带着抖动给界面；界面只做格式化', () => {
    expect(scheduleIpc).toContain('decideFire(');
    expect(scheduleIpc).toContain('nextDueAt:');
    // 界面消费的必须是主进程给的那一格，并且只经格式化函数（不自己推时间）
    expect(panel).toMatch(/\.nextDueAt/);
    expect(panel).toContain('formatAt(');
  });

  it('规则坏了要显示原因，不许把"读不出来"渲染成一个看起来正常的时间', () => {
    expect(scheduleIpc).toContain("nextDueAt: decision.kind === 'invalid' ? null : decision.nextDueAt");
    expect(panel).toContain('规则读不出来');
  });
});

describe('账本上没有"免审批"这一格', () => {
  it('存储层把这类键列在拒收清单里，界面也把这条说出来', () => {
    const store = strip(read('schedule-store.ts'));
    for (const key of ['autoApprove', 'alwaysAllow', 'skipPermission']) {
      expect(store, `FORBIDDEN_KEYS 少了 ${key}`).toContain(key);
    }
    expect(panel).toContain('免审批');
  });

  it('定时这一路不碰会话级"总是允许"', () => {
    expect(service).not.toContain('alwaysAllow');
    expect(scheduleIpc).not.toContain('alwaysAllow');
  });
});
