import { useState } from 'react';
import type { ReactElement } from 'react';
import { CHAT_IMAGE_MAX_PER_MESSAGE } from '@jujia/shared-ipc';
import type { PreparedImageView } from '@jujia/shared-ipc';
import { IconX } from '../../ui/icons';

/**
 * 输入区（M11 批一 · R14 从 ChatPanel 抽出来的第二刀）。
 *
 * 边界：这里只有"输入这一件事"的界面与本地交互态（拖动高亮、回车发送）；
 * 待发清单与准入行为在 `useAttachments`，发送与停止由 ChatPanel 通过回调传入 ——
 * 组件不直接碰 IPC，e2e 与单测都对"这一段长什么样、点它会发生什么"有单独的说法。
 */

interface Props {
  input: string;
  attached: PreparedImageView[];
  attachBusy: boolean;
  attachHint: string | null;
  connectionName: string;
  sending: boolean;
  hasConnection: boolean;
  onInput: (value: string) => void;
  onPickImages: () => void;
  onFiles: (files: File[]) => void;
  onRemoveImage: (index: number) => void;
  onSend: () => void;
  onStop: () => void;
}

/** 图片大小给人看的一句话（小于 1KB 的也说 1KB —— "0KB"看起来像读坏了） */
function formatBytes(n: number): string {
  return n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)}MB`
    : `${String(Math.max(1, Math.round(n / 1024)))}KB`;
}

export function ChatComposer(props: Props): ReactElement {
  const { input, attached, attachBusy, attachHint, connectionName, sending, hasConnection } = props;
  const [dragActive, setDragActive] = useState(false);

  return (
    <div
      className={dragActive ? 'w2-chat-input w2-chat-input-drag' : 'w2-chat-input'}
      onDragOver={(e) => {
        // 只认文件拖动（选中文字拖来拖去不进入"可放置"态）
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragActive(true);
        }
      }}
      onDragLeave={(e) => {
        // 移进子元素也会触发 dragleave —— 只有真正离开这个容器才熄灭高亮
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragActive(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragActive(false);
        props.onFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {/*
        输入框顶部那一行（R66）：**当前连的是谁**。
        为什么放在这里而不是只留在工具条上：工具条离输入框远、而且会被别的元信息挤成两行；
        而"这句话会发给谁"是**发出去之前**最该确认的一件事，必须离发送键近。
      */}
      <div className="w2-chat-input-head">
        <span className="w2-chat-input-conn">{`连接 · ${connectionName}`}</span>
      </div>
      {attached.length > 0 && (
        <div className="w2-attach-row">
          {attached.map((img, i) => (
            <span
              key={`${img.name}-${String(i)}`}
              className="w2-attach-chip"
              data-attach-name={img.name}
            >
              <img
                className="w2-attach-thumb"
                src={`data:${img.mimeType};base64,${img.dataBase64}`}
                alt=""
              />
              <span className="w2-attach-name" title={img.name}>
                {img.name}
              </span>
              <span className="p0-subtitle">
                {formatBytes(img.sizeBytes)}
                {img.stripped ? ' · 已剥元数据' : ''}
              </span>
              <button
                type="button"
                className="w2-attach-remove"
                aria-label={`移除 ${img.name}`}
                onClick={() => props.onRemoveImage(i)}
              >
                <IconX />
              </button>
            </span>
          ))}
        </div>
      )}
      {attached.length > 0 && (
        <p className="p0-subtitle">
          {`图片会随本条消息发给「${connectionName}」的服务商；本机不保留副本。`}
        </p>
      )}
      {attachHint !== null && (
        <p className="p0-err" role="status">
          {attachHint}
        </p>
      )}
      <textarea
        value={input}
        onChange={(e) => props.onInput(e.target.value)}
        placeholder="输入消息（Enter 发送，Shift+Enter 换行；也可以把图片拖进来）"
        rows={3}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files);
          if (files.some((f) => f.type.startsWith('image/'))) {
            e.preventDefault();
            props.onFiles(files);
          }
        }}
        onKeyDown={(e) => {
          // 组合输入期间（拼音选字）回车不是"发送"；229 是部分 IME 的 keyCode 兜底（T40）。
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            // 流式中回车不许重发（T40）：旧行为会重入 send()、把 user 气泡打出去，
            // 主进程的"正在生成中"错误再被 catch 吞掉顺手关掉停止按钮。
            if (props.sending) return;
            props.onSend();
          }
        }}
      />
      <div className="w2-actions w2-chat-actions">
        <div className="w2-actions-left">
          <button
            type="button"
            className="w2-btn"
            disabled={attachBusy || !hasConnection || attached.length >= CHAT_IMAGE_MAX_PER_MESSAGE}
            onClick={() => props.onPickImages()}
          >
            {attachBusy ? '正在读取图片…' : '添加图片'}
          </button>
        </div>
        <div className="w2-actions-right">
          <button type="button" className="w2-btn" disabled={!sending} onClick={() => props.onStop()}>
            停止
          </button>
          <button
            type="button"
            className="w2-btn-primary"
            disabled={!hasConnection || (input.trim() === '' && attached.length === 0) || sending}
            onClick={() => props.onSend()}
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
