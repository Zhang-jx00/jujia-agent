import { useEffect, useState } from 'react';
import type { ChatTaskResumeResult, ChatTaskView } from '@jujia/shared-ipc';

/**
 * 被打断任务卡片的**取数与会话**（M17 批一 · R15；自 ChatPanel 拆出，那份贴着 800 行上限）。
 *
 * 三条口径：
 * - **读时判定在主进程**（chatTaskGet）：这里只管"status 是 interrupted 才显示"；
 * - 流没停之前不重问状态（与压缩状态查询同一条口径：正在跑的轮次说不了终态）；
 * - 续跑成功把结果**交回给调用方**（落气泡、接流）—— 这个 hook 不直接碰会话状态，
 *   免得"两条起轮的路"在界面上长出两套气泡逻辑。
 */

export interface TaskCardHint {
  kind: 'ok' | 'err';
  text: string;
}

export interface TaskCardApi {
  card: ChatTaskView | null;
  busy: boolean;
  hint: TaskCardHint | null;
  resume: () => Promise<void>;
  dismiss: () => Promise<void>;
}

export function useTaskCard(
  sessionId: string | undefined,
  sending: boolean,
  onResumed: (result: ChatTaskResumeResult) => void,
): TaskCardApi {
  const [card, setCard] = useState<ChatTaskView | null>(null);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<TaskCardHint | null>(null);

  useEffect(() => {
    setHint(null);
    if (sessionId === undefined) {
      setCard(null);
      return;
    }
    if (sending) return;
    let cancelled = false;
    void window.jujia.chatTaskGet(sessionId).then(
      (v) => {
        if (!cancelled) setCard(v !== null && v.status === 'interrupted' ? v : null);
      },
      () => {
        // 问不到状态不是错：只是这一轮不显示卡片。下一轮结束还会再问，静默失败才是问题
        if (!cancelled) setCard(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sessionId, sending]);

  async function resume(): Promise<void> {
    if (card === null || busy) return;
    setBusy(true);
    setHint(null);
    try {
      const r = await window.jujia.chatTaskResume(card.sessionId, card.taskId);
      if (!r.ok) {
        setHint({ kind: 'err', text: r.error });
        return;
      }
      setCard(null);
      onResumed(r);
    } catch (err) {
      setHint({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function dismiss(): Promise<void> {
    if (card === null || busy) return;
    setBusy(true);
    setHint(null);
    try {
      const r = await window.jujia.chatTaskDismiss(card.sessionId);
      if (!r.ok) {
        setHint({ kind: 'err', text: r.error });
        return;
      }
      setCard(null);
      setHint({ kind: 'ok', text: '好，这条不再提示。' });
    } finally {
      setBusy(false);
    }
  }

  return { card, busy, hint, resume, dismiss };
}
