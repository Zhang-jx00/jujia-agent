import { useEffect, useState } from 'react';
import type { CompactStatusView } from '@jujia/shared-ipc';

/**
 * 压缩簇的界面侧状态机（6b · 加固15 从 ChatPanel 拆出）。
 *
 * 拆出的理由是 ChatPanel 行数触顶，拆法沿用 ChatComposer 那一刀的原则：
 * 拆**一处自洽的状态机**（预览 → 存 / 不存 → 刷新状态 + 会话切换时重问），
 * 不是散碎的 helper —— 它只依赖 `sessionId` 与 `sending` 两个入参，闭包完全自足。
 * 行为与此前逐字一致：阈值判定仍只在主进程算，预览仍刻意不写盘（点存才走 apply）。
 */
export function useCompact(
  sessionId: string | undefined,
  sending: boolean,
): {
  compactInfo: CompactStatusView | null;
  compactDraft: { summary: string; truncated: boolean; willCover: number } | null;
  compactBusy: boolean;
  compactHint: { kind: 'ok' | 'err'; text: string } | null;
  askCompact: () => Promise<void>;
  discardCompact: () => void;
  applyCompact: () => Promise<void>;
} {
  const [compactInfo, setCompactInfo] = useState<CompactStatusView | null>(null);
  const [compactDraft, setCompactDraft] = useState<{
    summary: string;
    truncated: boolean;
    willCover: number;
  } | null>(null);
  const [compactBusy, setCompactBusy] = useState(false);
  const [compactHint, setCompactHint] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  /** 会话切换、或一轮跑完之后重新问一次状态（阈值判定只在主进程算，界面不复制规则） */
  useEffect(() => {
    setCompactDraft(null);
    setCompactHint(null);
    if (sessionId === undefined) {
      setCompactInfo(null);
      return;
    }
    if (sending) return;
    let cancelled = false;
    void window.jujia.chatCompactStatus(sessionId).then((s) => {
      if (!cancelled) setCompactInfo(s);
    }, () => {
      // 问不到状态不是错：只是这一轮不提示。下一轮结束还会再问，静默失败才是问题
      if (!cancelled) setCompactInfo(null);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, sending]);

  async function askCompact(): Promise<void> {
    if (sessionId === undefined) return;
    setCompactBusy(true);
    setCompactHint(null);
    try {
      const r = await window.jujia.chatCompactPreview(sessionId);
      if (!r.ok) {
        setCompactHint({ kind: 'err', text: r.error });
        return;
      }
      setCompactDraft({ summary: r.summary, truncated: r.truncated, willCover: r.willCover });
    } finally {
      setCompactBusy(false);
    }
  }

  /** 「先不存」：只把预览丢掉 —— 磁盘与水印从这一刻起也没被动过 */
  function discardCompact(): void {
    setCompactDraft(null);
    setCompactHint({ kind: 'ok', text: '没存。发给模型的上下文一点没变。' });
  }

  async function applyCompact(): Promise<void> {
    if (sessionId === undefined || compactDraft === null) return;
    setCompactBusy(true);
    try {
      const r = await window.jujia.chatCompactApply(sessionId, compactDraft.summary);
      setCompactDraft(null);
      setCompactHint(
        r.ok
          ? { kind: 'ok', text: `已压缩到第 ${String(r.compactedThrough)} 条，原始记录一字未删（在磁盘上可查）` }
          : { kind: 'err', text: r.error },
      );
      setCompactInfo(await window.jujia.chatCompactStatus(sessionId));
    } finally {
      setCompactBusy(false);
    }
  }

  return { compactInfo, compactDraft, compactBusy, compactHint, askCompact, discardCompact, applyCompact };
}
