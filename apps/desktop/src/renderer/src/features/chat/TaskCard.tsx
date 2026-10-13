import type { ReactElement } from 'react';
import type { ChatTaskView } from '@jujia/shared-ipc';

/**
 * 「被打断的任务」卡片（M17 批一 · R15）。
 *
 * 界面只**显示主进程拼好的实话**（`card.text` 与 `instructionPreview`）——
 * 数字与理由不在渲染层重新组合：说错一格的代价是"断在第几步"整句话失真。
 * 「续跑」只负责把意图交回主进程（走唯一入口起一轮）；「不再提示」把记录标掉。
 */

interface Props {
  card: ChatTaskView;
  busy: boolean;
  sending: boolean;
  onResume: () => void;
  onDismiss: () => void;
}

export function TaskCard({ card, busy, sending, onResume, onDismiss }: Props): ReactElement {
  return (
    <div className="p0-card" role="group" aria-label="被打断的任务" data-task-card={card.status}>
      <p className="p0-warn">{card.text}</p>
      {card.instructionPreview !== '' && (
        <p className="p0-subtitle">{`原始要求：${card.instructionPreview}`}</p>
      )}
      <div className="w2-actions">
        <button
          type="button"
          className="w2-btn-primary"
          disabled={busy || sending}
          onClick={onResume}
        >
          {busy ? '正在恢复…' : '续跑'}
        </button>
        <button type="button" className="w2-btn" disabled={busy} onClick={onDismiss}>
          不再提示
        </button>
      </div>
    </div>
  );
}
