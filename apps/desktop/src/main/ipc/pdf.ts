import { stat, readFile } from 'node:fs/promises';
import { IPC, checkPdfSize, pdfOpenQuerySchema, pdfOpenResultSchema, type PdfOpenResult } from '@jujia/shared-ipc';
import { displayPath, guardPath } from '@jujia/agent-core';
import { getWorkspaceInfo } from '../workspace';
import type { IpcContext } from './context';

/**
 * 打开一份 PDF（M19 轻量 IDE 的查看入口）。
 *
 * **为什么单独一条通道、而不是把它做成工具**：PDF 字节是给**人看**的，不是给模型的。
 * 做成 `read_binary` 之类的工具，等于给模型新增一个"读任意二进制进上下文"的能力 ——
 * 攻击面变大、收益为零（模型看不懂 PDF 字节，那要等 M11 多模态）。所以这条通道：
 * 1. 只读：不过权限门（与 `read_file` 同口径：读不问）；
 * 2. 路径**仍然过 `guardPath`** —— 复用那唯一一处守卫，不新写一套；
 * 3. 返回值**只回渲染层**，不进模型上下文、不产生任何 chat 事件。
 *
 * 「不问」不等于「不设防」：工作区外的路径在这里就被拒了，而这份文件的字节
 * 从头到尾没有离开过本机。
 */
export function registerPdfIpc(ctx: IpcContext): void {
  const { handle } = ctx;

  handle(IPC.PDF_OPEN, async (_e, payload: unknown): Promise<PdfOpenResult> => {
    const parsed = pdfOpenQuerySchema.safeParse(payload);
    if (!parsed.success) {
      return pdfOpenResultSchema.parse({ ok: false, bytes: null, size: 0, error: '请求形态不合法，什么都没做' });
    }

    const info = await getWorkspaceInfo();
    if (!info.root || !info.valid) {
      return pdfOpenResultSchema.parse({
        ok: false,
        bytes: null,
        size: 0,
        error: `无法打开：${info.message}。请先在「概览」页选择工作区。`,
      });
    }

    let abs: string;
    try {
      // 与文件工具同一个守卫（越界在这里抛，理由原样带回界面）
      abs = await guardPath(info.root, parsed.data.path);
    } catch (err) {
      return pdfOpenResultSchema.parse({
        ok: false,
        bytes: null,
        size: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const st = await stat(abs).catch(() => null);
    if (st === null || !st.isFile()) {
      return pdfOpenResultSchema.parse({
        ok: false,
        bytes: null,
        size: 0,
        error: `文件不存在：${displayPath(info.root, abs)}`,
      });
    }
    // 上限判定抽在纯函数里（复核 041 第二条建议）：边界值能直接喂单测，不必造 32MB 样本
    const tooBig = checkPdfSize(st.size);
    if (tooBig !== null) {
      return pdfOpenResultSchema.parse({ ok: false, bytes: null, size: st.size, error: tooBig });
    }

    const buf = await readFile(abs);
    return pdfOpenResultSchema.parse({ ok: true, bytes: new Uint8Array(buf), size: buf.byteLength, error: '' });
  });
}
