import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { IconCheck, IconChevronDown, IconLoaderCircle, IconX } from '../../ui/icons';

/**
 * 工具卡（W6）：三级信息密度
 * - **L0**：永远一行（状态图标 + 工具名 + 耗时 + 摘要）
 * - **L1**：点开显示关键参数与结果摘要（卡片）
 * - **L2**：再点开进入 Drawer，看完整参数与完整输出
 *
 * 动效纪律（见 `docs/DESIGN-BASELINE.md` 与 styles/motion.css 顶部铁律）：
 * - L1 的展开/收起走**真实内容高度的连续过渡**（`.jj-collapse` 的 `grid-template-rows 0fr↔1fr`），
 *   内容**始终挂载** —— 重挂载就是"文字突然出现"，那是被明令禁止的形状；
 *   收起时用 `inert` + `aria-hidden` 让它退出可达性树（而不是从 DOM 里消失）；
 * - 箭头是**同一个元素旋转 180°**（`.jj-caret`），不许"换一个字符"；
 * - Drawer 用 `transform: translateY` 进场（合成器线程，不触发重排）；
 * - 入场只错峰 1 级，同屏不同时动多个元素。
 */

export interface ToolCardData {
  callId: string;
  name: string;
  phase: 'running' | 'done';
  ok?: boolean;
  summary?: string;
  durationMs?: number;
  /** 原始参数文本（模型给出的 JSON 字符串） */
  argumentsText?: string;
  /**
   * 长命令的**实时输出尾部**（R8.7）。只在本次运行期间存在于内存：
   * 它是"现在在跑什么"的可见性，不是结果 —— 结果仍然是 `summary`（跑完之后那一份）。
   */
  tail?: string;
}

const KIND_HINT: Record<string, string> = {
  read_file: '读取',
  write_file: '写入',
  list_dir: '列目录',
  handoff: '移交',
};

function prettyArgs(text: string | undefined): string {
  if (!text || text.trim() === '') return '（无参数）';
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function ToolCard({ data }: { data: ToolCardData }): ReactElement {
  const [level, setLevel] = useState<'L0' | 'L1' | 'L2'>('L0');
  const drawerRef = useRef<HTMLDivElement | null>(null);

  // L2 Drawer：Esc 关闭 + 打开时把焦点移入（键盘可达性）
  useEffect(() => {
    if (level !== 'L2') return;
    drawerRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setLevel('L1');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [level]);

  const state = data.phase === 'running' ? 'running' : data.ok ? 'ok' : 'bad';
  // 状态图标是**内联 SVG**（R19）：随文字颜色走、尺寸一致；旁边永远有状态文字，所以对读屏隐藏
  const stateIcon =
    state === 'running' ? <IconLoaderCircle /> : state === 'ok' ? <IconCheck /> : <IconX />;
  const statusText = state === 'running' ? '执行中' : state === 'ok' ? '完成' : '失败';

  return (
    <div className={`jj-tool jj-tool-${state}`}>
      <button
        type="button"
        className="jj-tool-l0 jj-transition jj-pressable"
        aria-expanded={level !== 'L0'}
        onClick={() => setLevel(level === 'L0' ? 'L1' : 'L0')}
      >
        <span className={`jj-tool-icon${state === 'running' ? ' jj-tool-icon-spinning' : ''}`}>
          {stateIcon}
        </span>
        <code className="jj-tool-name">{data.name}</code>
        <span className="jj-tool-kind">{KIND_HINT[data.name] ?? '工具'}</span>
        <span className="jj-tool-meta">
          {data.durationMs !== undefined ? `${data.durationMs}ms` : statusText}
        </span>
        {data.summary && <span className="jj-tool-summary">{data.summary}</span>}
        <span className="jj-caret" data-caret="" data-open={level !== 'L0'} aria-hidden="true">
          <IconChevronDown />
        </span>
      </button>

      {data.tail !== undefined && data.tail !== '' && (
        <pre
          className="jj-pre jj-tool-tail"
          data-tool-tail={data.callId}
          aria-label={data.phase === 'running' ? '实时输出（命令仍在运行）' : '实时输出（末尾片段）'}
        >
          {data.tail}
        </pre>
      )}

      {/*
        L1：**始终挂载**，靠容器轨道 0fr↔1fr 做真实高度的连续过渡（见 motion.css 的 .jj-collapse）。
        收起时加 `inert` + `aria-hidden`：内容对键盘/读屏不可达，但对过渡仍"存在"
        （从 DOM 里摘掉再插回来 = 文字突然出现，正是本轮要消灭的形状）。
      */}
      <div className="jj-collapse" data-collapsed={level === 'L0' ? 'true' : 'false'}>
        <div {...(level === 'L0' ? { inert: true, 'aria-hidden': true } : {})}>
          <div className="jj-tool-l1">
            <dl className="jj-tool-kv">
              <dt>状态</dt>
              <dd className={state === 'bad' ? 'jj-danger' : state === 'ok' ? 'jj-ok' : ''}>
                {statusText}
              </dd>
              <dt>参数</dt>
              <dd>
                <pre className="jj-pre">{prettyArgs(data.argumentsText)}</pre>
              </dd>
              {data.summary && (
                <>
                  <dt>结果</dt>
                  <dd>
                    <pre className="jj-pre">{data.summary}</pre>
                  </dd>
                </>
              )}
            </dl>
            <button
              type="button"
              className="jj-btn jj-btn-quiet jj-transition"
              onClick={() => setLevel('L2')}
            >
              查看完整输出
            </button>
          </div>
        </div>
      </div>

      {level === 'L2' && (
        <>
          <div className="jj-mask jj-fade" onClick={() => setLevel('L1')} />
          <div
            className="jj-drawer jj-enter"
            role="dialog"
            aria-modal="true"
            aria-label={`${data.name} 完整输出`}
            tabIndex={-1}
            ref={drawerRef}
          >
            <header className="jj-drawer-head">
              <strong>{data.name}</strong>
              <span className="jj-muted">
                {statusText}
                {data.durationMs !== undefined ? ` · ${data.durationMs}ms` : ''}
              </span>
              <button
                type="button"
                className="jj-btn jj-btn-quiet jj-transition"
                onClick={() => setLevel('L1')}
              >
                关闭（Esc）
              </button>
            </header>
            <div className="jj-drawer-body">
              <h4>参数</h4>
              <pre className="jj-pre">{prettyArgs(data.argumentsText)}</pre>
              <h4>输出</h4>
              <pre className="jj-pre">{data.summary ?? '（无输出）'}</pre>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
