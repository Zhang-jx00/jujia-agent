// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  ConnectionView,
  ScheduledTask,
  ScheduleEventPayload,
  ScheduleView,
} from '@jujia/shared-ipc';
import { SchedulePanel } from './SchedulePanel';

/**
 * 定时任务页的组件级断言（M7 · R9）。
 *
 * 为什么这一页值得单独测：它最容易出的错不是"按钮点不动"，而是**界面自己算了一遍日程**。
 * 一旦这里再算一遍，就会出现"显示 09:00、实际 09:40 才跑"——没人报 bug，只会让人不再信这功能。
 * 所以第 1 条把"显示的时刻 = 主进程给的那个时刻"钉死（规则写 09:00、视图给 09:40，
 * 界面必须显示 09:40）。其余各条钉的是另一半：**不许静默**（health / note / lastError / 跳过次数
 * 都得在屏幕上说出来），以及**写完之后必须重读**（不乐观显示服务端没确认过的状态）。
 */

function task(over: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'a',
    name: '每天收一遍待办',
    rule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
    prompt: '把今天该做的列一遍',
    connectionId: 'c1',
    anchorAt: '2026-10-01T00:00:00.000Z',
    sessionId: null,
    enabled: true,
    jitterMs: 37_000,
    lastRunAt: null,
    lastSkipped: 0,
    lastError: '',
    ...over,
  };
}

function viewOf(
  over: { task?: ScheduledTask; nextDueAt?: string | null; note?: string } = {},
): ScheduleView {
  return {
    task: over.task ?? task(),
    nextDueAt: over.nextDueAt ?? null,
    note: over.note ?? '',
  };
}

function conn(): ConnectionView {
  return {
    id: 'c1',
    name: '本机默认',
    baseUrl: 'http://127.0.0.1:8787/v1',
    apiFormat: 'openai-compatible',
    model: 'glm-4.5',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    hasApiKey: true,
    apiKeyHint: 'sk-…c3f9',
  };
}

const scheduleList = vi.fn();
const scheduleSave = vi.fn();
const scheduleToggle = vi.fn();
const scheduleDelete = vi.fn();
const onScheduleEvent = vi.fn();
const connectionList = vi.fn();

/** 面板注册进来的回调（测试扮演主进程往这里推事件） */
const listeners: ((event: ScheduleEventPayload) => void)[] = [];

function emit(event: ScheduleEventPayload): void {
  act(() => {
    for (const l of [...listeners]) l(event);
  });
}

function mount(views: ScheduleView[], health = ''): void {
  scheduleList.mockResolvedValue({ views, health });
  render(<SchedulePanel />);
}

function byAnchor(attr: string): HTMLElement {
  // 泛型是必须的：querySelector 默认回 Element，而下去要用 inputValue()/textContent 这类成员
  const el = document.querySelector<HTMLElement>(attr);
  if (el === null) throw new Error(`页面上没有这个锚点：${attr}`);
  return el;
}

function setFormPart(part: 'name' | 'rule' | 'prompt' | 'connection', value: string): void {
  fireEvent.change(byAnchor(`[data-schedule-form-${part}]`), { target: { value } });
}

function rowOf(id: string): HTMLElement {
  return byAnchor(`[data-schedule-id="${id}"]`);
}

function fillCreateForm(): void {
  setFormPart('name', '每周五收一周待办');
  setFormPart('rule', 'FREQ=WEEKLY;BYDAY=FR;BYHOUR=15;BYMINUTE=0');
  setFormPart('prompt', '把本周没做完的列一遍');
  setFormPart('connection', 'c1');
}

beforeEach(() => {
  scheduleList.mockReset();
  scheduleSave.mockReset();
  scheduleToggle.mockReset();
  scheduleDelete.mockReset();
  onScheduleEvent.mockReset();
  connectionList.mockReset();
  listeners.length = 0;

  connectionList.mockResolvedValue([conn()]);
  scheduleSave.mockResolvedValue({ ok: true, tasks: [] });
  scheduleToggle.mockResolvedValue({ ok: true, tasks: [] });
  scheduleDelete.mockResolvedValue({ ok: true, tasks: [] });
  onScheduleEvent.mockImplementation((listener: (event: ScheduleEventPayload) => void) => {
    listeners.push(listener);
    return () => {
      const at = listeners.indexOf(listener);
      if (at >= 0) listeners.splice(at, 1);
    };
  });

  vi.stubGlobal('jujia', {
    scheduleList,
    scheduleSave,
    scheduleToggle,
    scheduleDelete,
    onScheduleEvent,
    connectionList,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('定时页 · 清单只搬运主进程算好的时刻', () => {
  it('下次触发显示的是主进程给的那一刻，不是界面按规则重算的那一刻', async () => {
    // 规则说 09:00，主进程给的 nextDueAt 是本地 09:40（抖动 / 锚点都算在里面了）。
    // 界面若自己按规则算一遍就会显示 09:00 —— 这条断言正是抓这个的。
    const due = new Date(2026, 9, 12, 9, 40);
    mount([viewOf({ nextDueAt: due.toISOString() })]);
    const next = await waitFor(() => {
      const el = byAnchor('[data-schedule-next]');
      expect(el.textContent).toContain('下次触发');
      return el;
    });
    expect(next.textContent).toContain('10-12 09:40');
    expect(next.textContent).not.toContain('09:00');
  });

  it('上次触发：主进程给了时刻就格式化，从没跑过就说「从没跑过」', async () => {
    mount([
      viewOf({ task: task({ id: 'run', lastRunAt: new Date(2026, 9, 11, 21, 5).toISOString() }) }),
      viewOf({ task: task({ id: 'never', lastRunAt: null }) }),
    ]);
    // 两行的名字一样，所以**等锚点**而不是等文字（等文字会拿到"找到多个"）
    await waitFor(() => {
      expect(document.querySelector('[data-schedule-id="run"]')).not.toBeNull();
      expect(document.querySelector('[data-schedule-id="never"]')).not.toBeNull();
    });
    expect(rowOf('run').textContent).toContain('上次触发：10-11 21:05');
    expect(rowOf('never').textContent).toContain('上次触发：从没跑过');
  });

  it('nextDueAt 为 null 时说「规则读不出来」并把 note 显出来，不编一个时间', async () => {
    const note = '这个版本不支持 FREQ=MONTHLY（只支持 MINUTELY / HOURLY / DAILY / WEEKLY）';
    mount([viewOf({ task: task({ id: 'bad', rule: 'FREQ=MONTHLY' }), nextDueAt: null, note })]);
    const next = await waitFor(() => within(rowOf('bad')).getByText(/规则读不出来/));
    expect(next.textContent).toContain('下次触发：规则读不出来');
    const noteLine = within(rowOf('bad')).getByText(note);
    expect(noteLine.className).toContain('p0-warn');
    // 没有真时刻就不许出现任何"日期 时间"形状的东西（那才是编出来的时间）
    expect(rowOf('bad').textContent).not.toMatch(/\d{2}-\d{2} \d{2}:\d{2}/);
  });
});

describe('定时页 · 不许静默', () => {
  it('上次补跑跳过 2 次要写出来；跳过 0 次不许长出那一格（没有"跳过了 0 次"这种噪声）', async () => {
    mount([
      viewOf({ task: task({ id: 'skip2', lastSkipped: 2 }) }),
      viewOf({ task: task({ id: 'skip0', lastSkipped: 0 }) }),
    ]);
    await waitFor(() => expect(document.querySelector('[data-schedule-id="skip2"]')).not.toBeNull());
    expect(rowOf('skip2').textContent).toContain('跳过 2 次');
    expect(rowOf('skip2').querySelector('[data-schedule-skipped]')).not.toBeNull();
    expect(rowOf('skip0').querySelector('[data-schedule-skipped]')).toBeNull();
    expect(rowOf('skip0').textContent).not.toContain('跳过');
  });

  it('health 非空就是主进程在说"这份清单是回落读出来的"，必须当面讲', async () => {
    mount([], '定时任务清单读不出来，这次用的是备份文件（已另存）');
    await screen.findByText(/备份文件/);
    expect(document.body.textContent).toContain('这次用的是备份文件');
  });

  it('lastError 非空要在那一行原样显示（空串就不该出现）', async () => {
    mount([
      viewOf({ task: task({ id: 'err', lastError: '这一轮的模型连接连不上' }) }),
      viewOf({ task: task({ id: 'clean', lastError: '' }) }),
    ]);
    await waitFor(() => expect(document.querySelector('[data-schedule-id="err"]')).not.toBeNull());
    expect(rowOf('err').textContent).toContain('这一轮的模型连接连不上');
    expect(rowOf('clean').querySelector('.p0-err')).toBeNull();
  });

  it('一行都没有时说的是「还没有定时任务。」', async () => {
    mount([]);
    await screen.findByText('还没有定时任务。');
    expect(document.querySelector('[data-schedule-list]')).toBeNull();
  });
});

describe('定时页 · 边界说明与安全口径', () => {
  it('边界块把「定时不等于免审批」这句写在屏幕上（删掉它就等于删掉安全声明）', async () => {
    mount([]);
    const scope = await waitFor(() => byAnchor('[data-schedule-scope]'));
    const text = scope.textContent ?? '';
    expect(text).toContain('免审批');
    expect(text).toContain('定时不等于免审批');
    expect(text).toContain('同一扇权限门');
    expect(text).toContain('不会执行');
    // 支持哪几个键、拒哪些键也要在同一段里说清
    expect(text).toContain('FREQ=MINUTELY');
    expect(text).toContain('BYDAY');
    expect(text).toContain('UNTIL');
    expect(text).toContain('不会存下来');
    // 上限也是真数字（同一份常量），不是空话
    expect(text).toContain('50');
    expect(text).toContain('4000');
  });

  it('表单四格都有中文 aria-label，标签也真的关联上了', async () => {
    mount([]);
    await screen.findByText('还没有定时任务。');
    expect(screen.getByLabelText(/名字/)).toBe(byAnchor('[data-schedule-form-name]'));
    expect(screen.getByLabelText(/^规则/)).toBe(byAnchor('[data-schedule-form-rule]'));
    expect(screen.getByLabelText(/提示词/)).toBe(byAnchor('[data-schedule-form-prompt]'));
    expect(screen.getByLabelText(/模型连接/)).toBe(byAnchor('[data-schedule-form-connection]'));
  });
});

describe('定时页 · 写完重读', () => {
  it('新建提交的 id 是 null（不是省略这一格），并且成功后重读一次清单', async () => {
    mount([]);
    await screen.findByText('还没有定时任务。');
    fillCreateForm();
    fireEvent.click(byAnchor('[data-schedule-submit]'));
    await waitFor(() => expect(scheduleSave).toHaveBeenCalledTimes(1));
    expect(scheduleSave.mock.calls[0]?.[0]).toEqual({
      id: null,
      name: '每周五收一周待办',
      rule: 'FREQ=WEEKLY;BYDAY=FR;BYHOUR=15;BYMINUTE=0',
      prompt: '把本周没做完的列一遍',
      connectionId: 'c1',
    });
    await waitFor(() => expect(scheduleList).toHaveBeenCalledTimes(2));
  });

  it('按「编辑」带进去的是那条任务自己的 id，不是新建', async () => {
    mount([viewOf({ task: task({ id: 't7', name: '早上读邮件' }) })]);
    await screen.findByText('早上读邮件');
    fireEvent.click(within(rowOf('t7')).getByRole('button', { name: '编辑' }));
    fireEvent.click(byAnchor('[data-schedule-submit]'));
    await waitFor(() => expect(scheduleSave).toHaveBeenCalledTimes(1));
    expect(scheduleSave.mock.calls[0]?.[0]).toEqual({
      id: 't7',
      name: '早上读邮件',
      rule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
      prompt: '把今天该做的列一遍',
      connectionId: 'c1',
    });
  });

  it('ok:false 时错误原样上屏（不改写、不吞），清单照样重读', async () => {
    mount([viewOf({ task: task({ id: 'keep' }) })]);
    await screen.findByText('每天收一遍待办');
    const firstReads = scheduleList.mock.calls.length;
    scheduleSave.mockResolvedValue({
      ok: false,
      error: '规则不行：这个版本不支持 UNTIL（这一条没有存下来）',
      tasks: [],
    });
    fillCreateForm();
    fireEvent.click(byAnchor('[data-schedule-submit]'));
    await waitFor(() => expect(scheduleSave).toHaveBeenCalledTimes(1));
    const line = byAnchor('[data-schedule-error]');
    expect(line.getAttribute('role')).toBe('alert');
    expect(line.textContent).toBe('规则不行：这个版本不支持 UNTIL（这一条没有存下来）');
    await waitFor(() => expect(scheduleList.mock.calls.length).toBe(firstReads + 1));
    // 失败不许把表单内容清掉（那是"看起来改成功了"的另一半）
    expect((byAnchor('[data-schedule-form-rule]') as HTMLInputElement).value).toContain('BYDAY=FR');
  });

  it('启停与删除都把入参发给主进程，然后重读（不自己改本地那一份）', async () => {
    mount([viewOf({ task: task({ id: 't9', name: '夜里跑备份' }) })]);
    await screen.findByText('夜里跑备份');

    fireEvent.click(within(rowOf('t9')).getByRole('button', { name: '停用' }));
    await waitFor(() => expect(scheduleToggle).toHaveBeenCalledWith({ id: 't9', enabled: false }));
    const afterToggle = scheduleList.mock.calls.length;

    fireEvent.click(within(rowOf('t9')).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(scheduleDelete).toHaveBeenCalledWith({ id: 't9' }));
    await waitFor(() => expect(scheduleList.mock.calls.length).toBeGreaterThan(afterToggle));
  });

  it('取消编辑说的是"清单没动"，不是失败', async () => {
    mount([viewOf({ task: task({ id: 't5', name: '周一站会提醒' }) })]);
    await screen.findByText('周一站会提醒');
    fireEvent.click(within(rowOf('t5')).getByRole('button', { name: '编辑' }));
    fireEvent.click(screen.getByRole('button', { name: /取消编辑/ }));
    const line = byAnchor('[data-schedule-notice]');
    expect(line.getAttribute('role')).toBe('status');
    expect(line.textContent).toContain('清单没有改动');
    expect(scheduleSave).not.toHaveBeenCalled();
  });
});

describe('定时页 · 到点事件', () => {
  it('事件来了就重读清单，notice 说的是「到点已触发」', async () => {
    mount([viewOf({ task: task({ id: 'a', name: '每天收一遍待办' }) })]);
    await screen.findByText('每天收一遍待办');
    const before = scheduleList.mock.calls.length;
    emit({
      taskId: 'a',
      name: '每天收一遍待办',
      kind: 'fired',
      note: '到点已触发',
      at: new Date().toISOString(),
    });
    await waitFor(() => expect(scheduleList.mock.calls.length).toBe(before + 1));
    await waitFor(() =>
      expect(byAnchor('[data-schedule-notice]').textContent).toBe('定时任务「每天收一遍待办」到点已触发'),
    );
  });

  it('failed 与 invalid-rule 两种事件说的是两句不同的话（都不静默）', async () => {
    mount([viewOf({ task: task({ id: 'b', name: '早上读邮件' }) })]);
    await screen.findByText('早上读邮件');
    emit({
      taskId: 'b',
      name: '早上读邮件',
      kind: 'failed',
      note: '模型连接连不上',
      at: new Date().toISOString(),
    });
    await waitFor(() =>
      expect(byAnchor('[data-schedule-notice]').textContent).toContain('没跑起来：模型连接连不上'),
    );
    emit({
      taskId: 'b',
      name: '早上读邮件',
      kind: 'invalid-rule',
      note: '缺少 FREQ',
      at: new Date().toISOString(),
    });
    await waitFor(() =>
      expect(byAnchor('[data-schedule-notice]').textContent).toContain('规则读不出来：缺少 FREQ'),
    );
  });

  it('卸载时把订阅退掉（不留一个还在往死页面上推事件的回调）', async () => {
    mount([]);
    await screen.findByText('还没有定时任务。');
    expect(onScheduleEvent).toHaveBeenCalledTimes(1);
    expect(listeners.length).toBe(1);
    cleanup();
    expect(listeners.length).toBe(0);
  });
});
