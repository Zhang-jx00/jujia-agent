import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { checkPdfPages } from '@jujia/shared-ipc';
import { BundledPdfBinaryDataFactory } from './pdf-assets';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from 'pdfjs-dist';
// worker 走构建产物里的本地文件：**不是**网络请求，也不是 file:// 取数据
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/**
 * PDF 查看（M19 报备 §四 3/4）。
 *
 * 三条底线写在这里，改这个文件的人先看这三条：
 * 1. **零出站**：字体与 cmap 由 `BundledPdfBinaryDataFactory` 从**包内字节**供给（M19b 内联进包），
 *    三个资源地址一个都不设、`useWorkerFetch: false` —— pdfjs 想取东西时既没有地址、
 *    也没有第二条路（取字节只有工厂那一条，且它只会翻包里的表）。
 *    `useWasm: false` 同理（JPEG2000 之类的解码退回纯 JS，慢一点，但不出网）。
 * 2. **不执行 PDF 里带的东西**：这里用的是 pdfjs 的**API**、不是它自带的 viewer，
 *    所以根本没有"viewer 插件"那一层；而 `enableXfa` 之类会求值文档内容的开关一律不开。
 * 3. **有界**：页数超 `PDF_MAX_PAGES` 直接拒绝；图像总像素超上限的不渲染（`maxImageSize`）；
 *    一次只画当前页（不预渲染整本）。
 */
GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_IMAGE_PIXELS = 4096 * 4096;

interface Props {
  /** 工作区内的相对路径（显示用） */
  path: string;
  bytes: Uint8Array;
}

export function PdfView({ path, bytes }: Props): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  /** 销毁要连着 loading task 一起（v6 里 `destroy()` 在 task 上，不在 doc 上） */
  const taskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** 这份文档取用了哪些内置资源（给 e2e 的 `data-pdf-assets` 用；见 pdf-assets.ts 的注释） */
  const [served, setServed] = useState<string[]>([]);
  /**
   * 首页**抽取出来的文字**（给 e2e 的 `data-pdf-text` 用）。
   *
   * 为什么用"抽字"而不是"数像素"来证明内联 cmap 生效：预定义 CMap 干的活就是
   * "把字节映射成 CID/字符" —— 抽字走的正是这条路（映射错了就会抽出乱码）。
   * 而像素那条路还依赖"字形从哪来"（非内嵌字体要靠系统字体或内嵌字体），
   * 在测试环境里它可能什么都没画 —— 那验的是字形，不是 CMap。
   */
  const [pageText, setPageText] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPages(0);
    setPage(1);
    BundledPdfBinaryDataFactory.resetServed();
    setServed([]);
    setPageText('');

    // 复制一份：pdfjs 会**接管**传入的 buffer（分离 ArrayBuffer），留着原件才能翻页/重开
    const data = new Uint8Array(bytes);
    const task = getDocument({
      data,
      // 字体/cmap 由**内置资源工厂**喂（M19b）：字节在包里，取它不需要任何地址
      BinaryDataFactory: BundledPdfBinaryDataFactory,
      useWorkerFetch: false,
      useWasm: false,
      useSystemFonts: true,
      disableAutoFetch: true,
      disableStream: true,
      maxImageSize: MAX_IMAGE_PIXELS,
    });

    taskRef.current = task;
    void task.promise.then(
      (doc) => {
        if (cancelled) {
          void task.destroy();
          return;
        }
        const tooMany = checkPdfPages(doc.numPages);
        if (tooMany !== null) {
          setError(tooMany);
          setLoading(false);
          void task.destroy();
          return;
        }
        setPages(doc.numPages);
        setLoading(false);
        docRef.current = doc;

      },
      (err: unknown) => {
        if (cancelled) return;
        setError(`这份 PDF 读不出来：${err instanceof Error ? err.message : String(err)}`);
        setLoading(false);
      },
    );

    return () => {
      cancelled = true;
      void taskRef.current?.destroy();
      taskRef.current = null;
      docRef.current = null;
    };
  }, [bytes]);

  /**
   * 把"这一份文档取用了哪些内置资源"同步到界面（诊断用，见 pdf-assets.ts）。
   * 用轮询而不是"加载完成后读一次"：字体/cmap 是**按需**取的，取用的时刻在渲染过程中间，
   * 一次性快照会读出"还没取"的空表（e2e 第一次跑就是这么红的）。
   */
  useEffect(() => {
    const id = setInterval(() => {
      const now = [...BundledPdfBinaryDataFactory.served].sort();
      setServed((prev) => (prev.join(',') === now.join(',') ? prev : now));
    }, 300);
    return () => clearInterval(id);
  }, []);

  /** 只画当前页（不预渲染整本：一本 500 页的 PDF 全画出来等于把内存吃光） */
  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (doc === null || canvas === null || page < 1 || page > pages) return;
    let cancelled = false;
    void doc.getPage(page).then((pdfPage) => {
      if (cancelled) return;
      const viewport = pdfPage.getViewport({ scale: 1.5 });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      if (ctx === null) {
        setError('没有拿到画布上下文，画不出来（这不是文档的问题）。');
        return;
      }
      void pdfPage.render({ canvas, canvasContext: ctx, viewport }).promise.catch((err: unknown) => {
        if (!cancelled) setError(`这一页画不出来：${err instanceof Error ? err.message : String(err)}`);
      });
      // 抽字：CMap 生效与否在这里看得见（像素看不出"映射对不对"）
      void pdfPage.getTextContent().then((content) => {
        if (cancelled) return;
        const text = content.items
          .map((it) => ('str' in it ? it.str : ''))
          .join('')
          .replace(/\s+/g, ' ')
          .trim();
        setPageText(text);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [page, pages, loading]);

  return (
    <div
      className="jj-pdf"
      aria-label="PDF 查看"
      data-pdf-assets={served.join(',')}
      data-pdf-text={pageText}
    >
      <div className="jj-pdf-bar">
        <span className="p0-subtitle" title={path}>
          {path}
        </span>
        <span className="p0-subtitle">{`第 ${String(page)} / ${pages === 0 ? '?' : String(pages)} 页`}</span>
        <button
          type="button"
          className="jj-btn jj-btn-quiet"
          disabled={page <= 1}
          onClick={() => setPage((n) => Math.max(1, n - 1))}
        >
          上一页
        </button>
        <button
          type="button"
          className="jj-btn jj-btn-quiet"
          disabled={pages === 0 || page >= pages}
          onClick={() => setPage((n) => Math.min(pages, n + 1))}
        >
          下一页
        </button>
      </div>
      {loading && <p className="p0-subtitle">正在解析…</p>}
      {error !== null && (
        <p className="p0-err" role="alert">
          {error}
        </p>
      )}
      <canvas ref={canvasRef} className="jj-pdf-canvas" />
    </div>
  );
}
