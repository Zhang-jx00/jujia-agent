import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type {
  ConnectionView,
  ScheduledTask,
  ScheduleEventPayload,
  ScheduleMutationResult,
  ScheduleView,
} from '@jujia/shared-ipc';
import {
  MAX_SCHEDULED_TASKS,
  SCHEDULE_JITTER_WINDOW_MS,
  SCHEDULE_NAME_MAX_CHARS,
  SCHEDULE_PROMPT_MAX_CHARS,
  SCHEDULE_RULE_MAX_CHARS,
  SCHEDULE_TICK_MS,
} from '@jujia/shared-ipc';

/**
 * 定时任务面板（M7 · R9）。
 *
 * 这一页只有一件事不能做错：**它不算日程**。
 * 「下一次是几点」由主进程那唯一一套算式（`decideFire`）算好、连同已经加进去的抖动一起送过来，
 * 界面在这里只做**格式化**。界面再算一遍就是第二套口径 —— 会出现"显示 09:00、实际 09:40 才跑"，
 * 那种不一致没人报 bug，只会让人不再信这个功能。
 *
 * 其余都是本仓的老规矩：
 * - **不乐观显示**：任何写操作之后一律 `await reload()` 从主进程重读，页面上的每一格都是服务给的事实；
 * - **错误原样呈现**：主进程已经把话说成中文，这里不改写、不吞掉；
 * - **上限显示在同一份常量上**（`@jujia/shared-ipc` 的 limits），不散着抄数字；
 * - **边界写在屏幕上**：支持哪几个 RRULE 键、拒什么、补跑口径、以及"定时不等于免审批"。
 */

/* ---------------------------- 只显示用的格式化 ---------------------------- */

function pad2(n: number): string {
  return n < 10 ? `0${String(n)}` : String(n);
}

/**
 * 把一个**时刻**格式化成 `MM-DD HH:mm`（本地墙钟）。
 *
 * 注意：这里只有格式化，没有算术 —— 时刻值是主进程给的（`view.nextDueAt` / `task.lastRunAt`），
 * 本机是单用户桌面应用，按用户手表走正是这套算式的口径（见 `agent-core/schedule/rrule` 文件头）。
 * 认不出来的字符串**原样显示**：编一个时间是撒谎，显示成「规则读不出来」也是撒谎。
 */
function formatAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 到点事件的那一句话（三种 kind 三句话，都不改主进程给的原因文本）：
 * 触发了要说、没跑起来要说什么原因、规则坏了要说坏在哪。
 */
function noticeOfEvent(event: ScheduleEventPayload): string {
  const who = `定时任务「${event.name}」`;
  if (event.kind === 'fired') {
    // 正常到点时主进程的 note 就是「到点已触发」；补跑时那句已经写了跳过几次，原样带上
    return event.note === '' || event.note === '到点已触发'
      ? `${who}到点已触发`
      : `${who}到点已触发（${event.note}）`;
  }
  if (event.kind === 'invalid-rule') return `${who}规则读不出来：${event.note}`;
  return `${who}没跑起来：${event.note}`;
}

/* ------------------------------- 面板 ------------------------------- */

export function SchedulePanel(): ReactElement {
  const [views, setViews] = useState<ScheduleView[]>([]);
  const [health, setHealth] = useState('');
  const [connections, setConnections] = useState<ConnectionView[]>([]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [rule, setRule] = useState('');
  const [prompt, setPrompt] = useState('');
  const [connectionId, setConnectionId] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** 每次写完都从这里重读：清单的唯一事实是主进程，界面不自己改一份 */
  const reload = async (): Promise<void> => {
    try {
      const res = await window.jujia.scheduleList();
      setViews(res.views);
      setHealth(res.health);
    } catch (err) {
      setError(messageOf(err));
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  /** 连接读失败不连带拖垮清单：那一页还能看，只是新建时选不到连接（红字说清是哪一路坏了） */
  useEffect(() => {
    let cancelled = false;
    window.jujia
      .connectionList()
      .then((list) => {
        if (!cancelled) setConnections(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(`模型连接读不出来：${messageOf(err)}`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * 到点事件：重读清单 + 说一句刚才发生了什么。
   * 有了这一路界面就不必轮询状态（轮询等于在这儿再起第二个定时器）。
   */
  useEffect(() => {
    const unsubscribe = window.jujia.onScheduleEvent((event: ScheduleEventPayload) => {
      setNotice(noticeOfEvent(event));
      void reload();
    });
    return unsubscribe;
  }, []);

  async function guard(fn: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  const resetForm = (): void => {
    setEditingId(null);
    setName('');
    setRule('');
    setPrompt('');
    setConnectionId('');
  };

  /** `ok:false` 也要重读：主进程两个分支都回了当前的 tasks（界面不猜哪条存下来了） */
  const handleMutationResult = async (
    result: ScheduleMutationResult,
    okText: string,
  ): Promise<void> => {
    if (!result.ok) {
      setError(result.error);
      await reload();
      return;
    }
    setNotice(okText);
    await reload();
  };

  const submit = (): Promise<void> =>
    guard(async () => {
      const label = name.trim();
      const result = await window.jujia.scheduleSave({
        // 新建发 null（契约要的是 `string | null`，不是"省略这一格"）
        id: editingId,
        name: label,
        rule: rule.trim(),
        prompt: prompt.trim(),
        connectionId,
      });
      const isCreate = editingId === null;
      if (result.ok) resetForm();
      await handleMutationResult(result, isCreate ? `已新增定时任务：${label}` : `已保存修改：${label}`);
    });

  const toggle = (task: ScheduledTask): Promise<void> =>
    guard(async () => {
      const result = await window.jujia.scheduleToggle({ id: task.id, enabled: !task.enabled });
      // 停用不删账：上次跑过、跳过几次还得看得见（这话写在按钮上，也写在 notice 里）
      await handleMutationResult(
        result,
        `定时任务「${task.name}」已${task.enabled ? '停用（账还在）' : '重新启用'}`,
      );
    });

  const remove = (task: ScheduledTask): Promise<void> =>
    guard(async () => {
      const result = await window.jujia.scheduleDelete({ id: task.id });
      await handleMutationResult(result, `已删除定时任务：${task.name}`);
    });

  const startEdit = (task: ScheduledTask): void => {
    setEditingId(task.id);
    setName(task.name);
    setRule(task.rule);
    setPrompt(task.prompt);
    setConnectionId(task.connectionId);
    setNotice(`正在编辑「${task.name}」—— 按保存之前清单上还是原来那一版`);
  };

  const cancelEdit = (): void => {
    resetForm();
    setNotice('已取消编辑，清单没有改动');
  };

  const canSubmit =
    name.trim() !== '' && rule.trim() !== '' && prompt.trim() !== '' && connectionId !== '';
  /** 编辑那条的模型连接可能已被删掉：那一格照样显示得出来（原样给 id），不假装它是第一个选项 */
  const selectedKnown = connections.some((c) => c.id === connectionId);

  return (
    <div className="w2-panel" data-schedule-panel>
      <section className="p0-card jj-schedule-scope" data-schedule-scope>
        <h2>这一页能做到什么、做不到什么</h2>
        <ul className="jj-schedule-scope-list">
          <li>
            支持的规则子集：<code>FREQ=MINUTELY / HOURLY / DAILY / WEEKLY</code>，可带{' '}
            <code>INTERVAL</code>（不小于 1 的整数）；<code>BYDAY</code> 只与 WEEKLY 搭配
            （MO / TU / WE / TH / FR / SA / SU，逗号分隔）；<code>BYHOUR</code> 与{' '}
            <code>BYMINUTE</code> 只与 DAILY / WEEKLY 搭配（按分、按小时看的是间隔，指定几点没用）。
          </li>
          <li>
            <strong>不支持、保存当场拒</strong>：<code>UNTIL</code>、<code>COUNT</code>、{' '}
            <code>MONTHLY</code>、<code>YEARLY</code>、时区，以及上面没点名的任何键。
            被拒的规则<strong>不会存下来</strong> —— 不是"存着但忽略"：填了不生效的开关比没这个开关更坏。
          </li>
          <li>
            补跑口径：应用关着错过了好几个到点，重新打开<strong>只补最近那一次</strong>，
            并在任务行上告诉你「上次补跑时跳过 N 次」。不逐次补（一条"每天 09:00"关机一周后连跑七遍不是补上了，是骚扰），
            也不一声不吭（分不清"没到点"和"到点了没跑"）。
          </li>
          <li className="p0-warn">
            <strong>定时不等于免审批。</strong>到点起的那一轮和你亲手敲字走<strong>同一扇权限门</strong>：
            写文件、跑命令照样会弹出来问你；没人答审批就一直等到超时，超时的工具<strong>不会执行</strong>。
            账本上也没有「免审批」这一格 —— 带 <code>autoApprove</code> / <code>alwaysAllow</code> /{' '}
            <code>skipPermission</code> 这类键的保存在主进程就被拒。
          </li>
          <li>
            上限（数字与校验都在 <code>packages/shared-ipc/src/limits.ts</code>，这一页显示的是同一份常量）：
            最多 {String(MAX_SCHEDULED_TASKS)} 条；名字 ≤ {String(SCHEDULE_NAME_MAX_CHARS)} 字；
            规则 ≤ {String(SCHEDULE_RULE_MAX_CHARS)} 字；提示词 ≤ {String(SCHEDULE_PROMPT_MAX_CHARS)} 字。
          </li>
          <li>
            <strong>「下次触发」由主进程算</strong>：主进程每 {String(Math.round(SCHEDULE_TICK_MS / 1000))}{' '}
            秒看一次有没有到点的，并把按任务 id 固定派生的抖动（窗口{' '}
            {String(Math.round(SCHEDULE_JITTER_WINDOW_MS / 1000))} 秒，为的是别让五条「每天 09:00」同时开跑）
            一起算在里面。这一页只做显示，不再算一遍 —— 界面上看到的就是会跑的那一刻（至多晚一个 tick + 抖动）。
          </li>
        </ul>
      </section>

      <section className="p0-card">
        <h2>定时任务清单</h2>
        {health !== '' && (
          <p className="p0-warn" role="alert">
            {health}
          </p>
        )}
        {error !== null && (
          <p className="p0-err" role="alert" data-schedule-error>
            {error}
          </p>
        )}
        {notice !== null && (
          <p className="p0-ok" role="status" data-schedule-notice>
            {notice}
          </p>
        )}

        {views.length === 0 ? (
          <p className="p0-subtitle">还没有定时任务。</p>
        ) : (
          <ul className="jj-schedule-list" data-schedule-list>
            {views.map((v) => {
              const task = v.task;
              // null 只有一种意思：存的规则读不出来（那时 note 一定非空）—— 绝不给一个编出来的时间
              const nextText = v.nextDueAt === null ? '规则读不出来' : formatAt(v.nextDueAt);
              const lastText = task.lastRunAt === null ? '从没跑过' : formatAt(task.lastRunAt);
              const conn = connections.find((c) => c.id === task.connectionId);
              return (
                <li
                  key={task.id}
                  data-schedule-id={task.id}
                  className={task.enabled ? 'jj-schedule-row' : 'jj-schedule-row jj-schedule-row-off'}
                >
                  <div className="jj-schedule-row-head">
                    <span className="jj-schedule-name" data-schedule-name>
                      {task.name}
                    </span>
                    {!task.enabled && <span className="jj-schedule-chip">已停用（账还在）</span>}
                  </div>
                  <div className="jj-schedule-meta">
                    <code className="jj-schedule-rule">{task.rule}</code>
                  </div>
                  <div className="jj-schedule-meta" data-schedule-next>
                    下次触发：{nextText}
                  </div>
                  <div className="jj-schedule-meta">上次触发：{lastText}</div>
                  {task.lastSkipped > 0 && (
                    <div className="jj-schedule-meta">
                      <span className="jj-schedule-chip" data-schedule-skipped>
                        上次补跑时跳过 {String(task.lastSkipped)} 次
                      </span>
                    </div>
                  )}
                  <div className="jj-schedule-meta">
                    模型连接：{conn !== undefined ? conn.name : task.connectionId}
                  </div>
                  <div className="jj-schedule-prompt jj-muted">{task.prompt}</div>
                  {task.lastError !== '' && (
                    <p className="p0-err jj-schedule-line-err">{task.lastError}</p>
                  )}
                  {v.note !== '' && <p className="p0-warn jj-schedule-note">{v.note}</p>}
                  <div className="w2-actions">
                    <button
                      type="button"
                      className="w2-btn"
                      disabled={busy}
                      onClick={() => void toggle(task)}
                    >
                      {task.enabled ? '停用' : '启用'}
                    </button>
                    <button type="button" className="w2-btn" onClick={() => startEdit(task)}>
                      编辑
                    </button>
                    <button
                      type="button"
                      className="w2-btn-danger"
                      disabled={busy}
                      onClick={() => void remove(task)}
                    >
                      删除
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="p0-card">
        <h2>{editingId === null ? '新建定时任务' : `编辑定时任务：${name}`}</h2>
        <p className="p0-subtitle">
          到点交给模型的就是「提示词」那一句话 —— 它不直接执行任何命令：命令由模型提出、由权限门批给你看。
        </p>
        <div className="jj-schedule-form">
          <label>
            名字（上限 {String(SCHEDULE_NAME_MAX_CHARS)} 字）
            <input
              aria-label="名字"
              data-schedule-form-name
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如 每周五下午收一周待办"
              disabled={busy}
            />
          </label>
          <label>
            规则（RRULE 子集，上限 {String(SCHEDULE_RULE_MAX_CHARS)} 字）
            <input
              aria-label="规则"
              data-schedule-form-rule
              value={rule}
              onChange={(e) => setRule(e.target.value)}
              placeholder="例如 FREQ=WEEKLY;BYDAY=FR;BYHOUR=15;BYMINUTE=0"
              spellCheck={false}
              disabled={busy}
            />
          </label>
          <label>
            提示词（上限 {String(SCHEDULE_PROMPT_MAX_CHARS)} 字）
            <textarea
              aria-label="提示词"
              data-schedule-form-prompt
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="例如 把本周没做完的待办列一遍，并按优先级给我三条建议"
              disabled={busy}
            />
          </label>
          <label>
            模型连接
            <select
              aria-label="模型连接"
              data-schedule-form-connection
              value={connectionId}
              onChange={(e) => setConnectionId(e.target.value)}
              disabled={busy}
            >
              <option value="">（选一个连接）</option>
              {!selectedKnown && connectionId !== '' && (
                <option value={connectionId}>{`（这条任务连的连接已不在清单里：${connectionId}）`}</option>
              )}
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}（{c.model}）
                </option>
              ))}
            </select>
          </label>
          {connections.length === 0 && (
            <p className="p0-subtitle">
              还没有可选的模型连接 —— 定时任务必须绑一条连接才能跑，先到「连接」页配一条。
            </p>
          )}
          <div className="w2-actions">
            <button
              type="button"
              className="w2-btn-primary"
              data-schedule-submit
              disabled={busy || !canSubmit}
              onClick={() => void submit()}
            >
              {editingId === null ? '保存新任务' : '保存修改'}
            </button>
            {editingId !== null && (
              <button type="button" className="w2-btn" disabled={busy} onClick={cancelEdit}>
                取消编辑（清单不动）
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
