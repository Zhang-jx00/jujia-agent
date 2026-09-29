import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { PDF_MAX_PAGES } from '@jujia/shared-ipc';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from 'pdfjs-dist';
// worker 走构建产物里的本地文件：**不是**网络请求，也不是 file:// 取数据
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/**
 * PDF 查看（M19 报备 §四 3/4）。
 *
 * 三条底线写在这里，改这个文件的人先看这三条：
 * 1. **零出站**：不设 `cMapUrl` / `standardFontDataUrl` / `wasmUrl`，`useWorkerFetch: false`
 *    —— pdfjs 想取字体/cmap/wasm 时没有可取的地址（不是"我们保证它不去取"，是"它没有地方可去"）。
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPages(0);
    setPage(1);

    // 复制一份：pdfjs 会**接管**传入的 buffer（分离 ArrayBuffer），留着原件才能翻页/重开
    const data = new Uint8Array(bytes);
    const task = getDocument({
      data,
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
        if (doc.numPages > PDF_MAX_PAGES) {
          setError(`这份 PDF 有 ${String(doc.numPages)} 页，超过本机查看的上限 ${String(PDF_MAX_PAGES)} 页。`);
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
    });
    return () => {
      cancelled = true;
    };
  }, [page, pages, loading]);

  return (
    <div className="jj-pdf" aria-label="PDF 查看">
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
