import { useRef, useState } from 'react';
import { CHAT_IMAGE_MAX_PER_MESSAGE } from '@jujia/shared-ipc';
import type { ImageIntakeResultView, PreparedImageView } from '@jujia/shared-ipc';

/**
 * 待发图片清单（M11 批一 · R14）：状态与行为从 ChatPanel 抽出来（文件行数触顶后的
 * 第一刀，按"这一块自己有完整的生命周期"的边界切）。
 *
 * 两条纪律：
 * - **唯一写入口**：`attached` 状态与 `ref` 一起走（拖动与粘贴可能并发，只改一处会漂）；
 * - 图片字节**不在这里留副本之外的东西**：这里持有的就是准入后的 `PreparedImageView`，
 *   发送后立刻清空（列表空 = 本机没有别的副本了）。
 */

export interface Attachments {
  attached: PreparedImageView[];
  attachBusy: boolean;
  attachHint: string | null;
  /** 读得到当下值（send() 不能被闭包里的旧 state 骗到） */
  current: () => PreparedImageView[];
  pickImages: () => Promise<void>;
  prepareDroppedFiles: (files: File[]) => Promise<void>;
  removeAttached: (index: number) => void;
  clear: () => void;
}

export function useAttachments(): Attachments {
  const [attached, setAttached] = useState<PreparedImageView[]>([]);
  const attachedRef = useRef<PreparedImageView[]>([]);
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachHint, setAttachHint] = useState<string | null>(null);

  /** 待发清单的唯一写入口（状态与 ref 一起走 —— 拖动与粘贴可能并发，只改一处会漂） */
  function applyAttached(next: PreparedImageView[]): void {
    attachedRef.current = next;
    setAttached(next);
  }

  /** 两条入口（选择器 / 拖动·粘贴）的合流点：合计不过 4 张；多出来的**明说**，不静默丢 */
  function mergePrepared(result: ImageIntakeResultView): void {
    const room = Math.max(CHAT_IMAGE_MAX_PER_MESSAGE - attachedRef.current.length, 0);
    const take = result.images.slice(0, room);
    const overflow = result.images
      .slice(room)
      .map((img) => `「${img.name}」没有加入：一条消息最多 ${String(CHAT_IMAGE_MAX_PER_MESSAGE)} 张`);
    applyAttached([...attachedRef.current, ...take]);
    const problems = [...result.problems, ...overflow];
    setAttachHint(problems.length > 0 ? problems.join('；') : null);
  }

  async function pickImages(): Promise<void> {
    setAttachBusy(true);
    setAttachHint(null);
    try {
      const r = await window.jujia.chatPickImages();
      // 取消是正常路径：不动清单、不报错
      if (!r.cancelled) mergePrepared(r);
    } catch (err) {
      setAttachHint(`挑选图片失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAttachBusy(false);
    }
  }

  /** 拖动 / 粘贴这条路：字节走 IPC 结构化克隆，**不自己编码**（编码器在网页环境里未必可用） */
  async function prepareDroppedFiles(files: File[]): Promise<void> {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) {
      setAttachHint('这些文件里没有图片（支持 png / jpeg / webp / gif）');
      return;
    }
    setAttachBusy(true);
    setAttachHint(null);
    try {
      const payload = await Promise.all(
        images.slice(0, 8).map(async (f) => ({
          // 剪贴板来的图经常没有文件名 —— 给一个说得出出处的名字，而不是空串
          name: f.name !== '' ? f.name : '粘贴的图片',
          bytes: new Uint8Array(await f.arrayBuffer()),
        })),
      );
      mergePrepared(await window.jujia.chatImagesPrepare(payload));
    } catch (err) {
      setAttachHint(`读取图片失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAttachBusy(false);
    }
  }

  function removeAttached(index: number): void {
    applyAttached(attachedRef.current.filter((_, i) => i !== index));
  }

  function clear(): void {
    applyAttached([]);
    setAttachHint(null);
  }

  return {
    attached,
    attachBusy,
    attachHint,
    current: () => attachedRef.current,
    pickImages,
    prepareDroppedFiles,
    removeAttached,
    clear,
  };
}
