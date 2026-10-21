import { Fragment, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import {
  MEDIA_IMAGE_DEFAULT_SIZE,
  MEDIA_IMAGE_MAX_BYTES,
  MEDIA_IMAGE_MAX_COUNT,
  MEDIA_IMAGE_TIMEOUT_MS,
} from '@jujia/shared-ipc';
import type { ConnectionView, MediaImageGenerateResultView } from '@jujia/shared-ipc';

/**
 * 媒体生成 · 文生图面板（M11 剩余 · R51 · S1）。
 *
 * 这一层只做三件事：**把提示词收上来**、**把成本上限事先说清**、**把回执显示出来**。
 * 它**不碰密钥**（渲染层拿不到，也不需要）、**不自己判断能不能生成**
 * （那是主进程与服务商之间的事，界面只负责把结论如实显示）。
 *
 * 界面上必须说清的三件事（口径 6）：
 * 1. **成本上限**：一次几张、每张多大、单张多少 MB —— 用户按下按钮之前就该知道这次可能要花多少；
 * 2. **能力差异**：「这个连接不支持生成」—— 不是所有服务商都有图片生成端点，
 *    这时候要**说清楚**，不静默失败、不假装成功；
 * 3. **本机保留副本**：生成的图落在本机（本应用数据目录）。
 *    刻意**不说**"没人存你的提示词"—— 那是**另一条边界**（服务商那边的留存是它的政策，本应用管不了）。
 */

interface Props {
  connections: ConnectionView[];
}

/** 给人看的字节数（小于 1KB 也说 1KB —— "0KB"看起来像读坏了） */
function formatBytes(n: number): string {
  return n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)}MB`
    : `${String(Math.max(1, Math.round(n / 1024)))}KB`;
}

export function MediaGenPanel({ connections }: Props): ReactElement {
  const [connectionId, setConnectionId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MediaImageGenerateResultView | null>(null);
  /** IPC 自己抛了（形状不对、桥断了）—— 与"服务端说不行"分开显示 */
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!connectionId && connections.length > 0) {
      setConnectionId(connections[0]?.id ?? '');
    }
    if (connectionId && !connections.some((c) => c.id === connectionId)) {
      setConnectionId(connections[0]?.id ?? '');
    }
  }, [connections, connectionId]);

  async function generate(): Promise<void> {
    if (connectionId === '' || prompt.trim() === '' || busy) return;
    setBusy(true);
    setResult(null);
    setFailure(null);
    try {
      const r = await window.jujia.mediaImageGenerate({ connectionId, prompt: prompt.trim(), count });
      setResult(r);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const unsupported = result !== null && !result.ok && result.reason === 'unsupported';

  return (
    <div className="w2-panel">
      <section className="p0-card">
        <h2>文生图（走当前连接）</h2>
        <p className="p0-subtitle">
          提示词会发给你选中的这条连接所配置的服务商 —— 和你发聊天消息是同一个去处。
        </p>

        <label>
          用哪条连接生成
          <select
            aria-label="用哪条连接生成"
            value={connectionId}
            onChange={(e) => setConnectionId(e.target.value)}
          >
            {connections.length === 0 && <option value="">（请先在「连接」页创建）</option>}
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.model}
              </option>
            ))}
          </select>
        </label>

        <label>
          要几张
          <select
            aria-label="要几张"
            value={String(count)}
            onChange={(e) => setCount(Number(e.target.value))}
          >
            {Array.from({ length: MEDIA_IMAGE_MAX_COUNT }, (_x, i) => i + 1).map((n) => (
              <option key={n} value={String(n)}>
                {String(n)}
              </option>
            ))}
          </select>
        </label>

        <p className="p0-subtitle" data-cost-limit="true">
          {`成本上限：一次最多 ${String(MEDIA_IMAGE_MAX_COUNT)} 张 · 每张 ${MEDIA_IMAGE_DEFAULT_SIZE.replace('x', '×')} · 单张上限 ${String(
            MEDIA_IMAGE_MAX_BYTES / 1024 / 1024,
          )}MB · 单次最多等 ${String(Math.round(MEDIA_IMAGE_TIMEOUT_MS / 1000))} 秒 · 超过上限的不会落盘`}
        </p>

        <textarea
          aria-label="提示词"
          placeholder="输入提示词（要画什么）"
          value={prompt}
          rows={3}
          onChange={(e) => setPrompt(e.target.value)}
        />

        <div className="w2-actions">
          <button
            type="button"
            className="w2-btn-primary"
            data-gen-submit="true"
            disabled={busy || connectionId === '' || prompt.trim() === ''}
            onClick={() => void generate()}
          >
            {busy ? '正在生成…' : '生成'}
          </button>
        </div>

        <p className="p0-subtitle">
          生成的图片会落在本应用数据目录里 —— 本机保留副本；服务商那边是否留生成历史，本应用管不了。
        </p>
      </section>

      {failure !== null && (
        <p className="p0-err" role="alert" data-gen-error="true">
          {failure}
        </p>
      )}

      {unsupported && (
        <p className="p0-warn" role="alert" data-gen-unsupported="true">
          这个连接不支持生成
        </p>
      )}

      {result !== null && !result.ok && (
        <section className="p0-card">
          <p className="p0-err" role="alert" data-gen-error="true">
            {result.error}
          </p>
        </section>
      )}

      {result !== null && result.artifacts.length > 0 && (
        <section className="p0-card" data-gen-receipt="true">
          <h2>{result.ok ? '生成结果' : '已经落盘的部分'}</h2>
          <dl className="p0-kv">
            {result.artifacts.map((a) => (
              <Fragment key={a.path}>
                <dt>{a.mimeType}</dt>
                <dd>{`${formatBytes(a.sizeBytes)} · ${a.path}`}</dd>
              </Fragment>
            ))}
          </dl>
          <p className="p0-subtitle">
            {`共 ${String(result.artifacts.length)} 张，已保存在本应用数据目录（本机保留副本）。`}
          </p>
        </section>
      )}
    </div>
  );
}
