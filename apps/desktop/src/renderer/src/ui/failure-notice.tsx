import { useSyncExternalStore, type ReactElement } from 'react';

/**
 * 渲染层的失败兜底（T45 · 2026-10-14 审计清零批）。
 *
 * 补的是**一类**缺陷而不是十几处实例：2026-10-09 审计 B5 那条（`try/finally` 没有 `catch`）
 * 到今天只剩一半 —— 关键点都补了 catch 并把话写进 hint，但渲染层仍有十几处没有，
 * IPC 被拒时界面回到"点了没反应"。逐点补治不了下一处新写的漏网，
 * 所以这里立一道**结构性兜底**：没人接的 rejection 也要出现在屏幕上。
 *
 * 三条自律：
 * 1. **不静默** —— 原因文本原样说出（并标明"没有地方接住"，好让人去补那一处 catch）；
 * 2. **不刷屏** —— 同一条只留一张卡并计次，最多三张，**挤掉旧的而不是丢掉新的**；
 * 3. **装得起来也撤得下去** —— `installFailureReporter()` 返回 cleanup，
 *    漏了撤会在热更新时叠出第二个监听器、一条失败报两遍。
 *
 * 与 `ErrorBoundary` 的分工：那边管**渲染期抛错**（整块界面换成交付失败的兜底），
 * 这边管**异步失败**（一次点击背后的 promise 被拒）。两者都不得什么都不说。
 */

export interface FailureNotice {
  id: number;
  text: string;
  /** 同一条文本重复出现的次数（>1 时在卡片上如实写出来） */
  count: number;
}

const MAX_VISIBLE = 3;

const items: FailureNotice[] = [];
const listeners = new Set<() => void>();
let snapshot: readonly FailureNotice[] = [];
let seq = 0;

function emit(): void {
  snapshot = [...items];
  for (const notify of listeners) notify();
}

/** 报一处失败。空文本不算失败（宁可是测试里的占位，也不要一张没有字的卡）。 */
export function reportFailure(text: string): void {
  const trimmed = text.trim();
  if (trimmed === '') return;
  const existing = items.find((n) => n.text === trimmed);
  if (existing !== undefined) {
    existing.count += 1;
    emit();
    return;
  }
  items.push({ id: (seq += 1), text: trimmed, count: 1 });
  // 溢出时先走最旧的：新发生的失败必须看得见，被挤掉的若是新的就等于"这条没报出来"
  while (items.length > MAX_VISIBLE) items.splice(0, items.length - MAX_VISIBLE);
  emit();
}

export function dismissFailure(id: number): void {
  const at = items.findIndex((n) => n.id === id);
  if (at === -1) return;
  items.splice(at, 1);
  emit();
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

function getSnapshot(): readonly FailureNotice[] {
  return snapshot;
}

/** 挂在 App 根部的一角；没有失败时渲染空，不占任何位置 */
export function FailureNotices(): ReactElement {
  const list = useSyncExternalStore(subscribe, getSnapshot);
  if (list.length === 0) return <></>;
  return (
    <div className="jj-failure-notices" data-failure-notices="" aria-label="未接住的失败">
      {list.map((n) => (
        <div key={String(n.id)} className="jj-failure-notice" role="alert">
          <span className="jj-failure-notice__text">
            {n.text}
            {n.count > 1 ? `（同一处已发生 ${String(n.count)} 次）` : ''}
          </span>
          <button
            type="button"
            className="jj-failure-notice__close"
            aria-label="关掉这条提示"
            onClick={() => {
              dismissFailure(n.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * 装上"没人接的 rejection"的耳朵，返回卸载函数。
 *
 * 为什么在装配点（main.tsx）调而不是组件的 useEffect 里：组件会被卸载重挂（切页签、
 * 错误边界重建），监听器就该只有一份、跟应用同生命周期。
 */
export function installFailureReporter(): () => void {
  const onRejection = (ev: Event): void => {
    const reason = (ev as Event & { reason?: unknown }).reason;
    const text = reason instanceof Error ? reason.message : String(reason ?? '未知原因');
    reportFailure(`有一步失败了，但没有地方接住它：${text}`);
  };
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

/** 仅用于测试：清干净卡片状态，避免用例之间互相看见 */
export function __resetFailuresForTest(): void {
  items.length = 0;
  emit();
}
