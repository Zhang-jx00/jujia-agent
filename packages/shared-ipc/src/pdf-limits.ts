import { PDF_MAX_BYTES, PDF_MAX_PAGES } from './limits';

/**
 * PDF 的两条上限判定（M19b 补：复核 041 的第二条建议）。
 *
 * 为什么从两个调用点抽成纯函数：原先这两条判断分别写在主进程的 IPC 处理器与渲染层的组件里，
 * **只有接线锁看着它们**（"常量在、判断在"），行为级验证要真造一份 32MB 的 PDF —— 不划算，
 * 于是就成了"登记过的覆盖边界"。抽成纯函数之后，边界值可以直接喂（恰好等于上限、上限 +1），
 * 覆盖边界就少了一处。
 *
 * 返回值一律是"给用户看的那句话"或 `null`（放行）——判定与文案**同处一地**，
 * 免得两处各写一份话说得不一样。
 */

/** 超过字节上限就返回拒绝理由，否则 null */
export function checkPdfSize(bytes: number): string | null {
  if (!Number.isFinite(bytes) || bytes < 0) return '这个文件的大小读不出来，没法确认能不能安全打开。';
  if (bytes > PDF_MAX_BYTES) {
    return `这份 PDF 有约 ${String(Math.ceil(bytes / 1024 / 1024))} MB，超过本机查看的上限 ${String(
      PDF_MAX_BYTES / 1024 / 1024,
    )} MB。`;
  }
  return null;
}

/** 超过页数上限就返回拒绝理由，否则 null */
export function checkPdfPages(pages: number): string | null {
  if (!Number.isInteger(pages) || pages < 1) return '这份 PDF 的页数读不出来，没法确认能不能安全打开。';
  if (pages > PDF_MAX_PAGES) {
    return `这份 PDF 有 ${String(pages)} 页，超过本机查看的上限 ${String(PDF_MAX_PAGES)} 页。`;
  }
  return null;
}
