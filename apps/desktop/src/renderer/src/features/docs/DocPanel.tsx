import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { parseMarkdown } from '../../markdown/parse';
import { MarkdownView } from '../../markdown/MarkdownView';

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

  const open = useCallback(async (): Promise<void> => {
    const target = path.trim();
    if (target === '') {
      setMessage({ kind: 'error', text: '请先输入工作区内的文件路径' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await window.jujia.toolRun('read_file', { path: target });
      if (!result.ok) {
        setContent(null);
        setMessage({ kind: 'error', text: `没读到：${result.content}` });
        return;
      }
      setContent(result.content);
      setShown(CHUNK);
      setMessage({
        kind: 'info',
        text: `已打开 ${target}（${String(result.durationMs)}ms）`,
      });
    } catch (err) {
      setContent(null);
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }, [path]);

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
          <div className="jj-docs-body">
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
