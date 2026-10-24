import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { COMMANDS, filterCommands } from './commands';
import type { AppCommand } from './commands';
import { IconSearch } from '../../ui/icons';

/**
 * **启动器**（R68 · 左栏瘦身的第二入口）。
 *
 * 形态：**一个模态 + 一条搜索框 + 一份清单**（按分组排）。
 * 为什么是"模态"而不是"又一个页面"：它是**瞬时去某个地方**的动作 ⇒
 * 用完即走，不该占一块常驻的地方（常驻的地方是左栏与设置中心）。
 *
 * 键盘：**↑/↓ 移动 · Enter 执行 · Esc 关闭**；**Ctrl/Cmd+Shift+P** 唤起（由外壳管）。
 * 快捷键**不用 Ctrl+K** —— 画布的命令面板已经占着它（节点命令，与这个不是一回事）。
 */
export interface CommandPaletteProps {
  /** 关闭 */
  onClose: () => void;
  /** 执行某一条命令 */
  onRun: (cmd: AppCommand) => void;
}

export function CommandPalette({ onClose, onRun }: CommandPaletteProps): ReactElement {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const matched = useMemo(() => filterCommands(COMMANDS, query), [query]);

  /** 按分组切段（命令清单本来就是按组排的 ⇒ 连续同组即一段） */
  const groups = useMemo(() => {
    const out: { title: string; items: AppCommand[] }[] = [];
    for (const cmd of matched) {
      const last = out[out.length - 1];
      if (last !== undefined && last.title === cmd.group) last.items.push(cmd);
      else out.push({ title: cmd.group, items: [cmd] });
    }
    return out;
  }, [matched]);

  // 打开时聚焦搜索框（用户的第一动作一定是打字，不是找鼠标）
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 换查询词时高亮回到第一条（不然会停在已经不在列表里的那一项上）
  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, Math.max(0, matched.length - 1)));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = matched[active];
        if (cmd !== undefined) onRun(cmd);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [matched, active, onClose, onRun]);

  // 高亮项滚进可视区（列表长了才看得到自己在哪）
  useEffect(() => {
    itemRefs.current[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  let flatIndex = -1;

  return (
    <div
      className="jj-launcher-scrim"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="jj-launcher" role="dialog" aria-label="启动器" aria-modal="true">
        <div className="jj-launcher-search">
          <IconSearch size={14} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索功能（回车进入 · 上下键移动 · Esc 关闭）"
            aria-label="搜索功能"
          />
        </div>
        <div className="jj-launcher-list" role="listbox" aria-label="命令">
          {groups.length === 0 && <p className="jj-launcher-empty">没有匹配「{query}」的入口</p>}
          {groups.map((group) => (
            <div className="jj-launcher-group" key={group.title}>
              <div className="jj-launcher-group-title">{group.title}</div>
              {group.items.map((cmd) => {
                flatIndex += 1;
                const idx = flatIndex;
                const on = idx === active;
                return (
                  <button
                    key={cmd.id}
                    type="button"
                    ref={(el) => {
                      itemRefs.current[idx] = el;
                    }}
                    role="option"
                    aria-selected={on}
                    className={on ? 'jj-launcher-item jj-launcher-item-on' : 'jj-launcher-item'}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => onRun(cmd)}
                  >
                    <span className="jj-launcher-item-label">{cmd.label}</span>
                    {cmd.hint !== '' ? (
                      <span className="jj-launcher-item-hint">{cmd.hint}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
