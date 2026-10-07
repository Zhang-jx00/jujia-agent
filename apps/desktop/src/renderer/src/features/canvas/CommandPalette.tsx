import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';

/**
 * 画布命令面板（B1）。
 *
 * 设计纪律（写在最显眼处）：**它只是既有动作的第二个入口，不是第二条执行路径** ——
 * 每条命令的 `run` 都是面板按钮用的**同一个函数引用**（接线锁钉住），
 * 卡片里没有任何 fetch / IPC / runner 的直接调用。
 */

export interface CanvasCommand {
  id: string;
  /** 展示与过滤都用它 */
  label: string;
  /** 与按钮共用同一个函数引用（不许在面板里另写实现） */
  run: () => void;
}

export function CommandPalette({
  open,
  commands,
  onClose,
}: {
  open: boolean;
  commands: CanvasCommand[];
  onClose: () => void;
}): ReactElement | null {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // 每次打开都从干净状态开始（重开还留着上次的过滤词，会让人"回车打错命令"）
  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      inputRef.current?.focus();
    }
  }, [open]);

  const filtered = useMemo(
    () => commands.filter((c) => c.label.toLowerCase().includes(query.trim().toLowerCase())),
    [commands, query],
  );

  if (!open) return null;

  const active = Math.min(index, Math.max(filtered.length - 1, 0));

  /** 空列表时什么都不做（"闭眼回车"不许落到别的命令上，也不许悄悄关掉） */
  const runAt = (i: number): void => {
    const cmd = filtered[i];
    if (cmd === undefined) return;
    cmd.run();
    onClose();
  };

  return (
    <div className="jj-palette-mask" role="presentation" onClick={onClose}>
      <div className="jj-palette" role="dialog" aria-label="命令面板" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="jj-palette-input"
          aria-label="命令"
          placeholder="输入命令（如：保存 / 运行 / 添加）"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              onClose();
              return;
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((n) => Math.min(n + 1, filtered.length - 1));
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((n) => Math.max(n - 1, 0));
              return;
            }
            if (e.key === 'Enter') runAt(active);
          }}
        />
        {filtered.length === 0 ? (
          <p className="jj-muted jj-palette-empty">没有匹配的命令</p>
        ) : (
          <div className="jj-palette-list">
            {filtered.map((c, i) => (
              <button
                key={c.id}
                type="button"
                className={i === active ? 'jj-palette-item jj-palette-item-active' : 'jj-palette-item'}
                onClick={() => runAt(i)}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
