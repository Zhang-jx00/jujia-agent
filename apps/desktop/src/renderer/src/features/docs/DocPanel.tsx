import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { parseMarkdown } from '../../markdown/parse';
import { MarkdownView } from '../../markdown/MarkdownView';
import { clearDocView, currentDocView, rememberDocView } from './doc-view-state';

/**
 * 应用内文档查看（M10 收尾 · Markdown 那一半）。
 *
 * **读文件不新开通道**：走已有的 `TOOL_RUN(read_file)`。
 * 理由是不想第二处决定"什么能被读"—— 路径守卫（越界直接拒）、大小上限、截断标注
 * 都已经在 `read_file` 里被审过并测过；再写一条 `doc:read` 就等于给同一件事开第二个口径。
 *
 * 三条如实的限制（写界面上，不藏在文档里）：
 * 1. 一次最多读 256KB（沿用 `read_file` 的上限），更大的文件尾部会带『已截断』标注；
 * 2. 只支持 Markdown 的常见子集，**原始 HTML 按字面显示、远程图片不加载**（安全取舍，见 `parse.ts` 头部）；
 * 3. 只能打开**工作区内**的文件，越界会被路径守卫拒掉并把理由显示出来。
 *
 * "点开一个文件"这件事目前还没有文件树可点 —— 所以这里的入口是一行路径输入框。
 * 文件树、PDF 查看、以及"从 Git 面板直接点开某个改动文件"都归 M19 一起做（所有者 2026-09-26 拍板）。
 *
 * **T24（本轮）：切页签不丢阅读位置。** 页签切走时本面板会被卸载（`App.tsx` 只给对话页包了
 * `KeepAlive`），所以路径 / 分块进度 / 滚动偏移存在 `doc-view-state` 那个模块里。
 * 回来时**重读文件**而不是复用旧内容：文件可能已经改了，用旧内容"恢复"是另一种骗人。
 */

const CHUNK = 240;

const TRUNCATION_HINT =
  '一次最多读取 256KB（沿用 read_file 的上限）；更大的文件本页会显示『已截断』标注，完整阅读需分页 —— 已随 M19 的文件树一起做。';

/**
 * 查看器边界（红线 2：不支持的东西必须让用户看得见，否则他会以为是文档坏了）。
 * 每条都是刻意的取舍而不是漏做，理由见 `markdown/parse.ts` 头部。
 */
const VIEWER_LIMITS =
  '查看器边界（不是文档坏了）：原始 HTML 按字面显示、不解释；' +
  '远程图片永不加载（那会是出站请求，本应用默认数据不出本机）；' +
  'setext 标题与脚注不支持，`---` 一律当分隔线；任务列表的方框不能点。' +
  '表格与列表已支持（管道式表格）。';

export function DocPanel(): ReactElement {
  const [path, setPath] = useState('');
  const [content, setContent] = useState<string | null>(null);
  const [shown, setShown] = useState(CHUNK);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const blocks = useMemo(() => (content === null ? [] : parseMarkdown(content)), [content]);

  /** 阅读容器（滚动偏移存进模块级 store，见 doc-view-state） */
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** 待应用的滚动偏移：只在"恢复打开"那一次有值，应用完就清空 */
  const pendingScrollRef = useRef<number | null>(null);
  /** 本次挂载是否已经尝试过恢复（尝试过就不再试第二次，失败也不反复撞） */
  const restoredRef = useRef(false);

  /** 长期记忆的固定位置（补偿条件①"看得到"的落点；路径由主进程的路径守卫把守，不在工作区内会被拒） */
  const NOTES_PATH = '.jujia/NOTES.md';

  /**
   * `override` 给「查看长期记忆」这类预置入口用：不依赖 setPath 之后的重渲染时机。
   * `resume` 只给 T24 的恢复路径用：带着上次的分块进度与滚动偏移，读的是**同一个文件**。
   */
  const open = useCallback(
    async (override?: string, resume?: { shown: number; scrollTop: number }): Promise<void> => {
      const target = (override ?? path).trim();
      if (target === '') {
        setMessage({ kind: 'error', text: '请先输入工作区内的文件路径' });
        return;
      }
      setPath(target);
      setBusy(true);
      setMessage(null);
      try {
        const result = await window.jujia.toolRun('read_file', { path: target });
        if (!result.ok) {
          setContent(null);
          pendingScrollRef.current = null;
          // 记住的路径读不到了（改名 / 删除 / 换了工作区）：**忘掉它**。
          // 留着就是每次挂载再撞一遍同一个错误 —— 那比"没记住"更糟（T6 的静默回落教训反着用）。
          clearDocView();
          setMessage({ kind: 'error', text: `没读到：${result.content}` });
          return;
        }
        const nextShown = resume !== undefined && resume.shown > 0 ? resume.shown : CHUNK;
        setContent(result.content);
        setShown(nextShown);
        pendingScrollRef.current = resume?.scrollTop ?? null;
        rememberDocView({ path: target, shown: nextShown, scrollTop: resume?.scrollTop ?? 0 });
        setMessage({
          kind: 'info',
          text:
            resume === undefined
              ? `已打开 ${target}（${String(result.durationMs)}ms）`
              : `已恢复到上次打开的 ${target}（第 ${String(nextShown)} 段附近，${String(result.durationMs)}ms）`,
        });
      } catch (err) {
        setContent(null);
        pendingScrollRef.current = null;
        clearDocView();
        setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
      } finally {
        setBusy(false);
      }
    },
    [path],
  );

  // ---- T24：挂载时恢复"上次看的是哪个文件、看到哪" ----
  // 只做一次（restoredRef）：恢复失败会 clearDocView，成功则不必重跑。
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const saved = currentDocView();
    if (saved === null) return;
    void open(saved.path, { shown: saved.shown, scrollTop: saved.scrollTop });
  }, [open]);

  // 分块进度一变就记下（切走时被卸载，这里是不丢的唯一办法）
  useEffect(() => {
    if (content === null) return;
    rememberDocView({ shown });
  }, [shown, content]);

  // 恢复的滚动位置：等内容与分段都渲染完再应用，且只应用一次（之后归用户）
  useEffect(() => {
    const top = pendingScrollRef.current;
    if (top === null) return;
    pendingScrollRef.current = null;
    const el = scrollRef.current;
    if (el !== null && top > 0) el.scrollTop = top;
  }, [content, shown, blocks.length]);

  /** 文档里的链接点开 = 与浏览器面板同一动作：交给外部程序，由主进程判档（外部档照样硬 ask） */
  const openLink = useCallback(async (href: string): Promise<void> => {
    try {
      const result = await window.jujia.browserOpenWith(href, 'system');
      setMessage(
        result.ok
          ? {
              kind: 'info',
              text: result.asked ? '你确认后，链接已交给系统默认浏览器' : '按当前权限策略，链接已交给系统默认浏览器',
            }
          : { kind: 'error', text: `链接没有交出去：${result.error ?? '未知原因'}` },
      );
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  return (
    <section className="jj-docs">
      <header className="jj-docs-head">
        <input
          className="jj-field"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void open();
          }}
          placeholder="输入工作区内的 .md 路径，回车打开"
          spellCheck={false}
          aria-label="文档路径"
        />
        <button type="button" className="jj-btn jj-transition" onClick={() => void open()} disabled={busy}>
          打开
        </button>
        {/* 补偿条件①"看得到"：不让人靠猜路径去找那份每轮都注入给模型的长期记忆 */}
        <button
          type="button"
          className="jj-btn jj-transition"
          onClick={() => void open(NOTES_PATH)}
          disabled={busy}
        >
          查看长期记忆
        </button>
      </header>

      {message !== null && (
        <p className={message.kind === 'error' ? 'p0-err' : 'jj-muted'} role={message.kind === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}

      {content === null ? (
        <>
          <p className="p0-subtitle">
            还没打开文档。只读工作区内的文件，越界会被路径守卫拒绝并把理由显示在这里。
            {TRUNCATION_HINT}
          </p>
          <p className="jj-muted">{VIEWER_LIMITS}</p>
        </>
      ) : (
        <>
          <div
            className="jj-docs-body"
            ref={scrollRef}
            onScroll={(e) => rememberDocView({ scrollTop: e.currentTarget.scrollTop })}
          >
            <MarkdownView blocks={blocks} shown={shown} onOpenLink={(href) => void openLink(href)} />
            {blocks.length > CHUNK && (
              <p className="jj-muted">
                {blocks.length > shown ? (
                  <>
                    {`已显示前 ${String(shown)} / ${String(blocks.length)} 段（分块挂载，长文档一次性铺开 DOM 会卡）`}
                    {' '}
                    <button type="button" className="jj-btn jj-btn-quiet jj-transition" onClick={() => setShown((n) => n + CHUNK)}>
                      继续加载
                    </button>
                    {' '}
                    <button type="button" className="jj-btn jj-btn-quiet jj-transition" onClick={() => setShown(blocks.length)}>
                      全部展开
                    </button>
                  </>
                ) : (
                  // 铺完之后不整行消失：留下"共多少段、已全部显示"，
                  // 否则用户会以为文档本来就这么短
                  <>{`共 ${String(blocks.length)} 段，已全部显示`}</>
                )}
              </p>
            )}
            <p className="jj-muted">{TRUNCATION_HINT}</p>
            <p className="jj-muted">{VIEWER_LIMITS}</p>
          </div>
        </>
      )}
    </section>
  );
}
